import test from 'node:test';
import assert from 'node:assert/strict';
import { contestFor, judgeContest, perkFor, CONTESTS, PERKS } from '../src/core/contests.js';
import { designHole, roundHoles } from '../src/course/holeDesigner.js';
import { buildWorld, teeSlot } from '../src/course/courseWorld.js';

test('the first hole is the classic contest and later ones are seeded and valid for the par', () => {
  assert.equal(contestFor('ABCD', 0, 4).id, 'drive');
  assert.equal(contestFor('ABCD', 0, 3).id, 'pin');
  for (let i = 1; i < 18; i++) {
    for (const par of [3, 4, 5]) {
      const c = contestFor('ABCD', i, par);
      assert.ok(CONTESTS[c.id], 'a known contest');
      assert.deepEqual(c, contestFor('ABCD', i, par), 'deterministic');
      if (c.id === 'drive') assert.notEqual(par, 3);
      if (c.id === 'pin') assert.equal(par, 3);
    }
    assert.ok(['hole', 'putts'].includes(contestFor('ABCD', i, 2, 'minigolf').id));
    assert.ok(PERKS[perkFor('ABCD', i).id]);
  }
});

test('judging: best wins, ties break on the tie stat, dead heats crown nobody', () => {
  const drive = CONTESTS.drive;
  assert.deepEqual(judgeContest(drive, [{ id: 'a', stats: { drive: 210 } }, { id: 'b', stats: { drive: 240 } }]), { id: 'b', v: 240 });
  assert.equal(judgeContest(drive, [{ id: 'a', stats: { drive: 12 } }]), null, 'a topped tee shot is no drive');
  assert.equal(judgeContest(drive, [{ id: 'a', stats: { drive: 200 } }, { id: 'b', stats: { drive: 200 } }]), null);
  const pin = CONTESTS.pin;
  assert.equal(judgeContest(pin, [{ id: 'a', stats: { pin: 4 } }, { id: 'b', stats: { pin: null } }]).id, 'a');
  const putts = CONTESTS.putts;
  assert.equal(judgeContest(putts, [{ id: 'a', stats: { putts: 2, strokes: 5 } }, { id: 'b', stats: { putts: 2, strokes: 4 } }]).id, 'b');
  assert.equal(judgeContest(putts, [{ id: 'a', stats: { putts: 2, strokes: 4 } }, { id: 'b', stats: { putts: 2, strokes: 4 } }]), null);
  assert.equal(judgeContest(CONTESTS.hole, [{ id: 'a', stats: { strokes: 3, putts: 1 } }, { id: 'b', stats: { strokes: 3, putts: 2 } }]).id, 'a');
});

test('eight tee slots sit on two tiers of the tee, the back row a step down', () => {
  let checked = 0;
  for (const n of roundHoles(18)) {
    const w = buildWorld(designHole('TIER-SEED', n));
    if (w.spec.green.channel) continue;
    const teeY = w.heightAt(w.tee.x, w.tee.z);
    for (let i = 0; i < 8; i++) {
      const s = teeSlot(w, i);
      assert.equal(w.surfaceAt(s.x, s.z), 'tee', `slot ${i} on hole ${n} is on the tee`);
      const dy = w.heightAt(s.x, s.z) - teeY;
      if (i < 4) assert.ok(Math.abs(dy) < 0.02, `front row ${i} level`);
      else assert.ok(Math.abs(dy + 0.7) < 0.03, `back row ${i} a step down (${dy.toFixed(2)})`);
    }
    checked += 1;
  }
  assert.ok(checked >= 10);
});

import { classify, awards, quipText, QUIPS, HAPPENINGS } from '../src/core/happenings.js';

test('happenings: the shot classifier finds the funny and the good', () => {
  const base = { putt: false, fromSurface: 'fairway', fromX: 0, fromZ: 0, cupX: 100, cupZ: 0, mode: 'rest', surface: 'fairway', x: 50, z: 0, events: [], strokes: 2, par: 4 };
  assert.equal(classify({ ...base, mode: 'water' }).k, 'splash');
  assert.equal(classify({ ...base, events: ['land', 'tree'] }).k, 'tree');
  assert.equal(classify({ ...base, x: 12 }).k, 'topped');
  assert.equal(classify({ ...base, mode: 'holed', x: 100 }).k, 'chipin');
  assert.equal(classify({ ...base, mode: 'holed', x: 100, strokes: 1 }).k, 'ace');
  assert.equal(classify({ ...base, fromSurface: 'tee', x: 250, cupX: 400 }).k, 'bomb');
  assert.equal(classify({ ...base, surface: 'green', x: 99.5 }).k, 'dead');
  assert.equal(classify({ ...base, x: 60 }), null, 'an ordinary shot is not news');
  const putt = { ...base, putt: true, fromX: 0, cupX: 6, surface: 'green' };
  assert.equal(classify({ ...putt, x: 14 }).k, 'zoom');
  assert.equal(classify({ ...putt, mode: 'holed', x: 6, cupX: 10 }).k, 'snake');
  assert.equal(classify({ ...putt, cupX: 1, x: 0.6 }).k, 'yips');
  const answers = ['bonked', 'niceshot', 'unlucky', 'fore', 'hurry', 'watch', 'gg'];
  for (const k of Object.keys(QUIPS)) assert.ok(answers.includes(k) || HAPPENINGS[k], `quips for a known happening: ${k}`);
  assert.equal(quipText('splash', 0, 'Rin'), 'Bring a snorkel, Rin');
  assert.equal(quipText('nonsense', 0, 'Rin'), null);
});

test('awards: one each, most of the kind wins', () => {
  const counts = new Map([['a', { splash: 3, bomb: 1 }], ['b', { splash: 1, bomb: 2 }], ['c', { tree: 1 }]]);
  const list = awards(counts, ['a', 'b', 'c']);
  assert.deepEqual(list.map((x) => [x.award, x.id]), [['fish', 'a'], ['lumber', 'c'], ['rocket', 'b']]);
});

import { deal, combine, targetFor, CARDS } from '../src/core/cards.js';
import { mulberry32 } from '../src/core/rng.js';

test('camp cards: the leader gets no mischief, last place gets two; effects combine', () => {
  const rng = mulberry32(7);
  for (let i = 0; i < 50; i++) {
    const lead = deal(rng, 1, 8);
    assert.equal(lead.length, 3);
    assert.equal(new Set(lead).size, 3);
    assert.ok(lead.every((id) => CARDS[id].kind === 'self'));
    assert.equal(deal(rng, 8, 8).filter((id) => CARDS[id].kind === 'mischief').length, 2);
    assert.equal(deal(rng, 3, 8).filter((id) => CARDS[id].kind === 'mischief').length, 1);
  }
  assert.deepEqual(combine([]), { wind: 0, cup: 1, lieHalf: false, tight: 1 });
  const m = combine(['tailwind', 'rain', 'tiny'], { cup: 1.5 });
  assert.equal(m.wind, 1);
  assert.ok(Math.abs(m.cup - 1.08) < 1e-9);
  assert.equal(targetFor(['a', 'b', 'c'], 'c'), 'b');
  assert.equal(targetFor(['a', 'b', 'c'], 'a'), null);
});

import { eventFor, withEvent, EVENTS } from '../src/core/events.js';
import { createBall as mkBall, launchBall, simulate as sim, flatWorld as flat } from '../src/core/ballSim.js';
import { designHole as dh, roundHoles as rh } from '../src/course/holeDesigner.js';

test('room events: seeded, never on the first hole or crazy golf, and moon gravity floats', () => {
  const holes = rh(18);
  let seen = 0;
  for (let i = 0; i < holes.length; i++) {
    const spec = dh('EVENT-SEED', holes[i]);
    const ev = eventFor('EVENT-SEED', i, spec);
    assert.deepEqual(ev, eventFor('EVENT-SEED', i, spec));
    if (i === 0 || spec.green.channel) assert.equal(ev, null);
    if (ev) { seen += 1; assert.ok(EVENTS[ev.id]); assert.notEqual(withEvent(spec, ev), spec); }
  }
  assert.ok(seen >= 1 && seen <= 12, `some holes have events (${seen})`);
  const carry = (gravity) => {
    const b = mkBall(0, 0.02, 0);
    launchBall(b, { speed: 60, dirX: 1, dirZ: 0, loftDeg: 12, back: 3, side: 0 });
    sim(b, { ...flat('fairway'), gravity }, null, { stopOnLand: true });
    return b.x;
  };
  assert.ok(carry(9.81 * 0.55) > carry(0) * 1.3, 'a moon drive carries much further');
});

import { createBall as cb, placeBall as pb, puttBall as putt, simulate as run } from '../src/core/ballSim.js';
import { pathInfo as pinfo } from '../src/course/shapes.js';

test('crazy golf is a billiard table: no putt, however hard or wild, leaves the lane', () => {
  let lanes = 0, bounced = 0;
  for (const seed of ['LANE-A', 'LANE-B', 'LANE-C', 'LANE-D']) {
    for (const n of rh(18)) {
      const spec = dh(seed, n);
      if (!spec.green.channel) continue;
      const w = buildWorld(spec);
      lanes += 1;
      const L = w.lane, p = L.pts;
      let rng = 1;
      const r = () => ((rng = (rng * 16807) % 2147483647) / 2147483647);
      for (let k = 0; k < 60; k++) {
        const b = cb();
        pb(b, w, w.tee.x + (r() - 0.5) * 2, w.tee.z + (r() - 0.5) * 2);
        const a = r() * Math.PI * 2, speed = 2 + r() * 16;
        putt(b, { speed, dirX: Math.cos(a), dirZ: Math.sin(a) });
        const res = run(b, w, null, { maxTime: 25, onStep: (ball) => {
          const d = pinfo(p, ball.x, ball.z);
          // inside the side rails (on the nearest leg) and not past either end rail
          const s0 = { x: p[1].x - p[0].x, z: p[1].z - p[0].z }, l0 = Math.hypot(s0.x, s0.z);
          const back = -((ball.x - p[0].x) * s0.x + (ball.z - p[0].z) * s0.z) / l0;
          const m = p.length - 1, s1 = { x: p[m].x - p[m - 1].x, z: p[m].z - p[m - 1].z }, l1 = Math.hypot(s1.x, s1.z);
          const past = ((ball.x - p[m].x) * s1.x + (ball.z - p[m].z) * s1.z) / l1;
          assert.ok(back < L.end + 0.01 && past < L.end + 0.01, `${seed} hole ${n}: past an end rail (${back.toFixed(2)}, ${past.toFixed(2)})`);
          if (back <= 0 && past <= 0) assert.ok(d.dist < L.side + 0.01, `${seed} hole ${n}: over a side rail (${d.dist.toFixed(2)})`);
        } });
        if (res.events.some((e) => e.type === 'wall')) bounced += 1;
      }
    }
  }
  assert.ok(lanes >= 4, `crazy-golf holes found (${lanes})`);
  assert.ok(bounced > 20, `balls bounce off the rails (${bounced})`);
});
