/**
 * ThreeWood room server: one Durable Object per room, on Cloudflare.
 *
 * The server half of "play with friends". It speaks the message protocol the
 * phones use (src/net/room.js and src/net/netplay.js): hello and roster,
 * every game message relayed to everyone else with a `from` stamp, bots'
 * messages relayed under the bot's id, and the quiet swept out. Everything
 * the host's phone used to do as the hub happens here instead, so:
 *   - a room survives the host putting their phone away (a reconnect with
 *     the same id gets the seat back, and if the host is really gone the
 *     next person in becomes host);
 *   - every phone sees the same roster from one source;
 *   - phones behind strict mobile NATs work: it is a plain WebSocket;
 *   - bots live here, not on the host's phone: they play the same game code
 *     (src/net/bots.js, the shot planner and physics), stepped by the
 *     object's alarm, and keep playing whoever leaves.
 *
 * Deploy: `npx wrangler deploy` in this folder. The object hibernates between
 * messages, so an idle room costs nothing; the Workers paid plan covers far
 * more rooms than 10,000 players need.
 */

import { Bots, BOT_LEVELS, botLook, NAMES } from '../src/net/bots.js';
import { designHole, roundHoles } from '../src/course/holeDesigner.js';
import { buildWorld } from '../src/course/courseWorld.js';

const MAX_PLAYERS = 8;
const BOT_TICK = 200;        // ms between bot steps while a round with bots is on
const LETTERS = 'ABCDEFGHJKLMNPQRSTUVWXYZ';
const GONE_AFTER = 40_000;   // silence this long and the seat is given up
const SWEEP_EVERY = 15_000;
const KEEP_EMPTY = 60_000;   // a room with nobody in it is forgotten after this

export class RoomObject {
  constructor(state, env) {
    this.state = state;
    this.env = env;
    this.players = new Map(); // id -> { id, host, look, build, bot?, level? }
    this.hostId = null;
    this.seq = 0;
    this.round = null;      // { seed, length, holes, index } while a round is on
    this.state.blockConcurrencyWhile(async () => {
      const saved = await this.state.storage.get('room');
      if (saved) { this.players = new Map(saved.players); this.hostId = saved.hostId; this.seq = saved.seq || 0; this.created = saved.created; this.round = saved.round || null; }
    });
  }

  // ---- Bots ---------------------------------------------------------------------

  /**
   * The bots' view of the game: the same three things a phone gave them
   * (the hole and round, a way to speak, seat numbers), so src/net/bots.js
   * runs here unchanged.
   */
  botHost() {
    if (this.bots) return this.bots;
    const room = this;
    const net = {
      g: { world: null, round: null },
      deliverBot: (id, msg) => room.broadcast({ ...msg, from: id }),
      seatOf: (id) => Math.max(0, [...room.players.keys()].indexOf(id)),
    };
    this.bots = new Bots(net);
    Object.defineProperty(this.bots, 'game', { get: () => net.g });
    this.botNet = net;
    // Seats that were bots before the object was last evicted come back
    for (const p of this.players.values()) if (p.bot) this.bots.list.push(this.freshBot(p.id, p.level));
    return this.bots;
  }

  freshBot(id, level) {
    const b = this.bots.add(level);
    this.bots.list.pop();
    b.id = id;
    return b;
  }

  /** Load the round's current hole for the bots and send them to the tee. */
  botsToHole() {
    const r = this.round;
    const bots = this.botHost();
    if (!r || r.index >= r.holes.length || !bots.list.length) { this.botNet.g.world = null; return; }
    const spec = designHole(r.seed, r.holes[r.index]);
    this.botNet.g.world = buildWorld(spec);
    this.botNet.g.round = { seed: r.seed, index: r.index };
    bots.atHole();
    this.lastTick = Date.now();
    this.scheduleTick();
  }

  botsPlaying() { return !!(this.bots?.list.length && ((this.botNet?.g.world && this.round) || this.bots.pending?.length)); }

  async scheduleTick() {
    if (!this.botsPlaying()) return;
    const cur = await this.state.storage.getAlarm();
    const at = Date.now() + BOT_TICK;
    if (!cur || cur > at) await this.state.storage.setAlarm(at);
  }

  tickBots() {
    if (!this.botsPlaying()) return;
    if (!this.botNet?.g.world) { this.bots.update(Math.min(1, (Date.now() - (this.lastTick || Date.now())) / 1000)); this.lastTick = Date.now(); return; }
    const now = Date.now();
    const dt = Math.min(1, (now - (this.lastTick || now)) / 1000);
    this.lastTick = now;
    // (a server has time to spare: let the bots read their putts in a few steps)
    for (let k = 0; k < 4; k++) this.bots.update(k === 0 ? dt : 0);
  }

  /** Game messages the server listens in on, to keep its bots in step with the round. */
  watch(from, msg) {
    if (from !== this.hostId) return;
    if (msg.t === 'start' && typeof msg.seed === 'string') {
      const length = msg.length === 9 ? 9 : 18;
      this.round = { seed: msg.seed.slice(0, 40), length, holes: roundHoles(length), index: 0 };
      for (const b of this.botHost().list) { b.total = 0; b.mod = b.nextMod = 1; }
      this.bots.totals = new Map();
      this.botsToHole();
    } else if (msg.t === 'next' && this.round && Number.isInteger(msg.hole)) {
      this.round.index = msg.hole;
      this.botsToHole();
    } else if (msg.t === 'go' && Array.isArray(msg.ids)) {
      this.botHost().go(msg.ids);
    }
  }

  async fetch(req) {
    if (req.headers.get('Upgrade') !== 'websocket') return new Response('expected websocket', { status: 426 });
    const url = new URL(req.url);
    // A code only exists once someone has made the room (/new); a stranger's
    // guess at a code is turned away rather than quietly opening a new room
    if (!this.created && url.searchParams.get('create') !== '1') {
      const pair = new WebSocketPair();
      const [client, server] = Object.values(pair);
      server.accept();
      server.send('{"t":"nope"}');
      server.close(4000, 'no such room');
      return new Response(null, { status: 101, webSocket: client });
    }
    if (!this.created) { this.created = Date.now(); await this.save(); }
    const pair = new WebSocketPair();
    const [client, server] = Object.values(pair);
    // Hibernatable: the object sleeps between messages and is billed nothing while it waits
    this.state.acceptWebSocket(server);
    server.serializeAttachment({ id: null, heard: Date.now() });
    await this.state.storage.setAlarm(Date.now() + SWEEP_EVERY);
    return new Response(null, { status: 101, webSocket: client });
  }

  sockets() { return this.state.getWebSockets(); }
  socketOf(id) { return this.sockets().find((ws) => ws.deserializeAttachment()?.id === id) || null; }

  send(ws, msg) { try { ws.send(JSON.stringify(msg)); } catch { /* gone */ } }
  broadcast(msg, except = null) { for (const ws of this.sockets()) if (ws !== except && ws.deserializeAttachment()?.id) this.send(ws, msg); }

  async save() { await this.state.storage.put('room', { players: [...this.players.entries()], hostId: this.hostId, seq: this.seq, created: this.created, round: this.round }); }

  async shareRoster() {
    this.broadcast({ t: 'roster', players: [...this.players.values()], hostId: this.hostId });
    await this.save();
  }

  async webSocketMessage(ws, raw) {
    let msg;
    try { msg = JSON.parse(raw); } catch { return; }
    if (!msg || typeof msg !== 'object') return;
    const att = ws.deserializeAttachment() || {};
    att.heard = Date.now();
    ws.serializeAttachment(att);
    if (msg.t === 'ping') return;

    if (msg.t === 'hello') {
      if (att.id) return;
      let id = typeof msg.id === 'string' && this.players.has(msg.id) && !this.players.get(msg.id).bot ? msg.id : null;
      if (id) {
        // Back after a dropped connection: the same seat, and any older socket for it goes
        const old = this.socketOf(id);
        if (old && old !== ws) { try { old.close(1000, 'replaced'); } catch { /* fine */ } }
        const p = this.players.get(id);
        p.look = msg.look ?? p.look; p.build = String(msg.build || p.build || '');
      } else {
        // A full room gives a bot's seat to a person
        if (this.players.size >= MAX_PLAYERS) {
          const bot = [...this.players.values()].find((p) => p.bot);
          if (!bot) { this.send(ws, { t: 'full' }); ws.close(4001, 'full'); return; }
          this.players.delete(bot.id);
          this.bots?.remove(bot.id);
          this.broadcast({ t: 'bot:dropped', id: bot.id });
        }
        id = this.hostId ? `p-${(++this.seq).toString(36)}${Math.random().toString(36).slice(2, 5)}` : 'host';
        if (!this.hostId) this.hostId = id;
        this.players.set(id, { id, host: id === this.hostId, look: msg.look, build: String(msg.build || '') });
      }
      att.id = id;
      ws.serializeAttachment(att);
      // A person who shares a bot's name keeps it; the bot takes another
      const mine = String(this.players.get(id)?.look?.name || '').toLowerCase();
      for (const p of this.players.values()) {
        if (!p.bot || String(p.look?.name || '').toLowerCase() !== mine) continue;
        const taken = new Set([...this.players.values()].map((q) => String(q.look?.name || '').toLowerCase()));
        const free = NAMES.find((n) => !taken.has(n.toLowerCase()));
        if (free) p.look = { ...p.look, name: free };
      }
      this.send(ws, { t: 'welcome', id, hostId: this.hostId });
      await this.shareRoster();
      return;
    }
    if (!att.id) return;

    // Host-only: seating bots, and speaking for them
    if (att.id === this.hostId) {
      if (msg.t === 'bot:add' && this.players.size < MAX_PLAYERS) {
        const level = BOT_LEVELS[msg.level] ? msg.level : 'par';
        const bots = this.botHost();
        const b = bots.add(level);
        const taken = [...this.players.values()].map((p) => p.look?.name);
        this.players.set(b.id, { id: b.id, host: false, bot: true, level, look: botLook(bots.list.length, taken) });
        await this.shareRoster();
        // Joining mid-round: straight onto the current hole
        if (this.round) this.botsToHole();
        return;
      }
      if (msg.t === 'bot:remove' && this.players.get(msg.id)?.bot) {
        this.players.delete(msg.id);
        this.bots?.remove(msg.id);
        await this.shareRoster(); return;
      }
      if (msg.t === 'as' && typeof msg.id === 'string' && this.players.get(msg.id)?.bot && msg.msg && typeof msg.msg === 'object') {
        this.broadcast({ ...msg.msg, from: msg.id }, ws); return;
      }
    }
    if (msg.t === 'bot:add' || msg.t === 'bot:remove' || msg.t === 'as' || msg.t === 'roster' || msg.t === 'welcome' || msg.t === 'host') return;
    // Everything else is game traffic: pass it on, stamped with who sent it
    this.broadcast({ ...msg, from: att.id }, ws);
    this.watch(att.id, msg);
    // The bots listen to the room too, and answer back
    if ((msg.t === 'hap' || msg.t === 'bonk' || msg.t === 'card' || msg.t === 'done' || msg.t === 'knock' || msg.t === 'say') && this.bots?.list.length) { this.bots.heard(att.id, msg); this.scheduleTick(); }
  }

  /** A deliberate leave (the app closes with 'bye') gives the seat up at once; a dropped
   *  connection keeps it for a while, in case the phone comes back. */
  async webSocketClose(ws, code, reason) { await this.drop(ws, reason !== 'bye'); }
  async webSocketError(ws) { await this.drop(ws, true); }

  /**
   * A socket went. graceful: the player may be back in a moment (a phone in a
   * pocket), so their seat is kept until the sweep finds nobody on it.
   */
  async drop(ws, graceful = false) {
    const id = ws.deserializeAttachment()?.id;
    if (!id || !this.players.has(id)) return;
    if (graceful) return; // the sweep will decide
    await this.remove(id);
  }

  async remove(id) {
    if (!this.players.has(id)) return;
    this.players.delete(id);
    if (id === this.hostId) {
      // The host has really gone: the room carries on under the next person in
      const next = [...this.players.values()].find((p) => !p.bot);
      this.hostId = next?.id ?? null;
      for (const p of this.players.values()) p.host = p.id === this.hostId;
      if (next) this.broadcast({ t: 'host', id: next.id });
      // (the bots stay: they live here, not on anyone's phone)
    }
    await this.shareRoster();
  }

  /** Sweep: seats whose socket has been silent (or gone) too long are given up. */
  async alarm() {
    const now = Date.now();
    // Bots step every BOT_TICK; the sweep runs every SWEEP_EVERY
    if (this.round && !this.botNet?.g.world) this.botsToHole(); // (after an eviction)
    this.tickBots();
    if (this.nextSweep && now < this.nextSweep) { await this.rearm(now); return; }
    this.nextSweep = now + SWEEP_EVERY;
    const live = new Set();
    for (const ws of this.sockets()) {
      const att = ws.deserializeAttachment();
      if (!att?.id) continue;
      if (now - att.heard > GONE_AFTER) { try { ws.close(1000, 'quiet'); } catch { /* already */ } continue; }
      live.add(att.id);
    }
    for (const p of [...this.players.values()]) {
      if (p.bot) continue;
      if (!live.has(p.id)) {
        p.lostAt ??= now;
        if (now - p.lostAt > GONE_AFTER) await this.remove(p.id);
      } else delete p.lostAt;
    }
    const humans = [...this.players.values()].filter((p) => !p.bot).length;
    if (humans) { this.emptySince = null; await this.rearm(now); }
    else if (!this.emptySince) { this.emptySince = now; this.round = null; await this.state.storage.setAlarm(now + KEEP_EMPTY); }
    else if (now - this.emptySince >= KEEP_EMPTY) { this.players.clear(); this.hostId = null; this.created = null; this.round = null; this.bots = null; await this.state.storage.deleteAll(); }
    else await this.state.storage.setAlarm(this.emptySince + KEEP_EMPTY);
  }

  /** The next alarm: the next bot step if bots are playing, else the next sweep. */
  async rearm(now) {
    const sweep = this.nextSweep || now + SWEEP_EVERY;
    await this.state.storage.setAlarm(this.botsPlaying() ? Math.min(sweep, now + BOT_TICK) : sweep);
  }
}

/** The Worker: `/new` mints a code and opens its room; `/room/ABCD` upgrades to that room's object. */
export default {
  async fetch(req, env) {
    const url = new URL(req.url);
    const cors = { 'Access-Control-Allow-Origin': '*' };
    if (url.pathname === '/new') {
      // A code nobody is using (the object knows if it has been created)
      let code = '';
      for (let i = 0; i < 4; i++) code += LETTERS[Math.floor(Math.random() * LETTERS.length)];
      return Response.json({ code }, { headers: cors });
    }
    const m = url.pathname.match(/^\/room\/([A-Z]{4})$/);
    if (!m) return new Response('ThreeWood rooms', { status: 200, headers: cors });
    const stub = env.ROOMS.get(env.ROOMS.idFromName(m[1]));
    return stub.fetch(req);
  },
};
