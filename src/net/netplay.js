/**
 * Playing a round with friends in a room.
 *
 * Everyone plays the same course on their own phone, their own ball, at the
 * same time. What keeps it a shared round rather than four solo ones:
 *
 *   - you see the others: their campers walk to their balls, their shots fly;
 *   - shots are taken together. Tap the button to say you are READY; when
 *     everyone still playing the hole is ready the room says GO and you all
 *     swing. (Nobody is held up for ever: half a minute after the first
 *     player is ready, the ready ones go.)
 *   - the next hole starts for everybody at once.
 *
 * The host's phone decides GO and NEXT; everything else is each player
 * reporting what they did. Game hooks call in here; this calls back into Game
 * for the few things that change (starting a round, moving to the next hole).
 */

import { Room, cleanCode } from './room.js';
import { Others } from '../render/others.js';
import { cleanLook } from '../core/camp.js';
import { generateSeed, cleanSeed } from '../core/rng.js';
import { BUILD, isStale, reloadFresh } from './fresh.js';

const WAIT_LIMIT = 30;  // seconds the ready players wait for the rest
const NEXT_DELAY = 8;   // seconds on the result card once everyone has finished

const KINDS = ['wood', 'iron', 'putter'];
const POSES = ['perch', 'perchWarm', 'sit', 'warm', 'peace', 'cheer', 'hello', 'wave'];
export const EMOTES = ['👏', '😂', '😱', '🔥'];
const num = (v, lo, hi, d = 0) => (Number.isFinite(+v) ? Math.max(lo, Math.min(hi, +v)) : d);
const vsPar = (n) => (n === 0 ? 'E' : n > 0 ? `+${n}` : `${n}`);

export class NetPlay {
  constructor(game) {
    this.g = game;
    const { root, layer } = game.hud;
    this.others = new Others(game.scene, root, layer);
    this.pill = document.createElement('div');
    this.pill.className = 'net-pill hidden';
    root.insertBefore(this.pill, layer);
    this.lobby = document.createElement('div');
    this.lobby.className = 'overlay dim hidden';
    root.appendChild(this.lobby);
    this.room = null;
    this.inRound = false;
    this.players = [];
    this.status = new Map();  // id -> aim | ready | busy | done
    this.scores = new Map();  // id -> { total, strokes }
    this.cleared = false;     // this volley: I may swing
    this.waitT = null;        // host: seconds since the first player was ready
    this.nextT = null;        // host: seconds since everyone finished the hole
    this.error = '';
    // Contests: who won the last hole (crown), and how many each has won
    this.crown = null;
    this.nextCrown = null;
    this.crownNews = null;
    this.crowns = new Map();
    this.judged = new Set();
    // Watch mode: follow a friend's ball while it flies
    this.watching = null;
    this.watchIdle = 0;
    this.emotesOpen = 0; // seconds the emote row stays open after the 💬 tap
    this.myPose = null;  // by the fire: my pose, said again now and then
    this.poseT = 0;
  }

  /** In a round with at least the room open. */
  get active() { return !!this.room && this.inRound; }
  get friends() { return this.players.filter((p) => p.id !== this.room?.me.id); }
  get myId() { return this.room?.me.id; }

  // ===========================================================================
  // Lobby
  // ===========================================================================

  async openLobby(code = '') {
    this.g.hud.clearLayer();
    this.lobby.classList.remove('hidden');
    this.renderLobby(cleanCode(code));
    // A tab left open for days is running old code: fetch the new one first,
    // or friends on different builds talk past each other
    if (!this.room && await isStale()) { reloadFresh(cleanCode(code)); return; }
    if (code && !this.room) this.join(code);
  }

  closeLobby() { this.lobby.classList.add('hidden'); this.lobby.innerHTML = ''; }

  connect() {
    this.error = '';
    this.room = new Room({ look: cleanLook(this.g.camp.look), build: BUILD }, {
      open: () => this.renderLobby(),
      roster: (players) => this.onRoster(players),
      message: (from, msg) => this.onMessage(from, msg),
      closed: (reason) => {
        const wasPlaying = this.inRound;
        this.reset();
        this.error = reason;
        if (wasPlaying) this.g.hud.callout(reason.toUpperCase(), 'bad small'); // carry on alone
        else if (!this.lobby.classList.contains('hidden')) this.renderLobby();
      },
    });
    return this.room;
  }

  create() { this.connect().host(); this.renderLobby(); }

  join(code) {
    const clean = cleanCode(code);
    if (clean.length !== 4) { this.error = 'A room code is 4 letters.'; this.renderLobby(clean); return; }
    this.connect().join(clean);
    this.renderLobby();
  }

  /** Leave the room entirely. */
  leave() {
    this.room?.leave();
    this.reset();
  }

  reset() {
    this.room = null;
    this.buildChecked = false;
    this.myPose = null;
    this.inRound = false;
    this.players = [];
    this.status.clear();
    this.scores.clear();
    this.cleared = false;
    this.waitT = this.nextT = null;
    this.others.clear();
    this.pill.classList.add('hidden');
    this.watching = null;
    this.crown = this.nextCrown = this.crownNews = null;
    this.crowns.clear();
    this.judged.clear();
    this.g.camper?.setCrown(false);
  }

  renderLobby(typed = '') {
    const room = this.room;
    const esc = (s) => String(s).replace(/[&<>"]/g, (c) => ({ '&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;' }[c]));
    let body;
    if (!room) {
      body = `
        <h2>PLAY WITH FRIENDS</h2>
        <p>Same course, same time. Everyone swings together.</p>
        <button class="btn" data-a="create">MAKE A ROOM</button>
        <div class="join-row"><input class="code" maxlength="4" placeholder="CODE" autocomplete="off" autocapitalize="characters" spellcheck="false" value="${esc(typed)}"><button class="btn ghost" data-a="join">JOIN</button></div>
        ${this.error ? `<p class="net-error">${esc(this.error)}</p>` : ''}
        <button class="btn ghost" data-a="back">BACK</button>`;
    } else if (!room.me.id || !this.players.length) {
      body = `<h2>PLAY WITH FRIENDS</h2><p>Connecting…</p><button class="btn ghost" data-a="leave">CANCEL</button>`;
    } else {
      const old = (p) => p.build && p.build !== BUILD;
      const list = this.players.map((p) => `<div class="net-player"><i></i>${esc(cleanLook(p.look).name)}${p.host ? ' <small>HOST</small>' : ''}${p.id === room.me.id ? ' <small>YOU</small>' : ''}${old(p) ? ' <small class="stale">NEEDS A REFRESH</small>' : ''}</div>`).join('');
      body = `
        <h2>ROOM CODE</h2>
        <h1 class="gold room-code">${esc(room.code)}</h1>
        <button class="btn ghost" data-a="share">SHARE THE LINK</button>
        <div class="net-list">${list}</div>
        ${room.isHost
          ? `<div class="btn-row"><button class="btn" data-a="go9">START 9</button><button class="btn" data-a="go18">START 18</button></div>`
          : `<p>Waiting for the host to start…</p>`}
        <button class="btn ghost" data-a="leave">LEAVE</button>`;
    }
    this.lobby.innerHTML = `<div class="card">${body}</div>`;
    this.lobby.onclick = async (e) => {
      const a = e.target.closest('[data-a]')?.dataset.a;
      if (!a) return;
      this.g.audio.unlock(); this.g.audio.tap();
      if (a === 'create') this.create();
      else if (a === 'join') this.join(this.lobby.querySelector('.code').value);
      else if (a === 'back') { this.closeLobby(); this.g.showTitle(); }
      else if (a === 'leave') { this.leave(); this.error = ''; this.renderLobby(); }
      else if (a === 'go9' || a === 'go18') this.startRound(a === 'go9' ? 9 : 18);
      else if (a === 'share') {
        const url = `${location.origin}${location.pathname}?room=${room.code}`;
        const text = `Play ThreeWood with me — room ${room.code}`;
        try {
          if (navigator.share) await navigator.share({ title: 'ThreeWood', text, url });
          else { await navigator.clipboard.writeText(`${text} ${url}`); e.target.textContent = 'LINK COPIED'; }
        } catch { /* cancelled */ }
      }
    };
  }

  // ===========================================================================
  // Room traffic
  // ===========================================================================

  onRoster(players) {
    this.players = players;
    this.checkBuilds();
    const ids = new Set(players.map((p) => p.id));
    for (const id of [...this.status.keys()]) if (!ids.has(id)) { this.status.delete(id); this.scores.delete(id); }
    for (const p of players) if (!this.status.has(p.id)) this.status.set(p.id, this.inRound ? 'aim' : 'aim');
    this.others.sync(this.friends);
    if (this.inRound && this.g.world) {
      for (const o of this.others.map.values()) if (!o.placed) this.others.toTee(this.g.world);
    }
    if (!this.lobby.classList.contains('hidden')) this.renderLobby();
    this.paint();
    this.judge();
  }

  /**
   * Everyone must be on the same build. If someone is not, whoever is behind
   * reloads into the new one (keeping the room code); the others are told.
   */
  async checkBuilds() {
    const odd = this.players.filter((p) => p.build && p.build !== BUILD);
    if (!odd.length || this.buildChecked) return;
    this.buildChecked = true;
    if (await isStale()) {
      const code = this.room?.code;
      if (!this.room?.isHost) { this.room?.leave(); reloadFresh(code); return; }
      this.g.hud.callout('NEW VERSION: REOPEN THE GAME', 'bad small');
    } else {
      this.g.hud.callout(`${odd.map((p) => cleanLook(p.look).name).join(', ')} NEEDS A REFRESH`, 'bad small');
    }
  }

  onMessage(from, msg) {
    const g = this.g;
    switch (msg.t) {
      case 'start':
        // (a seed from another phone is only ever letters, digits and dashes)
        if (from === 'host' && !this.room.isHost && cleanSeed(msg.seed)) this.begin(cleanSeed(msg.seed), msg.length === 9 ? 9 : 18);
        break;
      case 'at':
        this.status.set(from, 'aim');
        if (this.inRound && msg.hole === g.round?.index) this.others.at(from, g.world, num(msg.x, -400, 400), num(msg.z, -400, 400));
        this.others.setStatus(from, 'aim');
        break;
      case 'status':
        if (msg.s === 'ready' || msg.s === 'aim') { this.status.set(from, msg.s); this.others.setStatus(from, msg.s); this.others.setAim(from, +msg.aim, KINDS.includes(msg.kind) ? msg.kind : null); }
        if (msg.s === 'swing') this.others.swinging(from, +msg.aim, KINDS.includes(msg.kind) ? msg.kind : null);
        break;
      case 'pose':
        if (POSES.includes(msg.p)) this.others.pose(from, msg.p);
        break;
      case 'emote': {
        const i = EMOTES.indexOf(msg.e);
        if (i >= 0) { this.others.say(from, EMOTES[i]); g.hud.callout(`${this.nameOf(from)} ${EMOTES[i]}`, 'small'); }
        break;
      }
      case 'go':
        if (from === 'host') this.go(Array.isArray(msg.ids) ? msg.ids : []);
        break;
      case 'shot':
        if (this.inRound && msg.hole === g.round?.index) {
          const l = msg.launch || {};
          this.others.shot(from, g.world, {
            kind: msg.kind === 'putt' ? 'putt' : 'full', x: num(msg.x, -400, 400, NaN), z: num(msg.z, -400, 400, NaN),
            speed: num(msg.speed, 0, 30), dirX: num(msg.dirX, -1, 1), dirZ: num(msg.dirZ, -1, 1),
            launch: { speed: num(l.speed, 0, 120), dirX: num(l.dirX, -1, 1), dirZ: num(l.dirZ, -1, 1), loftDeg: num(l.loftDeg, 0, 80), back: num(l.back, -5, 5), side: num(l.side, -5, 5) },
          });
        }
        this.status.set(from, 'busy');
        this.others.setStatus(from, 'busy');
        break;
      case 'holed':
        this.others.holed(from);
        break;
      case 'done':
        this.status.set(from, 'done');
        this.others.setStatus(from, 'done');
        this.scores.set(from, { total: num(msg.total, -99, 199), strokes: num(msg.strokes, 0, 20), drive: num(msg.drive, 0, 400), pin: msg.pin == null ? null : num(msg.pin, 0, 400) });
        this.contest();
        break;
      case 'pot':
        // The shared hot pot
        if (typeof msg.k === 'string') g.nabe.add(msg.k, this.nameOf(from));
        break;
      case 'stir':
        g.nabe.friendStir(num(msg.a, 0, 0.5));
        break;
      case 'call':
        // A friend's big moment, shared
        g.hud.callout(`${this.nameOf(from)}: ${String(msg.text).slice(0, 24)}`, 'small');
        g.audio.applause(0.6);
        break;
      case 'next':
        if (from === 'host' && this.inRound && msg.hole === g.round?.index) g.nextHole?.();
        break;
      default:
        return;
    }
    this.paint();
    this.judge();
  }

  // ===========================================================================
  // The round
  // ===========================================================================

  /** Host: start a round for the whole room. */
  startRound(length) {
    if (!this.room?.isHost) return;
    const seed = generateSeed();
    this.room.send({ t: 'start', seed, length });
    this.begin(seed, length);
  }

  begin(seed, length) {
    this.inRound = true;
    this.scores.clear();
    this.closeLobby();
    this.g.startNetRound(seed, length);
  }

  /** A hole has loaded. */
  atHole() {
    if (!this.active) return;
    for (const p of this.players) this.status.set(p.id, 'aim');
    this.cleared = false;
    this.waitT = this.nextT = null;
    this.watching = null;
    this.others.sync(this.friends);
    this.others.toTee(this.g.world);
    // The crown passes to whoever won the last hole's contest
    this.crown = this.nextCrown;
    this.nextCrown = null;
    this.g.camper.setCrown(this.crown === this.myId);
    for (const o of this.others.map.values()) o.camper.setCrown(o.id === this.crown);
    if (this.crownNews) { const news = this.crownNews; this.crownNews = null; setTimeout(() => this.g.hud.callout(news, 'gold small'), 900); }
    this.paint();
  }

  /**
   * The hole's contest, judged by every phone from the same numbers once
   * everyone is done: longest drive on a par 4 or 5, closest to the pin
   * from the tee on a par 3.
   */
  contest() {
    const g = this.g;
    const hole = g.round?.index;
    if (!this.inRound || hole == null || this.judged.has(hole) || this.players.length < 2) return;
    if (!this.players.every((p) => this.status.get(p.id) === 'done' && this.scores.has(p.id))) return;
    this.judged.add(hole);
    const par3 = g.world.spec.par === 3;
    let best = null;
    for (const p of this.players) {
      const s = this.scores.get(p.id);
      const v = par3 ? s.pin : s.drive;
      if (v == null || (!par3 && v < 30)) continue;
      if (!best || (par3 ? v < best.v : v > best.v)) best = { id: p.id, v };
    }
    if (!best) return;
    this.nextCrown = best.id;
    this.crowns.set(best.id, (this.crowns.get(best.id) || 0) + 1);
    const who = best.id === this.myId ? 'YOU' : this.nameOf(best.id).toUpperCase();
    this.crownNews = par3 ? `👑 CLOSEST TO THE PIN · ${who} · ${Math.round(best.v * 3)} FT` : `👑 LONGEST DRIVE · ${who} · ${Math.round(best.v)}Y`;
  }

  /** A gold callout of mine, shared with the room. */
  brag(text) {
    if (this.active && this.players.length > 1) this.room.send({ t: 'call', text: String(text).slice(0, 24) });
  }

  // ---- Watch mode ---------------------------------------------------------------

  /** The friend worth watching right now: a ball in the air (or just landed). */
  flyingFriend() {
    for (const o of this.others.map.values()) if (o.flying) { this.lastFlown = o; return o; }
    return null;
  }

  /**
   * A swipe on the course while a friend's ball is going: up flies the
   * camera over to it, down comes home. Returns true if it meant something.
   */
  swipe(up) {
    if (!this.active) return false;
    if (!up) { if (!this.watching) return false; this.watching = null; return true; }
    if (this.watching) return true;
    const o = this.flyingFriend() || this.lastFlown;
    if (!o || !['aim', 'swing', 'settle'].includes(this.g.state)) return false;
    this.watching = o.id;
    this.watchIdle = 0;
    this.g.audio.whoosh();
    return true;
  }

  /** Point the camera at the watched ball; returns true if it did. */
  watchCamera() {
    if (!this.watching) return false;
    const o = this.others.map.get(this.watching);
    if (!o) { this.watching = null; return false; }
    const b = o.sim;
    const speed = Math.hypot(b.vx, b.vz);
    this.watchAngle = speed > 2 ? Math.atan2(-b.vz, -b.vx) : (this.watchAngle ?? 0);
    this.g.rig.orbit(b.x, b.y, b.z, speed > 2 ? 11 : 6, speed > 2 ? 4.5 : 2.4, this.watchAngle);
    this.g.rig.stiffness = 9; // keep up with a ball doing 50 m/s
    return true;
  }

  /** I am at my ball, lining up. */
  atAim() {
    if (!this.active) return;
    this.cleared = false;
    this.status.set(this.myId, 'aim');
    const { ball, round } = this.g;
    this.room.send({ t: 'at', x: ball.x, z: ball.z, hole: round.index });
    this.paint();
    this.judge();
  }

  /**
   * The swing button was pressed while aiming. Returns true if the swing may
   * start; otherwise the press was "I am ready" (or "not yet" if pressed again).
   */
  clearToSwing() {
    if (!this.active || this.cleared || this.players.length < 2) return true;
    const ready = this.status.get(this.myId) !== 'ready';
    this.status.set(this.myId, ready ? 'ready' : 'aim');
    this.room.send({ t: 'status', s: ready ? 'ready' : 'aim', aim: this.g.aimAngle, kind: this.g.clubKind() });
    this.g.hud.setAction(ready ? 'wait' : 'swing', this.g.fullPower);
    if (ready) this.g.hud.callout('READY', 'small');
    this.paint();
    this.judge();
    return false;
  }

  /** Host: is it time to say GO, or to move everyone on? */
  judge() {
    if (!this.active || !this.room.isHost) return;
    const playing = this.players.filter((p) => this.status.get(p.id) !== 'done');
    const ready = playing.filter((p) => this.status.get(p.id) === 'ready');
    if (!ready.length) { this.waitT = null; }
    else if (ready.length === playing.length) this.sayGo(ready.map((p) => p.id));
    else if (this.waitT === null) this.waitT = 0;
    if (this.players.length && !playing.length) { if (this.nextT === null) this.nextT = 0; } else this.nextT = null;
  }

  sayGo(ids) {
    this.waitT = null;
    this.room.send({ t: 'go', ids });
    this.go(ids);
  }

  go(ids) {
    if (ids.includes(this.myId) && this.g.state === 'skip') this.g.skip.close(); // GO: back to your ball
    for (const id of ids) if (this.status.get(id) === 'ready') { this.status.set(id, 'busy'); this.others.setStatus(id, 'busy'); }
    if (ids.includes(this.myId) && this.g.state === 'aim') {
      this.cleared = true;
      this.g.hud.callout('GO!', 'gold');
      this.g.audio.reward(5);
      this.g.hud.setAction(this.g.putting ? 'hold' : 'swing', this.g.fullPower);
    }
    this.paint();
  }

  /** My swing has started: friends see the club go back. */
  startSwing() {
    if (!this.active) return;
    this.room.send({ t: 'status', s: 'swing', aim: this.g.aimAngle, kind: this.g.clubKind() });
  }

  /** I struck a pose by the fire. */
  setPose(p) {
    this.myPose = p;
    this.poseT = 0;
    if (this.active) this.room.send({ t: 'pose', p });
  }

  /** Hot pot: I dropped something in; I am stirring (sent in small batches). */
  potAdd(k) { if (this.active) this.room.send({ t: 'pot', k }); }
  potStir(a) { if (this.active) this.stirred = (this.stirred || 0) + a; }

  /** A quick word to the room. */
  emote(e) {
    if (!this.active || !EMOTES.includes(e)) return;
    this.room.send({ t: 'emote', e });
    this.g.hud.callout(`YOU ${e}`, 'small');
  }

  nameOf(id) { const p = this.players.find((q) => q.id === id); return p ? cleanLook(p.look).name : '?'; }

  /** I have hit it. */
  shot(data) {
    if (!this.active) return;
    this.status.set(this.myId, 'busy');
    this.room.send({ t: 'shot', hole: this.g.round.index, ...data });
    this.paint();
  }

  holedOut() { if (this.active) this.room.send({ t: 'holed' }); }

  /** My hole is finished and scored. stat: { drive, pin } for the hole's contest. */
  holeDone(strokes, total, stat = {}) {
    if (!this.active) return;
    this.status.set(this.myId, 'done');
    this.scores.set(this.myId, { total, strokes, drive: stat.drive || 0, pin: stat.pin ?? null });
    this.room.send({ t: 'done', strokes, total, drive: stat.drive || 0, pin: stat.pin ?? null });
    this.paint();
    this.judge();
    this.contest();
  }

  /** NEXT on the result card. */
  pressNext() {
    const everyone = this.players.every((p) => this.status.get(p.id) === 'done');
    if (!everyone) { this.g.hud.callout('WAITING FOR FRIENDS', 'small'); return; }
    if (!this.room.isHost) { this.g.hud.callout('WAITING FOR THE HOST', 'small'); return; }
    this.sayNext();
  }

  sayNext() {
    this.nextT = null;
    this.room.send({ t: 'next', hole: this.g.round.index });
    this.g.nextHole?.();
  }

  /** Names and totals for the summary card, best first. */
  standings(myTotal) {
    return this.players
      .map((p) => ({ name: cleanLook(p.look).name, total: p.id === this.myId ? myTotal : this.scores.get(p.id)?.total ?? 0, me: p.id === this.myId, crowns: this.crowns.get(p.id) || 0 }))
      .sort((a, b) => a.total - b.total);
  }

  /** The round is over: friends gather round the fire with you. site: the campsite group */
  campfire(site) {
    if (!this.active) return;
    const spots = [[1.3, 0.4, -0.8, 'sit'], [0.55, -1.2, -0.2, 'cheer'], [-2.1, 0.75, 0.85, 'peace']];
    site.updateMatrixWorld();
    const v = this.others._v;
    this.others.camp(this.friends.slice(0, spots.length).map((p, i) => {
      const [x, z, yaw, pose] = spots[i];
      v.set(x, 0, z).applyMatrix4(site.matrixWorld);
      return { id: p.id, x: v.x, y: this.g.world.heightAt(v.x, v.z), z: v.z, yaw: yaw + site.rotation.y, pose };
    }));
    this.paint(); // the pill stays: a 👏 for the photo
  }

  /** The pill under the score: who is in the room and what they are doing. */
  paint() {
    this.pill.classList.toggle('hidden', !this.active || this.g.state === 'title');
    if (!this.active) return;
    this.pill.innerHTML = '';
    for (const p of this.players) {
      const row = document.createElement('div');
      row.className = `who ${this.status.get(p.id) || 'aim'}`;
      const score = this.scores.get(p.id);
      row.innerHTML = '<i></i><b></b><span></span>';
      row.querySelector('b').textContent = p.id === this.myId ? 'YOU' : cleanLook(p.look).name;
      row.querySelector('span').textContent = score ? vsPar(score.total) : '';
      this.pill.appendChild(row);
    }
    // Things to say, folded away behind one small button so the pill stays small
    const talk = document.createElement('button');
    talk.className = 'talk';
    talk.textContent = '💬';
    talk.addEventListener('pointerdown', (ev) => { ev.preventDefault(); ev.stopPropagation(); this.emotesOpen = this.emotesOpen > 0 ? 0 : 4; this.paint(); });
    this.pill.appendChild(talk);
    if (this.emotesOpen > 0) {
      const row = document.createElement('div');
      row.className = 'emotes';
      for (const e of EMOTES) {
        const b = document.createElement('button');
        b.textContent = e;
        b.addEventListener('pointerdown', (ev) => { ev.preventDefault(); ev.stopPropagation(); this.emote(e); this.emotesOpen = 0; this.paint(); });
        row.appendChild(b);
      }
      this.pill.appendChild(row);
    }
  }

  update(dt) {
    const g = this.g;
    const show = this.active && ['aim', 'swing', 'flight', 'settle', 'holed', 'result', 'fishing', 'summary', 'nabe', 'skip'].includes(g.state);
    if (g.world) this.others.update(dt, g.world, g.env, g.camera, show);
    if (this.active) {
      // Remember whose ball flew last, so a swipe just after it lands still finds it
      const o = this.flyingFriend();
      if (o) this.lastFlown = o;
      if (this.watching) {
        const w = this.others.map.get(this.watching);
        this.watchIdle = w?.flying ? 0 : this.watchIdle + dt;
        if (this.watchIdle > 3 || g.state === 'result' || g.state === 'holed' || g.state === 'flight') this.watching = null;
      }
      if (this.emotesOpen > 0) { this.emotesOpen -= dt; if (this.emotesOpen <= 0) { this.emotesOpen = 0; this.paint(); } }
      if (this.stirred > 0.02) { this.stirT = (this.stirT || 0) + dt; if (this.stirT > 0.4) { this.room.send({ t: 'stir', a: Math.min(0.5, this.stirred) }); this.stirred = 0; this.stirT = 0; } }
      // By the fire, say my pose again now and then: one lost message (or
      // one that arrived before they sat down) never leaves us out of step
      if ((g.state === 'summary' || g.state === 'nabe') && this.myPose) {
        this.poseT += dt;
        if (this.poseT > 2) { this.poseT = 0; this.room.send({ t: 'pose', p: this.myPose }); }
      }
    }
    if (!this.active || !this.room.isHost) return;
    if (this.waitT !== null) {
      this.waitT += dt;
      if (this.waitT > WAIT_LIMIT) this.sayGo(this.players.filter((p) => this.status.get(p.id) === 'ready').map((p) => p.id));
    }
    if (this.nextT !== null && g.state === 'result') {
      this.nextT += dt;
      if (this.nextT > NEXT_DELAY) this.sayNext();
    }
  }
}
