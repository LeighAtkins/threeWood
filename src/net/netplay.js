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

import { Room, cleanCode, MAX_PLAYERS } from './room.js';
import { BOT_LEVELS } from './bots.js';
import { Others } from '../render/others.js';
import { cleanLook } from '../core/camp.js';
import { generateSeed, cleanSeed } from '../core/rng.js';
import { BUILD, isStale, reloadFresh } from './fresh.js';
import { contestFor, judgeContest, perkFor } from '../core/contests.js';
import { HAPPENINGS, quipText, awards } from '../core/happenings.js';
import { CARDS, deal, combine, targetFor } from '../core/cards.js';

const WAIT_LIMIT = 30;  // seconds the ready players wait for the rest
const NEXT_DELAY = 8;   // seconds on the result card once everyone has finished

const KINDS = ['wood', 'iron', 'putter'];
const POSES = ['perch', 'perchWarm', 'sit', 'warm', 'peace', 'cheer', 'hello', 'wave'];
export const EMOTES = ['👏', '😂', '😱', '🔥'];
// Things to say, sent as their number: no typing, nothing typed on the wire
export const SAYINGS = ['Nice shot!', 'Unlucky!', 'FORE!', 'Hurry up 🐢', 'Watch this', 'GG'];
const num = (v, lo, hi, d = 0) => (Number.isFinite(+v) ? Math.max(lo, Math.min(hi, +v)) : d);
const vsPar = (n) => (n === 0 ? 'E' : n > 0 ? `+${n}` : `${n}`);

export class NetPlay {
  constructor(game) {
    this.g = game;
    const { root, layer } = game.hud;
    this.others = new Others(game.scene, root, layer);
    // The host's phone watches the bots' balls for heads in the way
    this.others.onStep = (o) => { if (this.room?.isHost && this.isBot(o.id)) this.bonkCheck(o.sim, null, o.id, o.kind === 'putter'); };
    this.pill = document.createElement('div');
    this.pill.className = 'net-pill hidden';
    root.insertBefore(this.pill, layer);
    // The room's feed: what everyone's shots did, newest at the bottom
    this.feed = document.createElement('div');
    this.feed.className = 'net-feed hidden';
    root.insertBefore(this.feed, layer);
    this.haps = new Map();     // id -> { kind: count } this round (for the awards)
    this.hand = null;          // cards dealt to me after this hole: [id, id, id]
    this.kept = null;          // the one I kept (a boost for me, for the next hole)
    this.incoming = [];        // mischief played on me: [{ id, from }] (next hole)
    this.cardsNow = { mine: null, hit: [] }; // what is in play this hole (for the hole card)
    this.bonked = new Set();   // victims of the ball in the air right now (once a shot each)
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
    this.contestNow = null; // this hole's contest
    this.perk = null;       // what the crown is worth this hole (whoever wears it)
    this.lastRanks = new Map(); // id -> place on the board when the hole began
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
  /** People, not bots: what the outfits count. */
  get humans() { return this.friends.filter((p) => !p.bot); }
  /** Seat number in the room (host 0): which spot on the tee is theirs. */
  seatOf(id) { return Math.max(0, this.players.findIndex((p) => p.id === id)); }
  isBot(id) { return !!this.players.find((p) => p.id === id)?.bot; }
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

  /**
   * Host: ask the room for a bot of this level. Bots live on the room
   * server (server/room.js), which picks their look and name and plays them;
   * every phone, the host's included, hears them like any other player.
   */
  addBot(level = 'par') {
    if (!this.room?.isHost || !BOT_LEVELS[level]) return;
    this.room.addBot(level);
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
    this.contestNow = this.perk = null;
    this.lastRanks.clear();
    this.haps.clear();
    this.hand = this.kept = null;
    this.incoming = [];
    this.cardsNow = { mine: null, hit: [] };
    this.feed.innerHTML = '';
    this.feed.classList.add('hidden');
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
      const list = this.players.map((p) => `<div class="net-player ${p.bot ? 'bot' : ''}"><i></i>${esc(cleanLook(p.look).name)}${p.host ? ' <small>HOST</small>' : ''}${p.id === room.me.id ? ' <small>YOU</small>' : ''}${p.bot ? ` <small>BOT · ${BOT_LEVELS[p.level]?.label.toUpperCase() || 'PAR'}</small>` : ''}${old(p) ? ' <small class="stale">NEEDS A REFRESH</small>' : ''}${p.bot && room.isHost ? `<button class="x" data-a="unbot" data-id="${esc(p.id)}" aria-label="Remove">×</button>` : ''}</div>`).join('');
      const seats = MAX_PLAYERS - this.players.length;
      const botRow = room.isHost && seats > 0 ? `<div class="bot-row"><span>ADD A BOT</span>${Object.entries(BOT_LEVELS).map(([id, l]) => `<button data-a="bot" data-level="${id}">${l.label.toUpperCase()}</button>`).join('')}</div>` : '';
      body = `
        <h2>ROOM CODE</h2>
        <h1 class="gold room-code">${esc(room.code)}</h1>
        <button class="btn ghost" data-a="share">SHARE THE LINK</button>
        <div class="net-list">${list}</div>
        <p class="seats">${this.players.length} OF ${MAX_PLAYERS} SEATS</p>
        ${botRow}
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
      else if (a === 'bot') this.addBot(e.target.closest('[data-a]').dataset.level);
      else if (a === 'unbot') { const id = e.target.closest('[data-a]').dataset.id; room.removeBot(id); }
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
        if (from === this.room.hostId && !this.room.isHost && cleanSeed(msg.seed)) this.begin(cleanSeed(msg.seed), msg.length === 9 ? 9 : 18);
        break;
      case 'at':
        this.status.set(from, 'aim');
        if (this.inRound && msg.hole === this.holeIdx) this.others.at(from, g.world, num(msg.x, -400, 400), num(msg.z, -400, 400));
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
        if (i < 0) break;
        this.others.say(from, EMOTES[i]);
        const at = typeof msg.to === 'string' && this.players.some((p) => p.id === msg.to) ? msg.to : null;
        if (at) {
          // A reaction aimed at someone: it lands on them too
          if (at === this.myId) { g.hud.callout(`${this.nameOf(from)} ${EMOTES[i]} YOU`, 'small'); g.camper.feel(EMOTES[i] === '😂' ? 'oops' : 'joy', 1.4); }
          else this.others.react(at, EMOTES[i] === '😂' ? 'oops' : 'joy');
          this.addFeed(`${this.nameOf(from)} ${EMOTES[i]} ${at === this.myId ? 'you' : this.nameOf(at)}`, 'react');
        } else g.hud.callout(`${this.nameOf(from)} ${EMOTES[i]}`, 'small');
        break;
      }
      case 'say': {
        const text = SAYINGS[num(msg.i, -1, 99, -1)];
        if (!text) break;
        this.others.say(from, text);
        g.hud.callout(`${this.nameOf(from)}: ${text}`, 'small');
        break;
      }
      case 'hap':
        if (HAPPENINGS[msg.k]) this.onHap(from, msg.k, num(msg.v, 0, 999));
        break;
      case 'quip': {
        // (a bot's line, by number: never text off the wire)
        if (!this.isBot(from)) break;
        const to = typeof msg.to === 'string' ? msg.to : null;
        const text = quipText(msg.k, num(msg.i, 0, 99), to === this.myId ? 'you' : to ? this.nameOf(to) : 'friend');
        if (text) { this.others.say(from, text); if (to === this.myId) g.hud.callout(`${this.nameOf(from)}: ${text}`, 'small'); }
        break;
      }
      case 'card':
        if (CARDS[msg.id]) this.onCard(from, msg.id, typeof msg.to === 'string' ? msg.to : null);
        break;
      case 'knock': {
        const who = typeof msg.who === 'string' ? msg.who : null;
        if (!who || !this.inRound || msg.hole !== this.holeIdx) break;
        const s = { x: num(msg.x, -400, 400), z: num(msg.z, -400, 400), vx: num(msg.vx, -20, 20), vz: num(msg.vz, -20, 20) };
        if (who === this.myId) g.knocked(s.vx, s.vz, this.nameOf(from));
        else this.others.knock(who, s);
        if (msg.s && typeof msg.s === 'object') this.others.resync(from, msg.s, msg.s.mode === 'roll' ? 'roll' : 'air');
        this.knockNews(from, who);
        break;
      }
      case 'bonk':
        this.onBonk(typeof msg.by === 'string' ? msg.by : from, typeof msg.who === 'string' ? msg.who : null, msg.s, from);
        break;
      case 'go':
        if (from === this.room.hostId) this.go(Array.isArray(msg.ids) ? msg.ids : []);
        break;
      case 'shot':
        // (the hole being played: after I finish, round.index has moved on, and
        // friends still out there must still fly on my screen)
        if (this.inRound && msg.hole === this.holeIdx) {
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
        // (a finished hole is only news on that hole: a late or stale one is dropped)
        if (Number.isInteger(msg.hole) && msg.hole !== this.holeIdx) break;
        this.status.set(from, 'done');
        this.others.setStatus(from, 'done');
        this.scores.set(from, { total: num(msg.total, -99, 199), strokes: num(msg.strokes, 0, 20), putts: num(msg.putts, 0, 20), drive: num(msg.drive, 0, 400), pin: msg.pin == null ? null : num(msg.pin, 0, 400), near: msg.near == null ? null : num(msg.near, 0, 400) });
        this.streak(from, num(msg.strokes, 0, 20));
        this.contest();
        g.hud.updateBoard(this.board());
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
        if (from === this.room.hostId && this.inRound && msg.hole === g.round?.index) g.nextHole?.();
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
    this.hand = this.kept = null; this.incoming = []; this.cardsNow = { mine: null, hit: [] };
    this.inRound = true;
    this.scores.clear();
    this.haps.clear();
    this.crowns.clear();
    this.leader = null;
    this.streaks = new Map();
    this.closeLobby();
    this.g.startNetRound(seed, length);
  }

  /**
   * A hole is about to load: the crown passes to whoever won the last hole's
   * contest, and with it this hole's perk. Returns the perk if it is mine
   * (the world is built around it), else null.
   */
  passCrown() {
    if (!this.active) return null;
    const { round } = this.g;
    this.lastRanks = round.index > 0 ? new Map(this.board().map((r) => [r.id, r.rank])) : new Map();
    this.crown = this.nextCrown;
    this.nextCrown = null;
    this.perk = this.crown ? perkFor(round.seed, round.index) : null;
    this.contestNow = null; // (needs the hole's par: set in atHole)
    // The cards kept and the mischief received after the last hole are played now
    this.cardsNow = { mine: this.kept, hit: this.incoming };
    this.kept = null; this.incoming = []; this.hand = null; this.picked = false;
    return this.crown === this.myId ? this.perk : null;
  }

  /** Everything shaping my hole: the crown's perk if I wear it, my card, mischief on me. */
  holeMods() {
    if (!this.active) return combine([]);
    const ids = [this.cardsNow.mine, ...this.cardsNow.hit.map((h) => h.id)].filter(Boolean);
    return combine(ids, this.myPerk);
  }

  /** The perk I play this hole with, if I wear the crown. */
  get myPerk() { return this.active && this.crown && this.crown === this.myId ? this.perk : null; }

  /** A hole has loaded. */
  atHole() {
    if (!this.active) return;
    const { round, world } = this.g;
    // The hole being played (round.index moves on the moment I finish it)
    this.holeIdx = round.index;
    for (const p of this.players) this.status.set(p.id, 'aim');
    this.cleared = false;
    this.waitT = this.nextT = null;
    this.watching = null;
    this.others.sync(this.friends);
    this.others.toTee(world, (id) => this.seatOf(id));
    this.contestNow = this.players.length > 1 ? contestFor(round.seed, round.index, world.spec.par, world.spec.archetype) : null;
    this.g.camper.setCrown(this.crown === this.myId);
    for (const o of this.others.map.values()) o.camper.setCrown(o.id === this.crown);
    if (this.crownNews) { const news = this.crownNews; this.crownNews = null; setTimeout(() => this.g.hud.callout(news, 'gold small'), 900); }
    this.paint();
  }

  /** Where the friends stand on the tee (for the gallery camera): [{ x, y, z }]. */
  teeSpots() {
    const out = [];
    for (const o of this.others.map.values()) if (o.placed && o.camper.group.visible) out.push(o.camper.group.position);
    return out;
  }

  /** The crown line for the hole card: who wears it and what it is worth. */
  crownCard() {
    if (!this.active || this.players.length < 2) return null;
    const contest = this.contestNow;
    let crown = null;
    if (this.crown && this.perk) {
      const mine = this.crown === this.myId;
      crown = { mine, who: mine ? 'YOU' : this.nameOf(this.crown).toUpperCase(), perk: this.perk };
    }
    const final = this.finalWord();
    const cards = [
      ...(this.cardsNow.mine ? [{ ...CARDS[this.cardsNow.mine], mine: true }] : []),
      ...this.cardsNow.hit.map((h) => ({ ...CARDS[h.id], from: this.nameOf(h.from) })),
    ];
    return { contest, crown, cards, final };
  }

  /**
   * The hole's contest (src/core/contests.js), judged by every phone from
   * the same numbers once everyone is done. The winner wears the crown on
   * the next hole; a dead heat crowns nobody.
   */
  contest() {
    const g = this.g;
    const hole = g.round?.index;
    if (!this.inRound || hole == null || this.judged.has(hole) || this.players.length < 2) return;
    if (!this.players.every((p) => this.status.get(p.id) === 'done' && this.scores.has(p.id))) return;
    this.judged.add(hole);
    const contest = this.contestNow || contestFor(g.round.seed, hole, g.world.spec.par, g.world.spec.archetype);
    const best = judgeContest(contest, this.players.map((p) => ({ id: p.id, stats: this.scores.get(p.id) })));
    this.leadNews();
    if (!best) { this.crownNews = `👑 ${contest.label} · A TIE, NO CROWN`; return; }
    this.nextCrown = best.id;
    this.crowns.set(best.id, (this.crowns.get(best.id) || 0) + 1);
    const who = best.id === this.myId ? 'YOU' : this.nameOf(best.id).toUpperCase();
    this.crownNews = `👑 ${contest.label} · ${who} · ${contest.fmt(best.v)}`;
    g.hud.updateBoard(this.board());
  }

  // ---- Happenings: the room's feed, reactions and bonks ------------------------

  /** My shot did something worth hearing: tell the room (and show it here). */
  happen(h) {
    if (!this.active || this.players.length < 2) return;
    this.room.send({ t: 'hap', k: h.k, v: h.v });
    this.onHap(this.myId, h.k, h.v);
  }

  onHap(id, k, v) {
    const h = HAPPENINGS[k];
    if (!h || !this.inRound) return;
    const c = this.haps.get(id) || {};
    c[k] = (c[k] || 0) + 1;
    this.haps.set(id, c);
    const me = id === this.myId;
    const name = me ? 'You' : this.nameOf(id);
    // The same thing to several people in one volley is one line: "Toba, Saito +2 lipped out"
    const r = this.lastHap;
    if (r && r.k === k && performance.now() - r.at < 2500 && r.line.isConnected && !r.ids.includes(id)) {
      r.ids.push(id); r.at = performance.now();
      const names = r.ids.map((i) => (i === this.myId ? 'You' : this.nameOf(i)));
      const who = names.length > 2 ? `${names.slice(0, 2).join(', ')} +${names.length - 2}` : names.join(' & ');
      r.line.querySelector('span').textContent = `${h.e} ${h.say(who, v)}`;
      r.line.classList.remove('bump'); void r.line.offsetWidth; r.line.classList.add('bump');
    } else {
      const line = this.addFeed(`${h.e} ${h.say(name, v)}`, h.tone, me ? null : id);
      this.lastHap = { k, ids: [id], at: performance.now(), line };
    }
    if (!me) {
      this.others.say(id, h.e);
      this.others.react(id, h.tone === 'lol' ? 'oops' : 'joy');
    }
    // The room's noise: a laugh for the funny, applause for the good
    if (h.tone === 'lol') this.g.audio.giggle(me ? 3 : 2);
    else if (h.tone === 'nice') this.g.audio.pop();
    else this.g.audio.applause(me ? 1.2 : 0.7);
  }

  /**
   * A line in the feed. tone: wow | lol | react. about: whose happening it
   * was (the line gets a button to laugh or clap at them).
   */
  addFeed(text, tone, about = null) {
    const line = document.createElement('div');
    line.className = `line ${tone}`;
    const span = document.createElement('span');
    span.textContent = text;
    line.appendChild(span);
    if (about && tone !== 'react') {
      const e = tone === 'lol' ? '😂' : '👏'; // (nice and wow: a clap)
      const b = document.createElement('button');
      b.textContent = e;
      b.addEventListener('pointerdown', (ev) => {
        ev.preventDefault(); ev.stopPropagation();
        if (b.disabled) return;
        b.disabled = true;
        this.react(about, e);
      });
      line.appendChild(b);
    }
    this.feed.appendChild(line);
    this.feed.classList.remove('hidden');
    while (this.feed.children.length > 4) this.feed.firstChild.remove();
    setTimeout(() => { line.classList.add('going'); setTimeout(() => line.remove(), 500); }, tone === 'react' ? 3500 : 6000);
    return line;
  }

  /** Laugh or clap at someone (from the feed). */
  react(id, e) {
    if (!this.active || !EMOTES.includes(e)) return;
    this.room.send({ t: 'emote', e, to: id });
    this.others.react(id, e === '😂' ? 'oops' : 'joy');
    this.addFeed(`You ${e} ${this.nameOf(id)}`, 'react');
    this.g.audio.pop();
  }

  /**
   * Is a ball (mine, or a bot's on the host's phone) at someone's head?
   * Called every step of a flight. Mine ricochets (and tells the room the
   * new flight, so every phone sees the same bounce); a bot's only looks it.
   */
  bonkCheck(ball, e = null, by = null, putt = false) {
    if (!this.active || this.players.length < 2) return false;
    if (e && e.type !== 'land' && e.type !== 'bounce') return false;
    const owner = by || this.myId;
    for (const o of this.others.map.values()) {
      if (o.id === owner || !o.placed || !o.camper.group.visible || o.camp) continue;
      const p = o.camper.group.position;
      const dx = ball.x - p.x, dz = ball.z - p.z;
      // A ball dropping on them (not one rolling through their feet, nor one
      // climbing away over the front row from the back of the tee)
      const dropping = ball.mode === 'air' && ball.vy <= 0 && ball.y - p.y >= 0.3 && ball.y - p.y < 1.7;
      const running = !putt && ball.mode === 'roll' && ball.vx * ball.vx + ball.vz * ball.vz > 16;
      if (dx * dx + dz * dz > 0.36 || !(dropping || running)) continue;
      const key = `${owner}>${o.id}`;
      if (this.bonked.has(key)) continue;
      this.bonked.add(key);
      setTimeout(() => this.bonked.delete(key), 4000);
      let s = null;
      if (!by) {
        // Off the head: back the way it came, softer, with a little pop
        const d = Math.hypot(dx, dz) || 1, nx = dx / d, nz = dz / d;
        const vn = ball.vx * nx + ball.vz * nz;
        if (vn < 0) { ball.vx -= 1.8 * vn * nx; ball.vz -= 1.8 * vn * nz; }
        ball.vx *= 0.45; ball.vz *= 0.45; ball.vy = Math.max(ball.vy, 2.6);
        ball.mode = 'air';
        s = { x: ball.x, y: ball.y, z: ball.z, vx: ball.vx, vy: ball.vy, vz: ball.vz };
      }
      this.room.send({ t: 'bonk', by: owner, who: o.id, s });
      this.onBonk(owner, o.id, null, this.myId);
      return !by;
    }
    return false;
  }

  /**
   * My ball (rolling, or just bouncing along the turf) into a friend's ball
   * at rest: pool rules. Theirs takes the push along the line of centres,
   * mine keeps the rest. Called every step of my ball; true if it hit.
   */
  knockCheck(ball) {
    if (!this.active || this.players.length < 2 || ball.mode === 'rest') return false;
    for (const o of this.others.map.values()) {
      if (!o.placed || o.flying || !o.ball.visible || this.status.get(o.id) === 'done' || o.camp) continue;
      const p = o.ball.position;
      const dx = p.x - ball.x, dz = p.z - ball.z, d2 = dx * dx + dz * dz;
      if (d2 > 0.0081 || Math.abs(p.y - ball.y) > 0.12) continue; // (two radii: 0.09 m)
      const d = Math.sqrt(d2) || 0.001, nx = dx / d, nz = dz / d;
      const vn = ball.vx * nx + ball.vz * nz;
      if (vn < 0.3) continue; // (not moving into it)
      const key = `knock>${o.id}`;
      if (this.bonked.has(key)) continue;
      this.bonked.add(key);
      setTimeout(() => this.bonked.delete(key), 1500);
      const vx = vn * nx * 0.92, vz = vn * nz * 0.92;
      ball.vx -= vn * nx; ball.vz -= vn * nz;
      const s = { x: p.x, z: p.z, vx, vz };
      // (and my own ball's new course, so the room's replay of it turns too)
      const mine = { x: ball.x, y: ball.y, z: ball.z, vx: ball.vx, vy: ball.vy, vz: ball.vz, mode: ball.mode };
      this.room.send({ t: 'knock', who: o.id, hole: this.holeIdx, ...s, s: mine });
      this.others.knock(o.id, s);
      this.knockNews(this.myId, o.id);
      return true;
    }
    return false;
  }

  knockNews(by, who) {
    const c = this.haps.get(by) || {};
    c.knock = (c.knock || 0) + 1;
    this.haps.set(by, c);
    const a = by === this.myId ? 'You' : this.nameOf(by);
    const b = who === this.myId ? 'your' : `${this.nameOf(who)}'s`;
    this.addFeed(`🎱 ${a} knocked ${b} ball`, 'lol', by === this.myId ? null : by);
    this.g.audio.bounce(5, 'green');
    this.g.audio.giggle(1);
  }

  onBonk(by, who, s, from) {
    if (!this.inRound || !who) return;
    // (only the ball's owner says, or the host for a bot)
    if (from !== this.myId && from !== by && !(from === this.room?.hostId && this.isBot(by))) return;
    const c = this.haps.get(by) || {};
    c.bonk = (c.bonk || 0) + 1;
    this.haps.set(by, c);
    const victim = who === this.myId ? 'YOU' : this.nameOf(who);
    const shooter = by === this.myId ? 'Your ball' : `${this.nameOf(by)}'s ball`;
    this.addFeed(`💫 ${shooter} bonked ${who === this.myId ? 'you' : victim}`, 'lol', by === this.myId ? null : by);
    this.g.audio.bonk();
    this.g.audio.giggle(2);
    if (who === this.myId) { this.g.camper.feel('oops', 2.2); this.g.hud.callout('BONK!', 'bad'); this.g.rig.addShake?.(0.06); }
    else { this.others.say(who, '💫'); this.others.react(who, 'oops'); }
    // Someone else's ball, bounced off someone: put the replay on the same new flight
    if (s && from !== this.myId) this.others.resync(by, s);
  }

  // ---- Camp Cards -----------------------------------------------------------------

  /** My hole is done: three cards, by where I stand. */
  dealHand() {
    if (!this.active || this.players.length < 2 || this.hand) return null;
    if (this.g.round.index >= this.g.round.holes.length) return null; // (no next hole)
    const rows = this.board();
    const me = rows.find((r) => r.me);
    this.hand = deal(Math.random, me ? me.rank : 1, rows.length);
    // (tied players share a place: everyone tied for the lead is dealt no mischief)
    return this.hand.map((id) => {
      const c = CARDS[id];
      const to = c.kind === 'mischief' ? targetFor(rows.map((r) => r.id), this.myId) : null;
      return { id, ...c, to: to ? this.nameOf(to) : null, dead: c.kind === 'mischief' && !to };
    });
  }

  /** I kept a card. Mischief goes to the player one place above me, now. */
  keep(id) {
    if (!this.hand?.includes(id) || this.kept || this.picked) return false;
    this.picked = true;
    const c = CARDS[id];
    if (c.kind === 'self') {
      this.kept = id;
      this.room.send({ t: 'card', id });
      this.addFeed(`${c.e} You keep ${c.label}`, 'react');
    } else {
      const to = targetFor(this.board().map((r) => r.id), this.myId);
      if (!to) return false;
      this.room.send({ t: 'card', id, to });
      this.onCard(this.myId, id, to);
    }
    this.g.audio.pop();
    return true;
  }

  onCard(from, id, to) {
    const c = CARDS[id];
    if (!this.inRound || !c) return;
    if (c.kind === 'self') return; // (only mischief is news; my own keep is shown when I pick it)
    if (!to) return;
    const who = to === this.myId ? 'you' : this.nameOf(to);
    const by = from === this.myId ? 'You' : this.nameOf(from);
    this.addFeed(`${c.e} ${by} gave ${who} ${c.label}`, 'lol', to === this.myId || from === this.myId ? null : to);
    if (to === this.myId) {
      this.incoming.push({ id, from });
      this.g.hud.callout(`${c.e} ${c.label.toUpperCase()} FROM ${this.nameOf(from).toUpperCase()}${this.g.state === 'result' ? '' : ' · NEXT HOLE'}`, 'bad small');
      this.g.camper.feel('oops', 2);
    } else this.others.react(to, 'oops');
    this.g.audio.giggle(2);
  }

  /** Birdies in a row: two is a hot streak (🔥 by their name), and news. */
  streak(id, strokes) {
    this.streaks ||= new Map();
    const par = this.g.world?.spec.par ?? 4;
    const n = strokes > 0 && strokes < par ? (this.streaks.get(id) || 0) + 1 : 0;
    this.streaks.set(id, n);
    if (n >= 2) this.addFeed(`🔥 ${id === this.myId ? 'You are' : `${this.nameOf(id)} is`} on fire: ${n} under par in a row`, 'wow', id === this.myId ? null : id);
  }

  onFire(id) { return (this.streaks?.get(id) || 0) >= 2; }

  /** The last hole's card: how tight it is at the top. */
  finalWord() {
    const { round } = this.g;
    if (!this.active || this.players.length < 2 || round.index !== round.holes.length - 1) return null;
    const rows = this.board();
    const gap = rows.length > 2 ? rows[2].total - rows[0].total : rows[1].total - rows[0].total;
    const lead = rows.filter((r) => r.total === rows[0].total);
    if (lead.length > 1) return `FINAL HOLE · ${lead.length} TIED FOR THE LEAD`;
    if (gap <= 2) return `FINAL HOLE · ${gap} ${gap === 1 ? 'STROKE COVERS' : 'STROKES COVER'} THE TOP THREE`;
    return `FINAL HOLE · ${lead[0].me ? 'YOUR' : `${lead[0].name.toUpperCase()}'S`} TO LOSE`;
  }

  /** After a hole: a new leader, or a new group sharing the lead, is news. */
  leadNews() {
    const rows = this.board();
    if (rows.length < 2) return;
    const top = rows.filter((r) => r.total === rows[0].total);
    const key = top.map((r) => r.id).sort().join(',');
    if (key === this.leader) return;
    this.leader = key;
    if (top.length > 3) return; // (half the room on the same score is not news)
    const at = vsPar(top[0].total);
    if (top.length === 1) {
      const r = top[0];
      this.addFeed(`🏆 ${r.me ? 'You take' : `${r.name} takes`} the lead at ${at}`, 'wow', r.me ? null : r.id);
    } else {
      this.addFeed(`⚔️ ${top.map((r) => (r.me ? 'You' : r.name)).join(', ')} share the lead at ${at}`, 'lol');
    }
  }

  /** End of the round: the funny awards, from everyone's happenings. */
  awards() {
    const list = awards(this.haps, this.players.map((p) => p.id));
    const bonks = [...this.haps.entries()].filter(([, c]) => c.bonk).sort((a, b) => b[1].bonk - a[1].bonk)[0];
    if (bonks && !list.some((a) => a.id === bonks[0])) list.push({ id: bonks[0], e: '💫', label: 'Head Hunter', award: 'bonk', n: bonks[1].bonk });
    const pool = [...this.haps.entries()].filter(([, c]) => c.knock).sort((a, b) => b[1].knock - a[1].knock)[0];
    if (pool && !list.some((a) => a.id === pool[0])) list.push({ id: pool[0], e: '🎱', label: 'Pool Shark', award: 'knock', n: pool[1].knock });
    return list.map((a) => ({ ...a, name: a.id === this.myId ? 'You' : this.nameOf(a.id), me: a.id === this.myId }));
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

  /**
   * Done with the hole, waiting for the room: the camera goes to whoever is
   * still playing. A ball in the air first; otherwise someone lining up,
   * seen from behind their ball, a few seconds each. Returns the name being
   * watched (or null: nobody left, the caller frames the green).
   */
  spectate(dt) {
    if (!this.active) return null;
    const g = this.g;
    const playing = [...this.others.map.values()].filter((o) => o.placed && this.status.get(o.id) !== 'done');
    if (!playing.length) { this.spectId = null; return null; }
    this.spectT = (this.spectT || 0) + dt;
    const flying = playing.find((o) => o.flying);
    let o = this.others.map.get(this.spectId);
    if (flying && (!o || !o.flying)) { o = flying; this.spectT = 0; }
    else if (!o || !playing.includes(o) || (!o.flying && this.spectT > 5)) {
      const i = o ? playing.indexOf(o) : -1;
      o = playing[(i + 1) % playing.length];
      this.spectT = 0;
    }
    this.spectId = o.id;
    const b = o.flying ? o.sim : o.ball.position;
    const cup = g.world.cup;
    if (o.flying && Math.hypot(o.sim.vx, o.sim.vz) > 2) {
      this.spectAngle = Math.atan2(-o.sim.vz, -o.sim.vx);
      g.rig.orbit(b.x, b.y, b.z, 9, 3.5, this.spectAngle);
      g.rig.stiffness = 6;
    } else {
      // From behind the ball, the cup beyond it
      const want = Math.atan2(b.z - cup.z, b.x - cup.x);
      this.spectAngle = this.spectAngle == null ? want : this.spectAngle + Math.atan2(Math.sin(want - this.spectAngle), Math.cos(want - this.spectAngle)) * Math.min(1, dt * 2);
      const d = Math.hypot(b.x - cup.x, b.z - cup.z);
      g.rig.orbit(b.x, b.y, b.z, Math.min(9, 4 + d * 0.15), Math.min(4, 1.6 + d * 0.06), this.spectAngle);
      g.rig.stiffness = 3;
    }
    return o.camper.look.name;
  }

  /** I am at my ball, lining up. */
  atAim() {
    if (!this.active) return;
    this.cleared = false;
    this.status.set(this.myId, 'aim');
    const { ball, round } = this.g;
    this.room.send({ t: 'at', x: ball.x, z: ball.z, hole: this.holeIdx ?? round.index });
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
    this.room.send({ t: 'shot', hole: this.holeIdx ?? this.g.round.index, ...data });
    this.paint();
  }

  holedOut() { if (this.active) this.room.send({ t: 'holed' }); }

  /** My hole is finished and scored. stat: { putts, drive, pin, near } for the hole's contest. */
  holeDone(strokes, total, stat = {}) {
    if (!this.active) return;
    this.status.set(this.myId, 'done');
    const s = { total, strokes, putts: stat.putts || 0, drive: stat.drive || 0, pin: stat.pin ?? null, near: stat.near ?? null };
    this.scores.set(this.myId, s);
    this.room.send({ t: 'done', hole: this.holeIdx, ...s });
    this.streak(this.myId, strokes);
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

  /**
   * The leaderboard, best first: everyone's total so far (those still
   * playing the hole show last hole's), this hole's strokes once they are
   * done, crowns won, and how many places they moved since the hole began.
   */
  board() {
    if (!this.room) return [];
    const rows = this.players.map((p) => {
      const s = this.scores.get(p.id);
      const done = this.status.get(p.id) === 'done' && !!s;
      return {
        id: p.id, name: cleanLook(p.look).name, me: p.id === this.myId, bot: !!p.bot,
        total: s?.total ?? 0, strokes: done ? s.strokes : null, done,
        crowns: this.crowns.get(p.id) || 0, crown: this.nextCrown === p.id || (!this.judged.has(this.g.round?.index) && this.crown === p.id),
      };
    });
    rows.sort((a, b) => a.total - b.total || a.name.localeCompare(b.name));
    // (a tie shares its place: 1, 1, 3)
    rows.forEach((r, i) => { r.rank = i > 0 && r.total === rows[i - 1].total ? rows[i - 1].rank : i + 1; const was = this.lastRanks.get(r.id); r.move = was == null ? 0 : was - r.rank; });
    return rows;
  }

  /** The summary card's board (the round is over: everyone is done). */
  standings() { return this.board(); }

  /** The round is over: friends gather round the fire with you. site: the campsite group */
  campfire(site) {
    if (!this.active) return;
    // Seven spots round the fire, nearest first
    const spots = [[1.3, 0.4, -0.8, 'sit'], [0.55, -1.2, -0.2, 'cheer'], [-2.1, 0.75, 0.85, 'peace'], [2.2, -0.9, -1.2, 'sit'], [-1.6, -1.5, 0.3, 'hello'], [2.6, 1.1, -0.5, 'warm'], [-2.8, -0.4, 1.0, 'cheer']];
    site.updateMatrixWorld();
    const v = this.others._v;
    this.others.camp(this.friends.slice(0, spots.length).map((p, i) => {
      const [x, z, yaw, pose] = spots[i];
      v.set(x, 0, z).applyMatrix4(site.matrixWorld);
      return { id: p.id, x: v.x, y: this.g.world.heightAt(v.x, v.z), z: v.z, yaw: yaw + site.rotation.y, pose };
    }));
    this.paint(); // the pill stays: a 👏 for the photo
  }

  /**
   * Repaint the pill, at most once a frame: a room of bots sends a burst of
   * messages per shot, and rebuilding the pill for each was wasted layout.
   */
  paint() {
    if (this.paintQueued) return;
    this.paintQueued = true;
    requestAnimationFrame(() => { this.paintQueued = false; this.paintNow(); });
  }

  /** The pill under the score: who is in the room and what they are doing. */
  paintNow() {
    this.pill.classList.toggle('hidden', !this.active || this.g.state === 'title');
    if (!this.active || this.g.state === 'title') this.feed.classList.add('hidden');
    if (!this.active) return;
    this.pill.innerHTML = '';
    // This hole's contest on top, then the leaderboard as it stands
    if (this.contestNow && this.players.length > 1) {
      const head = document.createElement('div');
      head.className = 'contest';
      head.textContent = `👑 ${this.contestNow.label}`;
      this.pill.appendChild(head);
    }
    for (const r of this.board()) {
      const row = document.createElement('div');
      row.className = `who ${this.status.get(r.id) || 'aim'}`;
      row.innerHTML = '<i></i><b></b><span></span>';
      row.querySelector('b').textContent = `${r.me ? 'YOU' : r.name}${this.crown === r.id ? ' 👑' : ''}${this.onFire(r.id) ? ' 🔥' : ''}`;
      row.querySelector('span').textContent = this.scores.has(r.id) ? `${vsPar(r.total)}${r.move > 0 ? ' ▲' : r.move < 0 ? ' ▼' : ''}` : '';
      if (r.move) row.classList.add(r.move > 0 ? 'up' : 'down');
      this.pill.appendChild(row);
    }
    // Things to say, folded away behind one small button so the pill stays small
    const talk = document.createElement('button');
    talk.className = 'talk';
    talk.textContent = '💬';
    talk.addEventListener('pointerdown', (ev) => { ev.preventDefault(); ev.stopPropagation(); this.emotesOpen = this.emotesOpen > 0 ? 0 : 6; this.paintNow(); });
    this.pill.appendChild(talk);
    if (this.emotesOpen > 0) {
      const row = document.createElement('div');
      row.className = 'emotes';
      for (const e of EMOTES) {
        const b = document.createElement('button');
        b.textContent = e;
        b.addEventListener('pointerdown', (ev) => { ev.preventDefault(); ev.stopPropagation(); this.emote(e); this.emotesOpen = 0; this.paintNow(); });
        row.appendChild(b);
      }
      this.pill.appendChild(row);
      const lines = document.createElement('div');
      lines.className = 'sayings';
      SAYINGS.forEach((text, i) => {
        const b = document.createElement('button');
        b.textContent = text;
        b.addEventListener('pointerdown', (ev) => { ev.preventDefault(); ev.stopPropagation(); this.sayLine(i); this.emotesOpen = 0; this.paintNow(); });
        lines.appendChild(b);
      });
      this.pill.appendChild(lines);
    }
  }

  /** A line to the room (by number). */
  sayLine(i) {
    if (!this.active || !SAYINGS[i]) return;
    this.room.send({ t: 'say', i });
    this.g.hud.callout(`YOU: ${SAYINGS[i]}`, 'small');
    this.g.audio.pop();
  }

  update(dt) {
    const g = this.g;
    const show = this.active && ['aim', 'swing', 'flight', 'settle', 'holed', 'result', 'fishing', 'summary', 'nabe', 'skip'].includes(g.state);
    // What the camera is about (nobody may stand in front of it): my ball as I
    // line up, or the friend's ball I am watching from the result card
    const lining = ['aim', 'swing'].includes(g.state) && g.rig?.mode !== 'gallery';
    const watched = g.state === 'result' && this.spectId ? this.others.map.get(this.spectId) : null;
    const focus = lining ? g.ball : watched ? (watched.flying ? watched.sim : watched.ball.position) : null;
    if (g.world) this.others.update(dt, g.world, g.env, g.camera, show, focus, watched?.id);
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
