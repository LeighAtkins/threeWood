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
