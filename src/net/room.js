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
const RECONNECT_FOR = 25000; // a phone put away comes back and picks up its seat

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
    this.pulse = setInterval(() => this.beat(), PING_EVERY);
  }

  get isHost() { return !!this.me.id && this.me.id === this.hostId; }

  beat() { if (!this.closed && this.ws?.readyState === 1) this.ws.send('{"t":"ping"}'); }

  /** Back from the pocket: make sure the socket is alive, reconnect if not. */
  wake() {
    if (this.closed || !this.code) return;
    if (this.ws?.readyState === 1) this.beat(); else this.connect();
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
      this.lostAt = null;
      // Say who we are (again, after a reconnect: the server gives the seat back by id)
      ws.send(JSON.stringify({ t: 'hello', look: this.me.look, build: this.me.build, id: this.me.id || undefined }));
    };
    ws.onmessage = (ev) => {
      let msg;
      try { msg = JSON.parse(ev.data); } catch { return; }
      if (!msg || typeof msg !== 'object') return;
      switch (msg.t) {
        case 'welcome': {
          const first = !this.me.id;
          this.me.id = msg.id;
          this.hostId = msg.hostId ?? this.hostId;
          this.me.host = this.me.id === this.hostId;
          if (first) this.on.open?.(this.code);
          for (const m of this.outbox.splice(0)) this.send(m);
          return;
        }
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
      setTimeout(() => this.connect(), 1500);
    };
    ws.onerror = () => { /* onclose follows */ };
  }

  /** Send to everyone else in the room. */
  send(msg) {
    if (this.closed) return;
    if (this.ws?.readyState === 1 && this.me.id) this.ws.send(JSON.stringify(msg));
    else this.outbox.push(msg);
  }

  /** Host: send a message on behalf of a bot, so the others see it as that player's. */
  sendAs(id, msg) { if (this.isHost) this.send({ t: 'as', id, msg }); }

  /** Host: seat a bot (or take one away); the server shares the new roster. */
  addBot(id, look, level) {
    if (!this.isHost || this.players.length >= MAX_PLAYERS) return false;
    this.send({ t: 'bot:add', id, look, level });
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
    try { this.ws?.close(1000, 'bye'); } catch { /* already gone */ }
  }
}
