/**
 * A room: a handful of friends on the same course, found by a four-letter code.
 *
 * Every phone holds one WebSocket to the room server (server/room.js, a
 * Cloudflare Durable Object: one object per code). The server keeps the
 * roster, stamps every message with who sent it and passes it on, so every
 * message reaches everyone exactly once, and the room outlives any one phone:
 * if the host drops, the next person in becomes host.
 *
 * This file knows nothing about golf. It keeps the roster and delivers
 * messages; net/netplay.js decides what they mean. The API is the one the
 * old peer-to-peer room had, so netplay did not have to change.
 */

const SERVER = (import.meta.env?.VITE_ROOM_SERVER || 'wss://rooms.threewood.app').replace(/\/$/, '');
const LETTERS = 'ABCDEFGHJKLMNPQRSTUVWXYZ'; // no I or O: they read as digits
export const MAX_PLAYERS = 8;
const PING_EVERY = 5000;     // keep the socket (and the server's quiet-sweep) fed
const RECONNECT_FOR = 170000; // a phone put away comes back and picks up its seat (the server keeps it 3 min)
const DEAD_AFTER = 12000;    // nothing heard for this long (the server answers every ping): the socket is dead

export const cleanCode = (text) => String(text || '').toUpperCase().replace(/[^A-Z]/g, '').replace(/[IO]/g, '').slice(0, 4);

export class Room {
  /**
   * @param {object} me     what the others see of this player ({ look, build })
   * @param {object} on     { open(code), roster(players), message(from, msg), closed(reason), botDropped(id) }
   */
  constructor(me, on) {
    this.me = { id: null, host: false, ...me };
    this.on = on;
    this.players = [];
    this.code = null;
    this.hostId = null;
    this.closed = false;
    this.ws = null;
    this.outbox = [];
    this.lastSeq = 0;     // the last numbered message heard (a reconnect asks for what came after)
    this.heardAt = Date.now();
    this.pulse = setInterval(() => this.beat(), PING_EVERY);
    // A socket can die without closing (a phone switching network, or put
    // away): the server answers every ping, so silence means it is gone
    this.watch = setInterval(() => {
      if (this.closed || !this.code || this.ws?.readyState !== 1) return;
      if (Date.now() - this.heardAt > DEAD_AFTER) this.reconnect();
    }, 2000);
  }

  /** Drop this socket and get back in (the seat is kept; what was missed is sent). */
  reconnect() {
    const old = this.ws;
    this.ws = null;
    try { old?.close(4100, 'stale'); } catch { /* already */ }
    this.lostAt ??= Date.now();
    this.on.status?.('reconnecting');
    this.connect();
  }

  get isHost() { return !!this.me.id && this.me.id === this.hostId; }

  beat() { if (!this.closed && this.ws?.readyState === 1) this.ws.send('{"t":"ping"}'); }

  /** Back from the pocket: make sure the socket is alive, reconnect if not. */
  wake() {
    if (this.closed || !this.code) return;
    if (this.ws?.readyState === 1) {
      // (it may have died while the phone was away: a ping must be answered soon)
      this.beat();
      this.heardAt = Math.min(this.heardAt, Date.now() - DEAD_AFTER + 4000);
    } else this.connect();
  }

  /** Make a room and wait for friends. */
  async host() {
    try {
      const res = await fetch(`${SERVER.replace(/^ws/, 'http')}/new`);
      const { code } = await res.json();
      this.code = cleanCode(code) || this.localCode();
    } catch {
      this.code = this.localCode();
    }
    this.connect(true);
  }

  localCode() { return Array.from({ length: 4 }, () => LETTERS[Math.floor(Math.random() * LETTERS.length)]).join(''); }

  /** Join the room with this code. */
  join(code) {
    this.code = cleanCode(code);
    this.connect();
  }

  connect(create = false) {
    if (this.closed) return;
    let ws;
    try { ws = new WebSocket(`${SERVER}/room/${this.code}${create ? '?create=1' : ''}`); } catch { this.fail('Connection problem.'); return; }
    this.ws = ws;
    this.lostAt = this.lostAt ?? null;
    ws.onopen = () => {
      // Say who we are (again, after a reconnect: the server gives the seat back by id)
      this.heardAt = Date.now();
      ws.send(JSON.stringify({ t: 'hello', look: this.me.look, build: this.me.build, id: this.me.id || undefined, since: this.me.id ? this.lastSeq : undefined }));
    };
    ws.onmessage = (ev) => {
      let msg;
      try { msg = JSON.parse(ev.data); } catch { return; }
      if (!msg || typeof msg !== 'object') return;
      if (this.ws !== ws) return; // (a socket we have already given up on)
      this.heardAt = Date.now();
      if (Number.isFinite(msg.seq)) {
        if (msg.seq <= this.lastSeq && msg.from) return; // (already had it)
        if (msg.from) this.lastSeq = msg.seq;
      }
      switch (msg.t) {
        case 'welcome': {
          const first = !this.me.id;
          if (first && Number.isFinite(msg.seq)) this.lastSeq = msg.seq; // (a newcomer starts from now)
          this.me.id = msg.id;
          this.hostId = msg.hostId ?? this.hostId;
          this.me.host = this.me.id === this.hostId;
          if (first) this.on.open?.(this.code);
          else { this.lostAt = null; this.on.status?.('back'); }
          for (const m of this.outbox.splice(0)) this.send(m);
          return;
        }
        case 'pong': return;
        case 'gap': this.on.status?.('gap'); return;
        case 'roster':
          this.players = Array.isArray(msg.players) ? msg.players : [];
          if (msg.hostId) this.hostId = msg.hostId;
          this.me.host = this.isHost;
          this.on.roster?.(this.players);
          return;
        case 'host':
          this.hostId = msg.id;
          this.me.host = this.isHost;
          this.on.roster?.(this.players);
          return;
        case 'full': this.fail('That room is full.'); return;
        case 'nope': this.fail('No room with that code.'); return;
        case 'bot:dropped': this.on.botDropped?.(msg.id); return;
        case 'ping': return;
        default:
          this.on.message?.(msg.from || this.hostId, msg);
      }
    };
    ws.onclose = (ev) => {
      if (this.closed || this.ws !== ws) return;
      if (ev.code === 4000) { this.fail('No room with that code.'); return; }
      if (ev.code === 4001) { this.fail('That room is full.'); return; }
      // Try to get back in for a while before giving up
      this.lostAt ??= Date.now();
      if (Date.now() - this.lostAt > RECONNECT_FOR) { this.fail('Lost the room.'); return; }
      this.on.status?.('reconnecting');
      setTimeout(() => { if (!this.closed && (this.ws === ws || !this.ws)) this.connect(); }, 1500);
    };
    ws.onerror = () => { /* onclose follows */ };
  }

  /** Send to everyone else in the room. */
  send(msg) {
    if (this.closed) return;
    if (this.ws?.readyState === 1 && this.me.id) this.ws.send(JSON.stringify(msg));
    else this.outbox.push(msg);
  }

  /** Host: seat a bot (or take one away); the server plays it and shares the new roster. */
  addBot(level) {
    if (!this.isHost || this.players.length >= MAX_PLAYERS) return false;
    this.send({ t: 'bot:add', level });
    return true;
  }

  removeBot(id) { if (this.isHost) this.send({ t: 'bot:remove', id }); }

  fail(reason) {
    if (this.closed) return;
    this.leave();
    this.on.closed?.(reason);
  }

  leave() {
    this.closed = true;
    clearInterval(this.pulse);
    clearInterval(this.watch);
    try { this.ws?.close(1000, 'bye'); } catch { /* already gone */ }
  }
}
