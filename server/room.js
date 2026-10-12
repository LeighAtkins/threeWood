/**
 * ThreeWood room server: one Durable Object per room, on Cloudflare.
 *
 * NOT DEPLOYED YET. This is the server half of "online play over servers",
 * written to the message protocol the game already speaks (src/net/room.js
 * and src/net/netplay.js), so the client side is a small swap: a Room that
 * opens one WebSocket here instead of a PeerJS mesh. Everything the host's
 * phone does today as the hub (hello/roster, relaying with a `from` stamp,
 * heartbeats, dropping the quiet) this object does instead, so:
 *   - a room survives the host putting their phone away;
 *   - every phone sees the same roster from one source;
 *   - bots can move here later, so they keep playing if the host drops.
 *
 * Deploy: `npx wrangler deploy` with the wrangler.toml beside this file.
 * Cost: the Workers paid plan ($5/month) covers far more rooms than 10,000
 * players need, because the object hibernates between messages.
 */

const MAX_PLAYERS = 8;
const LETTERS = 'ABCDEFGHJKLMNPQRSTUVWXYZ';
const GONE_AFTER = 40_000;

export class RoomObject {
  constructor(state, env) {
    this.state = state;
    this.env = env;
    this.players = new Map(); // id -> { id, host, look, build, bot?, level? }
    this.hostId = null;
    this.seq = 0;
    this.state.blockConcurrencyWhile(async () => {
      const saved = await this.state.storage.get('players');
      if (saved) { this.players = new Map(saved); this.hostId = [...this.players.values()].find((p) => p.host)?.id ?? null; }
    });
  }

  async fetch(req) {
    if (req.headers.get('Upgrade') !== 'websocket') return new Response('expected websocket', { status: 426 });
    const pair = new WebSocketPair();
    const [client, server] = Object.values(pair);
    // Hibernatable: the object sleeps between messages and is billed nothing while it waits
    this.state.acceptWebSocket(server);
    server.serializeAttachment({ id: null, heard: Date.now() });
    return new Response(null, { status: 101, webSocket: client });
  }

  sockets() { return this.state.getWebSockets(); }
  idOf(ws) { return ws.deserializeAttachment()?.id ?? null; }

  send(ws, msg) { try { ws.send(JSON.stringify(msg)); } catch { /* gone */ } }
  broadcast(msg, except = null) { for (const ws of this.sockets()) if (ws !== except) this.send(ws, msg); }

  async save() { await this.state.storage.put('players', [...this.players.entries()]); }

  async shareRoster() {
    const players = [...this.players.values()];
    this.broadcast({ t: 'roster', players });
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
      // The first one in hosts; the rest are guests; a full room gives a bot's seat to a person
      if (this.players.size >= MAX_PLAYERS) {
        const bot = [...this.players.values()].find((p) => p.bot);
        if (!bot) { this.send(ws, { t: 'full' }); ws.close(1000, 'full'); return; }
        this.players.delete(bot.id);
      }
      const id = this.hostId ? `p-${(++this.seq).toString(36)}-${Math.random().toString(36).slice(2, 6)}` : 'host';
      const player = { id, host: id === 'host', look: msg.look, build: String(msg.build || '') };
      if (player.host) this.hostId = id;
      this.players.set(id, player);
      att.id = id;
      ws.serializeAttachment(att);
      this.send(ws, { t: 'welcome', id, code: this.code });
      await this.shareRoster();
      return;
    }
    if (!att.id) return;

    // Host-only room management (bots live on the host's phone for now)
    if (att.id === this.hostId) {
      if (msg.t === 'bot:add' && this.players.size < MAX_PLAYERS && typeof msg.id === 'string') {
        this.players.set(msg.id, { id: msg.id, host: false, bot: true, level: msg.level, look: msg.look });
        await this.shareRoster(); return;
      }
      if (msg.t === 'bot:remove') { this.players.delete(msg.id); await this.shareRoster(); return; }
      if (msg.t === 'as' && typeof msg.id === 'string' && this.players.get(msg.id)?.bot) {
        // A bot's message, relayed under the bot's id
        this.broadcast({ ...msg.msg, from: msg.id }, ws); return;
      }
    }
    // Everything else is game traffic: pass it on, stamped with who sent it
    this.broadcast({ ...msg, from: att.id }, ws);
  }

  async webSocketClose(ws) { await this.drop(ws); }
  async webSocketError(ws) { await this.drop(ws); }

  async drop(ws) {
    const id = this.idOf(ws);
    if (!id || !this.players.has(id)) return;
    this.players.delete(id);
    if (id === this.hostId) {
      // The host left: the room carries on under the next person in
      const next = [...this.players.values()].find((p) => !p.bot);
      this.hostId = next?.id ?? null;
      if (next) { next.host = true; this.broadcast({ t: 'host', id: next.id }); }
    }
    await this.shareRoster();
    if (!this.players.size) await this.state.storage.deleteAll();
  }

  /** Sweep the silent (a closed tab does not always say goodbye). */
  async alarm() {
    const now = Date.now();
    for (const ws of this.sockets()) {
      const att = ws.deserializeAttachment();
      if (att && now - att.heard > GONE_AFTER) { try { ws.close(1000, 'quiet'); } catch { /* already */ } await this.drop(ws); }
    }
    if (this.players.size) await this.state.storage.setAlarm(now + 15_000);
  }
}

/** The Worker: `/room/ABCD` upgrades to that room's object; `/new` mints a code. */
export default {
  async fetch(req, env) {
    const url = new URL(req.url);
    if (url.pathname === '/new') {
      let code = '';
      for (let i = 0; i < 4; i++) code += LETTERS[Math.floor(Math.random() * LETTERS.length)];
      return Response.json({ code });
    }
    const m = url.pathname.match(/^\/room\/([A-Z]{4})$/);
    if (!m) return new Response('not found', { status: 404 });
    const id = env.ROOMS.idFromName(m[1]);
    const stub = env.ROOMS.get(id);
    return stub.fetch(req);
  },
};
