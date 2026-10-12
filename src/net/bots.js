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

export const BOT_LEVELS = {
  easy: { label: 'Easy', skill: 1.3, think: [2.2, 3.8] },
  par:  { label: 'Par',  skill: 0.75, think: [1.6, 3.0] },
  pro:  { label: 'Pro',  skill: 0.32, think: [1.2, 2.2] },
};
const NAMES = ['Rin', 'Nade', 'Chiaki', 'Aoi', 'Ena', 'Minami', 'Saito', 'Toba', 'Ayano', 'Akari', 'Haru', 'Momo'];

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
  atHole() {
    const { world, round } = this.game;
    // Each bot tees up on its own seat's spot, like everyone else
    this.list.forEach((b) => {
      b.strokes = 0; b.putts = 0; b.drive = 0; b.pin = null; b.holed = false;
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
    const skill = lvl.skill;
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
    const run = simulate(ball, world, env, { maxTime: 40 });
    b.flightTime = Math.min(28, run.time ?? 8);
    if (onTee && world.spec.par > 3) b.drive = Math.hypot(ball.x - fromX, ball.z - fromZ);
    if (onTee && world.spec.par === 3 && (ball.mode === 'rest' || ball.mode === 'holed') && ball.surface === 'green') b.pin = Math.hypot(world.cup.x - ball.x, world.cup.z - ball.z);
    msg.hole = round.index;
    return msg;
  }

  /** The ball has stopped (or gone): next state. */
  landed(b) {
    const { world, round } = this.game;
    const ball = b.ball;
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

  update(dt) {
    const { round, world } = this.game;
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
        this.net.deliverBot(b.id, { t: 'done', strokes: b.strokes, total: b.total, drive: b.drive || 0, pin: b.pin ?? null });
      }
    }
  }
}
