import test from 'node:test';
import assert from 'node:assert/strict';
import { Room } from '../src/net/room.js';
import { MULTIPLAYER_ENABLED } from '../src/net/config.js';

test('default browser build cannot host, join or reconnect to the parked backend', async () => {
  assert.equal(MULTIPLAYER_ENABLED, false);
  const failures = [];
  const room = { fail: (reason) => failures.push(reason) };
  // No fetch/WebSocket mocks: any attempted network path would fail against
  // this intentionally minimal object before reaching its expected success.
  await Room.prototype.host.call(room);
  Room.prototype.join.call(room, 'ABCD');
  Room.prototype.connect.call(room, true);
  assert.equal(failures.length, 3);
  assert.ok(failures.every((reason) => reason.includes('offline')));
});
