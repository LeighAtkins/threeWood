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
