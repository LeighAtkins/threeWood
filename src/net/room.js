/**
 * A room: a handful of friends on the same course, found by a four-letter code.
 *
 * Peer-to-peer over WebRTC (PeerJS; its public broker only introduces the
 * peers, the game data goes directly between phones). The player who makes
 * the room is the hub: guests talk to the host and the host passes everything
 * on, so every message reaches everyone exactly once.
 *
 * This file knows nothing about golf. It keeps the roster and delivers
 * messages; net/netplay.js decides what they mean.
 */

import { Peer } from 'peerjs';

const PREFIX = 'threewood-room-';
const LETTERS = 'ABCDEFGHJKLMNPQRSTUVWXYZ'; // no I or O: they read as digits
const MAX_PLAYERS = 4;
const PING_EVERY = 3000;  // a closed tab does not always say goodbye:
const GONE_AFTER = 40000; // silence this long means they have left (a phone
                          // that was put away for a moment gets to come back)

export const makeCode = () => Array.from({ length: 4 }, () => LETTERS[Math.floor(Math.random() * LETTERS.length)]).join('');
export const cleanCode = (text) => String(text || '').toUpperCase().replace(/[^A-Z]/g, '').slice(0, 4);

export class Room {
  /**
   * @param {object} me     what the others see of this player ({ look })
   * @param {object} on     { open(code), roster(players), message(from, msg), closed(reason) }
   */
  constructor(me, on) {
    this.me = { id: null, host: false, ...me };
    this.on = on;
    this.players = [];
    this.conns = new Map(); // host: id -> connection
    this.hostConn = null;   // guest: the connection to the host
    this.code = null;
    this.isHost = false;
    this.closed = false;
    this.heard = new Map(); // id -> when we last heard from them
    this.pulse = setInterval(() => this.beat(), PING_EVERY);
  }

  /** Say we are still here, and notice anyone who has gone quiet. */
  beat() {
    if (this.closed) return;
    const now = Date.now();
    if (this.isHost) {
      for (const [id, conn] of this.conns) {
        if (conn.open) conn.send({ t: 'ping' });
        if (now - (this.heard.get(id) ?? now) > GONE_AFTER) { conn.close(); this.drop(id); }
      }
    } else if (this.hostConn?.open) {
      this.hostConn.send({ t: 'ping' });
      if (now - (this.heard.get('host') ?? now) > GONE_AFTER) this.fail('The host left the room.');
    }
  }

  /** Back from the pocket: say hello straight away rather than at the next beat. */
  wake() {
    if (this.closed) return;
    const now = Date.now();
    if (this.isHost) { for (const id of this.conns.keys()) this.heard.set(id, Math.max(this.heard.get(id) || 0, now - 5000)); }
    else this.heard.set('host', Math.max(this.heard.get('host') || 0, now - 5000));
    this.beat();
  }

  /** Host: a guest is gone. */
  drop(id) {
    if (!this.conns.delete(id)) return;
    this.heard.delete(id);
    this.players = this.players.filter((p) => p.id !== id);
    this.shareRoster();
  }

  /** Make a room and wait for friends. */
  host(tries = 0) {
    this.isHost = true;
    this.code = makeCode();
    const peer = this.peer = new Peer(PREFIX + this.code);
    peer.on('open', () => {
      this.me.id = 'host';
      this.me.host = true;
      this.players = [this.me];
      this.on.open?.(this.code);
      this.on.roster?.(this.players);
    });
    peer.on('connection', (conn) => this.accept(conn));
    peer.on('error', (err) => {
      if (err.type === 'unavailable-id' && tries < 5) { peer.destroy(); this.host(tries + 1); return; }
      this.fail(err.type === 'unavailable-id' ? 'Could not make a room. Try again.' : 'Connection problem.');
    });
    peer.on('disconnected', () => { if (!this.closed) peer.reconnect(); });
  }

  /** Host: a guest has knocked. */
  accept(conn) {
    conn.on('open', () => {
      if (this.players.length >= MAX_PLAYERS) { conn.send({ t: 'full' }); setTimeout(() => conn.close(), 300); return; }
      this.conns.set(conn.peer, conn);
      this.heard.set(conn.peer, Date.now());
    });
    conn.on('data', (msg) => {
      if (!msg || typeof msg !== 'object') return;
      this.heard.set(conn.peer, Date.now());
      if (msg.t === 'ping') return;
      if (msg.t === 'hello') {
        if (!this.conns.has(conn.peer) || this.players.some((p) => p.id === conn.peer)) return;
        this.players = [...this.players, { id: conn.peer, host: false, look: msg.look, build: String(msg.build || '') }];
        this.shareRoster();
        return;
      }
      // Pass it on to everyone else, then hear it ourselves
      for (const [id, other] of this.conns) if (id !== conn.peer && other.open) other.send({ ...msg, from: conn.peer });
      this.on.message?.(conn.peer, msg);
    });
    const gone = () => this.drop(conn.peer);
    conn.on('close', gone);
    conn.on('error', gone);
  }

  shareRoster() {
    const msg = { t: 'roster', players: this.players };
    for (const conn of this.conns.values()) if (conn.open) conn.send(msg);
    this.on.roster?.(this.players);
  }

  /** Join the room with this code. */
  join(code) {
    this.code = cleanCode(code);
    const peer = this.peer = new Peer();
    peer.on('open', (id) => {
      this.me.id = id;
      const conn = this.hostConn = peer.connect(PREFIX + this.code, { reliable: true });
      conn.on('open', () => {
        conn.send({ t: 'hello', look: this.me.look, build: this.me.build });
        this.heard.set('host', Date.now());
        this.on.open?.(this.code);
      });
      conn.on('data', (msg) => {
        if (!msg || typeof msg !== 'object') return;
        this.heard.set('host', Date.now());
        if (msg.t === 'ping') return;
        if (msg.t === 'roster') { this.players = msg.players; this.on.roster?.(this.players); return; }
        if (msg.t === 'full') { this.fail('That room is full.'); return; }
        this.on.message?.(msg.from || 'host', msg);
      });
      conn.on('close', () => this.fail('The host left the room.'));
    });
    peer.on('error', (err) => this.fail(err.type === 'peer-unavailable' ? 'No room with that code.' : 'Connection problem.'));
  }

  /** Send to everyone else in the room. */
  send(msg) {
    if (this.closed) return;
    if (this.isHost) {
      for (const conn of this.conns.values()) if (conn.open) conn.send({ ...msg, from: 'host' });
    } else if (this.hostConn?.open) {
      this.hostConn.send(msg);
    }
  }

  fail(reason) {
    if (this.closed) return;
    this.leave();
    this.on.closed?.(reason);
  }

  leave() {
    this.closed = true;
    clearInterval(this.pulse);
    try { this.peer?.destroy(); } catch { /* already gone */ }
  }
}
