import test from 'node:test';
import assert from 'node:assert/strict';
import { createPlayReporter } from '../src/core/engagement.js';

test('engagement sends only allowlisted static paths, once per lifecycle event', () => {
  const paths = [], round = { seed: 'private', scores: [4] };
  const report = createPlayReporter({ send: (path) => paths.push(path) });
  assert.deepEqual(paths, []); // loading a page creates no engagement event
  assert.equal(report('round-started', round), true);
  assert.equal(report('round-started', round), false);
  assert.equal(report('hole-completed', round, 0), true);
  assert.equal(report('hole-completed', round, 0), false);
  assert.equal(report('hole-completed', round, 1), true);
  assert.equal(report('../anything', round), false);
  assert.deepEqual(paths, ['/play-events/round-started.txt', '/play-events/hole-completed.txt', '/play-events/hole-completed.txt']);
});

test('engagement respects privacy opt-out and an absolute per-page event cap', () => {
  const paths = [];
  const report = createPlayReporter({ send: (path) => paths.push(path), limit: 2 });
  report('round-started', {}); report('round-started', {}); report('round-started', {});
  assert.equal(paths.length, 2);
  const optedOut = createPlayReporter({ send: () => assert.fail('opt-out must not send'), optedOut: () => true });
  assert.equal(optedOut('round-started', {}), false);
});

test('a failed engagement request never interrupts play', async () => {
  const report = createPlayReporter({ send: async () => { throw Error('offline'); } });
  assert.equal(report('round-started', {}), true);
  await new Promise((resolve) => setImmediate(resolve));
});
