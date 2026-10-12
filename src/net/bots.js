/**
 * Bots: campers who fill the empty seats in a room.
 *
 * A room holds eight. Any seat a friend has not taken can be given to a bot
 * from the lobby, so one person can play a full group tonight and two friends
 * can have company. Bots run on the host's phone and speak the same messages
 * a remote player would (at, status, shot, holed, done), relayed to the
 * guests under their own ids, so every phone sees them the way it sees a
 * person: walking to their ball, swinging, holing out, sitting by the fire.
 *
 * The golf is the same planner the game uses (core/shotPlanner), with a
 * skill knob for how sloppy the timing and power are. Nothing a bot does is
 * decided by anyone but the host, so no two phones can disagree about them.
 */

import { createBall, placeBall, launchBall, puttBall, simulate } from '../core/ballSim.js';
import { autoSelectClub, lieFor, powerFor } from '../core/clubs.js';
import { buildLaunch, slopeAlong } from '../core/shotPlanner.js';
import { strikeFromTiming } from '../core/swing.js';
import { aimTarget, teeSlot } from '../course/courseWorld.js';
import { pathLength, pathInfo, pointAlongPath } from '../course/shapes.js';
import { mulberry32, hashSeed } from '../core/rng.js';
import { HAIR_STYLES, EYE_SHAPES, OUTFITS } from '../core/camp.js';
import { classify, HAPPENINGS, QUIPS } from '../core/happenings.js';
import { CARDS, deal, targetFor } from '../core/cards.js';

export const BOT_LEVELS = {
  easy: { label: 'Easy', skill: 1.3, think: [2.2, 3.8] },
  par:  { label: 'Par',  skill: 0.75, think: [1.6, 3.0] },
  pro:  { label: 'Pro',  skill: 0.32, think: [1.2, 2.2] },
};
// How each bot carries itself: how chatty it is about the funny and the good,
// how fond of mischief, and whether it answers with words or a face
const PERSONAS = {
  cheeky: { lol: 0.8, wow: 0.35, mean: 0.9, face: '😂' },
  cheery: { lol: 0.3, wow: 0.85, mean: 0.3, face: '👏' },
  grumpy: { lol: 0.45, wow: 0.2, mean: 0.75, face: '😱' },
  quiet:  { lol: 0.15, wow: 0.25, mean: 0.5, face: '👏' },
};
const personaOf = (b) => PERSONAS[Object.keys(PERSONAS)[hashSeed(String(b.id)) % 4]];

export const NAMES = ['Rin', 'Nade', 'Chiaki', 'Aoi', 'Ena', 'Minami', 'Saito', 'Toba', 'Ayano', 'Akari', 'Haru', 'Momo'];

/** A fresh bot's look and name, different each time. */
export function botLook(i, taken = []) {
  const r = mulberry32(hashSeed(`bot-${Date.now()}-${i}-${Math.random()}`));
  const pick = (a) => a[Math.floor(r() * a.length)];
  const name = NAMES.filter((n) => !taken.includes(n))[Math.floor(r() * Math.max(1, NAMES.length - taken.length))] || `Bot ${i + 1}`;
  return {
    body: r() < 0.5 ? 'girl' : 'boy', skin: Math.floor(r() * 4), hair: pick(HAIR_STYLES), hairColor: Math.floor(r() * 7),
    eyes: Math.floor(r() * 6), eyeShape: pick(EYE_SHAPES), extra: r() < 0.25 ? 'glasses' : 'none',
    outfit: pick(OUTFITS).id, name,
  };
}

export class Bots {
  /** @param {object} net  the NetPlay (host side); it relays our messages */
  constructor(net) {
    this.net = net;
    this.list = []; // { id, level, ball, strokes, total, rng, state, t, ... }
  }

  get game() { return this.net.g; }

  add(level = 'par') {
    const n = this.list.length;
    const bot = { id: `bot-${n + 1}-${Math.random().toString(36).slice(2, 6)}`, level, ball: createBall(), strokes: 0, total: 0, state: 'idle', t: 0 };
    this.list.push(bot);
    return bot;
  }

  remove(id) { this.list = this.list.filter((b) => b.id !== id); }
  clear() { this.list = []; }
  get(id) { return this.list.find((b) => b.id === id); }

  /** A new hole: everyone back to the tee, lining up. */
  atHole(finished = new Set()) {
    const { world, round } = this.game;
    // Each bot tees up on its own seat's spot, like everyone else
    this.list.forEach((b) => {
      if (finished.has(b.id)) { b.state = 'finished'; return; }
      b.strokes = 0; b.putts = 0; b.drive = 0; b.pin = null; b.near = null; b.holed = false;
      // Cards from the last hole: a boost steadies the hands, mischief shakes them
      b.mod = b.nextMod || 1; b.nextMod = 1;
      b.rng = mulberry32(hashSeed(`${round.seed}:${b.id}:${round.index}`));
      const at = teeSlot(world, this.net.seatOf(b.id));
      placeBall(b.ball, world, at.x, at.z);
      this.arrive(b, 0.8 + Math.random() * 1.2);
    });
  }

  /** They are at their ball: say so, then get ready after a think. */
  arrive(b, delay) {
    const { round } = this.game;
    b.state = 'arriving'; b.t = delay;
    // On the walk over, now and then, a mushroom (the room hears about it)
    if (Math.random() < 0.09) {
      const r = Math.random();
      this.pending ||= [];
      this.pending.push({ id: b.id, t: delay * 0.5, msg: { t: 'hap', k: 'shroom', v: r < 0.05 ? 3 : r < 0.25 ? 2 : r < 0.6 ? 1 : 0 } });
    }
    this.net.deliverBot(b.id, { t: 'at', x: b.ball.x, z: b.ball.z, hole: round.index });
  }

  /** GO for these ids: the named bots swing. */
  go(ids) {
    for (const b of this.list) if (ids.includes(b.id) && b.state === 'ready') { b.state = 'swinging'; b.t = 0.9 + Math.random() * 0.6; }
  }

  /** Plan and play one shot. Returns the message describing it. */
  shot(b) {
    const { world, round } = this.game;
    const ball = b.ball;
    const env = { windX: world.spec.wind.x, windZ: world.spec.wind.z };
    const lvl = BOT_LEVELS[b.level] || BOT_LEVELS.par;
    const skill = lvl.skill * (b.mod || 1);
    const rng = b.rng;
    const onTee = b.strokes === 0;
    const lie = lieFor(ball.surface);
    const toPin = Math.hypot(world.cup.x - ball.x, world.cup.z - ball.z);
    const fromX = ball.x, fromZ = ball.z;
    let msg;
    if (lie.id === 'green' || (lie.id === 'fringe' && toPin < 12) || world.spec.green.channel) {
      // (read while thinking, a little each frame; a fallback if it was not done)
      const read = b.read || this.quickRead(b, 99);
      const paceError = 1 + (rng() - 0.5) * 0.3 * skill;
      const aimError = (rng() - 0.5) * 0.06 * skill;
      const c = Math.cos(aimError), s = Math.sin(aimError);
      const putt = { speed: read.speed * paceError, dirX: read.dirX * c - read.dirZ * s, dirZ: read.dirX * s + read.dirZ * c };
      puttBall(ball, putt);
      b.putts += 1;
      msg = { t: 'shot', kind: 'putt', x: fromX, z: fromZ, ...putt };
    } else {
      const target = aimTarget(world, ball.x, ball.z);
      const dist = Math.hypot(target.x - ball.x, target.z - ball.z);
      const club = autoSelectClub(dist, lie, onTee);
      const power = Math.min(100, powerFor(club, dist, lie.speedFactor) * (1 + (rng() - 0.5) * 0.16 * skill));
      const strike = strikeFromTiming((rng() - 0.5) * 1.1 * skill, club.loft, rng);
      const dirX = (target.x - ball.x) / dist, dirZ = (target.z - ball.z) / dist;
      const launch = buildLaunch({ club, power, lie, strike, scatter: rng() * 2 - 1, dirX, dirZ, slope: slopeAlong(world, ball, dirX, dirZ) });
      launchBall(ball, launch);
      msg = { t: 'shot', kind: 'full', x: fromX, z: fromZ, launch };
    }
    b.strokes += 1;
    // Where it ends up, and how long that takes: the phones fly the same
    // launch through the same physics, so they will agree
    // Pool on the green: the bot's ball can run into anyone's ball at rest
    // (other bots', and people's where they last said it lay)
    const targets = this.restingBalls(b);
    const knocks = [];
    const onStep = targets.length ? (bb, t) => {
      if (bb.mode === 'air' && bb.y - world.heightAt(bb.x, bb.z) > 0.12) return;
      for (const o of targets) {
        if (o.hit) continue;
        const dx = o.x - bb.x, dz = o.z - bb.z, d2 = dx * dx + dz * dz;
        if (d2 > 0.0081) continue;
        const d = Math.sqrt(d2) || 0.001, nx = dx / d, nz = dz / d;
        const vn = bb.vx * nx + bb.vz * nz;
        if (vn < 0.3) continue;
        o.hit = true;
        bb.vx -= vn * nx; bb.vz -= vn * nz;
        knocks.push({ who: o.id, x: o.x, z: o.z, vx: vn * nx * 0.92, vz: vn * nz * 0.92, t, s: { x: bb.x, y: bb.y, z: bb.z, vx: bb.vx, vy: bb.vy, vz: bb.vz, mode: bb.mode } });
      }
    } : null;
    const run = simulate(ball, world, env, { maxTime: 40, onStep });
    // (each knock reaches the room when the ball reaches it on their screens)
    this.pending ||= [];
    for (const k of knocks) this.pending.push({ id: b.id, t: k.t, msg: { t: 'knock', who: k.who, hole: round.index, x: k.x, z: k.z, vx: k.vx, vz: k.vz, s: k.s } });
    b.flightTime = Math.min(28, run.time ?? 8);
    // What the room will hear about it, once it has landed on their screens
    b.hap = classify({
      putt: msg.kind === 'putt', fromSurface: onTee ? 'tee' : lie.id, fromX, fromZ, cupX: world.cup.x, cupZ: world.cup.z,
      mode: ball.mode, surface: ball.surface, x: ball.x, z: ball.z, events: (run.events || []).map((e) => e.type), strokes: b.strokes, par: world.spec.par, lane: !!world.spec.green.channel,
    });
    if (onTee && world.spec.par > 3) b.drive = Math.hypot(ball.x - fromX, ball.z - fromZ);
    if (onTee && world.spec.par === 3 && (ball.mode === 'rest' || ball.mode === 'holed') && ball.surface === 'green') b.pin = Math.hypot(world.cup.x - ball.x, world.cup.z - ball.z);
    // The contests' numbers: first time on the green, how close (holed from off it: dead)
    if (b.near == null && msg.kind === 'full' && (ball.mode === 'holed' || (ball.mode === 'rest' && ball.surface === 'green'))) b.near = ball.mode === 'holed' ? 0 : Math.hypot(world.cup.x - ball.x, world.cup.z - ball.z);
    msg.hole = round.index;
    return msg;
  }

  /** The ball has stopped (or gone): next state. */
  landed(b) {
    const { world, round } = this.game;
    const ball = b.ball;
    if (b.hap) { const h = b.hap; b.hap = null; this.net.deliverBot(b.id, { t: 'hap', k: h.k, v: h.v }); this.heard(b.id, { t: 'hap', k: h.k }); }
    if (ball.mode === 'holed') {
      b.holed = true;
      this.net.deliverBot(b.id, { t: 'holed' });
      b.state = 'done'; b.t = 1.2;
      return;
    }
    if (ball.mode === 'water' || ball.mode === 'oob') {
      b.strokes += 1; // penalty, no fishing for bots
      placeBall(ball, world, ball.dryX, ball.dryZ);
    } else if (ball.mode !== 'rest') {
      ball.vx = ball.vy = ball.vz = 0; ball.mode = 'rest';
    } else {
      placeBall(ball, world, ball.x, ball.z);
    }
    if (b.strokes >= 12) { b.state = 'done'; b.t = 0.5; return; } // picked up
    this.arrive(b, 1.0 + Math.random() * 1.5);
    void round;
  }

  /**
   * Crazy golf: the furthest point down the lane the ball can reach in a
   * straight line without touching a wall (the cup itself if it is in sight).
   */
  laneTarget(ball) {
    const { world } = this.game;
    const ch = world.spec.green.channel, pts = ch.pts;
    const total = pathLength(pts), here = pathInfo(pts, ball.x, ball.z).along;
    for (let ahead = total - here; ahead > 2; ahead -= 1.5) {
      const p = ahead >= total - here - 0.01 ? world.cup : pointAlongPath(pts, here + ahead);
      let clear = true;
      for (let k = 1; k < 12 && clear; k++) {
        const x = ball.x + (p.x - ball.x) * (k / 12), z = ball.z + (p.z - ball.z) * (k / 12);
        if (pathInfo(pts, x, z).dist > ch.half - 0.5) clear = false;
      }
      if (clear) return { x: p.x, z: p.z };
    }
    return aimTarget(world, ball.x, ball.z);
  }

  /**
   * A bot's putt read, done a couple of simulations at a time while it
   * thinks (the full readPutt the bot used to call was hundreds of rolls in
   * one frame: a freeze on a phone every time a bot putted). Pace for the
   * straight line, then aim corrections from where the ball actually goes.
   * budget: simulations to spend now. Returns the read when it is done.
   */
  quickRead(b, budget = 2) {
    const { world } = this.game;
    const ball = b.ball;
    let r = b.reading;
    if (!r) {
      // The cup, or on crazy golf the next bend of the lane (never through a wall)
      const to = world.spec.green.channel ? this.laneTarget(ball) : world.cup;
      const dx = to.x - ball.x, dz = to.z - ball.z, dist = Math.hypot(dx, dz) || 1;
      r = b.reading = { dist, aim: Math.atan2(dz, dx), speed: null, tries: 0, best: null, to };
    }
    while (budget-- > 0) {
      const dirX = Math.cos(r.aim), dirZ = Math.sin(r.aim);
      if (r.speed === null) {
        // Pace by bisection, one roll per step (no cup, so it rolls on past)
        if (!r.pace) r.pace = { lo: 0.2, hi: Math.min(30, 1.5 + (r.dist + 0.45) * 0.9), n: 0, grow: 0 };
        const pc = r.pace, want = r.dist + 0.45;
        const mid = pc.grow < 5 && pc.n === 0 ? pc.hi : (pc.lo + pc.hi) / 2;
        const t = createBall();
        placeBall(t, world, ball.x, ball.z);
        puttBall(t, { speed: mid, dirX, dirZ });
        simulate(t, { ...world, cup: null }, null, { maxTime: 12 });
        const rolled = (t.x - ball.x) * dirX + (t.z - ball.z) * dirZ;
        const short = rolled < want && t.mode === 'rest';
        if (pc.grow < 5 && pc.n === 0) {
          // First make sure the ceiling is enough
          if (short) { pc.lo = pc.hi; pc.hi = Math.min(30, pc.hi * 1.8); pc.grow += 1; } else pc.grow = 5;
          if (pc.grow >= 5) pc.n = 1;
          continue;
        }
        if (short) pc.lo = mid; else pc.hi = mid;
        if (++pc.n > 12) r.speed = (pc.lo + pc.hi) / 2;
        continue;
      }
      // Crazy golf: try a few lines down the lane (pace scaled from the one
      // calibrated roll) and keep whichever finishes nearest the cup
      if (world.spec.green.channel) {
        const ch = world.spec.green.channel, pts = ch.pts, total = pathLength(pts);
        if (!r.cands) {
          const here = pathInfo(pts, ball.x, ball.z).along;
          const pts2 = [world.cup, r.to];
          for (const L of [6, 10, 15, 21]) if (here + L < total - 1) pts2.push(pointAlongPath(pts, here + L));
          r.cands = [];
          for (const p of pts2) for (const mult of [1, 1.18]) r.cands.push({ x: p.x, z: p.z, mult });
        }
        const c = r.cands.shift();
        if (c) {
          const d = Math.hypot(c.x - ball.x, c.z - ball.z) || 1, ang = Math.atan2(c.z - ball.z, c.x - ball.x);
          const speed = r.speed * Math.sqrt(d / r.dist) * c.mult;
          const t = createBall();
          placeBall(t, world, ball.x, ball.z);
          puttBall(t, { speed, dirX: Math.cos(ang), dirZ: Math.sin(ang) });
          simulate(t, world, null, { maxTime: 12 });
          const left = t.mode === 'holed' ? -1 : total - pathInfo(pts, t.x, t.z).along + Math.hypot(t.x - world.cup.x, t.z - world.cup.z) * 0.3;
          if (!r.best || left < r.best.left) r.best = { dirX: Math.cos(ang), dirZ: Math.sin(ang), speed, left, miss: left };
        }
        if (!r.cands.length || r.best?.left === -1) { b.read = r.best; b.reading = null; return b.read; }
        continue;
      }
      const test = createBall();
      placeBall(test, world, ball.x, ball.z);
      puttBall(test, { speed: r.speed, dirX, dirZ });
      simulate(test, world, null, { maxTime: 12 });
      const miss = test.mode === 'holed' ? 0 : Math.hypot(test.x - r.to.x, test.z - r.to.z);
      if (!r.best || miss < r.best.miss) r.best = { dirX, dirZ, speed: r.speed, miss };
      r.tries += 1;
      if (test.mode === 'holed' || r.tries >= 4) { b.read = r.best; b.reading = null; return b.read; }
      // Turn the aim by the angle the ball finished off the line
      const ex = test.x - ball.x, ez = test.z - ball.z;
      const off = Math.atan2(r.to.z - ball.z, r.to.x - ball.x) - Math.atan2(ez, ex);
      r.aim += Math.atan2(Math.sin(off), Math.cos(off)) * 0.9;
    }
    return null;
  }

  /**
   * Something happened in the room (anyone's 'hap', or a 'bonk'): a bot or
   * two may have something to say about it, a moment later. Bots only ever
   * send a quip's number; the phones hold the words.
   */
  heard(from, msg) {
    if (!this.list.length) return;
    // The board, as the bots know it: everyone's total from their 'done'
    this.totals ||= new Map();
    if (msg.t === 'done' && Number.isFinite(+msg.total)) this.totals.set(from, +msg.total);
    // Where people's balls lie (for a bot's ball to run into): from their 'at', gone once they hit
    this.lies ||= new Map();
    if (msg.t === 'at' && Number.isFinite(+msg.x) && Number.isFinite(+msg.z) && !this.get(from)) this.lies.set(from, { x: +msg.x, z: +msg.z, hole: msg.hole });
    if (msg.t === 'shot' || msg.t === 'holed' || msg.t === 'done') this.lies.delete(from);
    if (msg.t === 'knock') { this.lies.delete(msg.who); this.knocked(msg); return; }
    if (msg.t === 'card' && CARDS[msg.id]?.kind === 'mischief') {
      const b = this.list.find((x) => x.id === msg.to);
      if (b) {
        b.nextMod = (b.nextMod || 1) * 1.35;
        // (and they have something to say about it)
        this.pending ||= [];
        this.pending.push({ id: b.id, t: 1 + Math.random(), msg: { t: 'emote', e: Math.random() < 0.5 ? '😱' : '😂', to: from } });
      }
      return;
    }
    let kind = null, to = from, only = null;
    const SAY = ['niceshot', 'unlucky', 'fore', 'hurry', 'watch', 'gg'];
    if (msg.t === 'say' && SAY[msg.i]) kind = SAY[msg.i];
    if (msg.t === 'hap' && QUIPS[msg.k]) kind = msg.k;
    else if (msg.t === 'bonk' && typeof msg.who === 'string') { kind = 'bonked'; to = typeof msg.by === 'string' ? msg.by : from; only = msg.who; }
    if (!kind) return;
    const tone = HAPPENINGS[kind]?.tone || 'lol';
    this.pending ||= [];
    // (a volley of eight shots is a lot of news: two lines waiting is plenty)
    if (!only && this.pending.length >= 2) return;
    // A bot that was hit always says so; otherwise whoever's nature it is to chip in, one or two
    const pool = this.list.filter((b) => (only ? b.id === only : b.id !== from));
    const keen = only ? pool : pool.filter((b) => Math.random() < (msg.t === 'say' ? 0.5 : personaOf(b)[tone === 'lol' ? 'lol' : 'wow'] ?? 0.4));
    keen.sort(() => Math.random() - 0.5);
    keen.slice(0, only ? keen.length : 2).forEach((b, i) => {
      const p = personaOf(b);
      // Words, or just a face at them (which lands on them, like a person's)
      const msg2 = !only && msg.t === 'hap' && Math.random() < 0.4
        ? { t: 'emote', e: tone !== 'lol' ? '👏' : p.face === '👏' ? '😱' : p.face, to }
        : { t: 'quip', k: kind, i: Math.floor(Math.random() * QUIPS[kind].length), to };
      this.pending.push({ id: b.id, t: 0.7 + Math.random() * 1.6 + i * 0.8, msg: msg2 });
    });
  }

  /** Balls at rest on this hole, other than b's: bots lining up, and people's last lies. */
  restingBalls(b) {
    const { round } = this.game;
    const out = [];
    for (const o of this.list) if (o !== b && ['arriving', 'thinking', 'ready'].includes(o.state)) out.push({ id: o.id, x: o.ball.x, z: o.ball.z });
    for (const [id, l] of this.lies || []) if (l.hole === round.index) out.push({ id, x: l.x, z: l.z });
    return out;
  }

  /**
   * Someone's ball ran into a bot's ball at rest: it rolls (no stroke) and the
   * bot walks over and thinks again. A knock while it is swinging is ignored.
   */
  knocked(msg) {
    const { world, round } = this.game;
    const b = this.list.find((x) => x.id === msg.who);
    if (!b || !world || !round || msg.hole !== round.index || !['arriving', 'thinking', 'ready'].includes(b.state)) return;
    const vx = +msg.vx || 0, vz = +msg.vz || 0, speed = Math.hypot(vx, vz);
    if (!(speed > 0.05) || speed > 20) return;
    puttBall(b.ball, { speed, dirX: vx / speed, dirZ: vz / speed });
    const run = simulate(b.ball, world, { windX: world.spec.wind.x, windZ: world.spec.wind.z }, { maxTime: 20 });
    b.read = null; b.hap = null;
    b.state = 'flying';
    b.t = Math.min(20, run.time ?? 3) + 0.5;
  }

  /** A bot's Camp Card, a moment after it finishes: often mischief for whoever is just above it. */
  playCard(b) {
    const ids = [...(this.totals || new Map()).entries()].sort((x, y) => x[1] - y[1]).map(([id]) => id);
    const rank = Math.max(1, ids.indexOf(b.id) + 1);
    const hand = deal(Math.random, rank, Math.max(ids.length, 2), this.mischief !== false);
    const mean = hand.filter((id) => CARDS[id].kind === 'mischief');
    const to = targetFor(ids, b.id);
    const id = mean.length && to && Math.random() < personaOf(b).mean ? mean[Math.floor(Math.random() * mean.length)] : hand.find((x) => CARDS[x].kind === 'self');
    if (!id) return;
    if (CARDS[id].kind === 'self') b.nextMod = (b.nextMod || 1) * 0.85;
    this.pending ||= [];
    this.pending.push({ id: b.id, t: 2 + Math.random() * 3, msg: CARDS[id].kind === 'mischief' ? { t: 'card', id, to } : { t: 'card', id } });
  }

  update(dt) {
    const { round, world } = this.game;
    if (this.pending?.length) {
      for (const p of this.pending) p.t -= dt;
      for (const p of this.pending.filter((q) => q.t <= 0)) {
        if (!this.list.some((b) => b.id === p.id)) continue;
        this.net.deliverBot(p.id, p.msg);
        if (p.msg.t === 'card' || p.msg.t === 'hap' || p.msg.t === 'knock') this.heard(p.id, p.msg); // (bots pick on bots too)
      }
      this.pending = this.pending.filter((q) => q.t > 0);
    }
    if (!round || !world) return;
    let budget = 3; // short rolls a frame, shared by all the bots
    for (const b of this.list) {
      b.t -= dt;
      const lvl = BOT_LEVELS[b.level] || BOT_LEVELS.par;
      if (b.state === 'arriving' && b.t <= 0) {
        // Line up for a while, then READY
        b.state = 'thinking'; b.t = lvl.think[0] + Math.random() * (lvl.think[1] - lvl.think[0]);
        b.read = null; b.reading = null;
        const target = world.spec.green.channel || lieFor(b.ball.surface).id === 'green' || lieFor(b.ball.surface).id === 'fringe' ? world.cup : aimTarget(world, b.ball.x, b.ball.z);
        b.aim = Math.atan2(target.z - b.ball.z, target.x - b.ball.x);
        const lie = lieFor(b.ball.surface);
        // (the same test as shot() uses to putt, so a putt is always read in advance)
        const toPin = Math.hypot(world.cup.x - b.ball.x, world.cup.z - b.ball.z);
        const putting = lie.id === 'green' || (lie.id === 'fringe' && toPin < 12) || world.spec.green.channel;
        const club = putting ? null : autoSelectClub(Math.hypot(target.x - b.ball.x, target.z - b.ball.z), lie, b.strokes === 0);
        b.kind = !club ? 'putter' : club.id === 'driver' || club.id === 'wood3' ? 'wood' : 'iron';
      } else if (b.state === 'thinking' && b.kind === 'putter' && !b.read) {
        // (ready only once the read is done; the bots take turns, one
        // simulation a frame between them, so a green full of bots reading
        // their putts never stalls a frame)
        while (budget > 0 && !b.read) { budget -= 1; this.quickRead(b, 1); }
      } else if (b.state === 'thinking' && b.t <= 0) {
        b.state = 'ready';
        this.net.deliverBot(b.id, { t: 'status', s: 'ready', aim: b.aim, kind: b.kind });
      } else if (b.state === 'swinging' && b.t <= 0) {
        this.net.deliverBot(b.id, { t: 'status', s: 'swing', aim: b.aim, kind: b.kind });
        b.state = 'striking'; b.t = 0.75;
      } else if (b.state === 'striking' && b.t <= 0) {
        const msg = this.shot(b);
        this.net.deliverBot(b.id, msg);
        b.state = 'flying'; b.t = b.flightTime + 0.6;
      } else if (b.state === 'flying' && b.t <= 0) {
        this.landed(b);
      } else if (b.state === 'done' && b.t <= 0) {
        b.state = 'finished';
        b.total += b.strokes - world.spec.par;
        this.net.deliverBot(b.id, { t: 'done', hole: round.index, strokes: b.strokes, total: b.total, putts: b.putts, drive: b.drive || 0, pin: b.pin ?? null, near: b.near ?? null });
        this.heard(b.id, { t: 'done', total: b.total });
        this.playCard(b);
      }
    }
  }
}
