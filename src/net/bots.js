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
import { buildLaunch, readPutt, slopeAlong } from '../core/shotPlanner.js';
import { strikeFromTiming } from '../core/swing.js';
import { aimTarget } from '../course/courseWorld.js';
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
    // Each bot tees up on its own spot across the tee box (the people take the
    // middle), so eight campers are not stacked on one ball
    const { tee, cup } = world;
    const d = Math.hypot(cup.x - tee.x, cup.z - tee.z) || 1;
    const sx = -(cup.z - tee.z) / d, sz = (cup.x - tee.x) / d, bx = -(cup.x - tee.x) / d, bz = -(cup.z - tee.z) / d;
    this.list.forEach((b, k) => {
      b.strokes = 0; b.putts = 0; b.drive = 0; b.pin = null; b.holed = false;
      b.rng = mulberry32(hashSeed(`${round.seed}:${b.id}:${round.index}`));
      const side = (k % 2 ? 1 : -1) * Math.ceil((k + 1) / 2) * 1.1, back = 0.6 + (k % 3) * 0.5;
      placeBall(b.ball, world, tee.x + sx * side + bx * back, tee.z + sz * side + bz * back);
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
      const read = readPutt(world, ball);
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

  update(dt) {
    const { round, world } = this.game;
    if (!round || !world) return;
    for (const b of this.list) {
      b.t -= dt;
      const lvl = BOT_LEVELS[b.level] || BOT_LEVELS.par;
      if (b.state === 'arriving' && b.t <= 0) {
        // Line up for a while, then READY
        b.state = 'thinking'; b.t = lvl.think[0] + Math.random() * (lvl.think[1] - lvl.think[0]);
        const target = world.spec.green.channel || lieFor(b.ball.surface).id === 'green' ? world.cup : aimTarget(world, b.ball.x, b.ball.z);
        b.aim = Math.atan2(target.z - b.ball.z, target.x - b.ball.x);
        const lie = lieFor(b.ball.surface);
        const club = lie.id === 'green' || world.spec.green.channel ? null : autoSelectClub(Math.hypot(target.x - b.ball.x, target.z - b.ball.z), lie, b.strokes === 0);
        b.kind = !club ? 'putter' : club.id === 'driver' || club.id === 'wood3' ? 'wood' : 'iron';
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
