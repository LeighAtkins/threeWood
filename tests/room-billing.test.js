import test from 'node:test';
import assert from 'node:assert/strict';
import worker, { RoomObject } from '../server/room.js';

function state(saved = null) {
  return {
    saved, alarm: null, writes: 0, sockets: [],
    storage: {
      async get() { return structuredClone(saved); },
      async put(key, value) { saved = structuredClone(value); },
      async deleteAlarm() { this.owner.alarm = null; },
      async setAlarm(at) { this.owner.alarm = at; this.owner.writes++; },
      async deleteAll() { saved = null; },
    },
    blockConcurrencyWhile(fn) { this.ready = fn(); },
    getWebSockets() { return this.sockets; },
  };
}
function make(saved, enabled = 'true') {
  const s = state(saved); s.storage.owner = s;
  return { s, room: new RoomObject(s, { ROOMS_ENABLED: enabled }) };
}

test('disabled and missing flags reject ingress without touching the namespace', async () => {
  for (const env of [{}, { ROOMS_ENABLED: 'false' }]) {
    env.ROOMS = { get() { throw Error('must not reach DO'); } };
    assert.equal((await worker.fetch(new Request('https://rooms.test/new'), env)).status, 503);
    assert.equal((await worker.fetch(new Request('https://rooms.test/room/ABCD'), env)).status, 503);
  }
});

test('disabled object cancels old alarms without rearming, including socket events', async () => {
  const { s, room } = make(null, 'false'); await s.ready;
  s.alarm = Date.now();
  await room.alarm(); await room.webSocketMessage({}, '{}'); await room.drop({});
  assert.equal(s.alarm, null); assert.equal(s.writes, 0);
});

test('empty cleanup survives hibernation and terminates', async () => {
  const { s, room } = make({ players: [], created: Date.now() }); await s.ready;
  await room.alarm();
  const saved = await s.storage.get('room');
  assert.ok(saved.emptySince); assert.ok(s.alarm);
  saved.emptySince = Date.now() - 61_000;
  const restored = make(saved); await restored.s.ready;
  await restored.room.alarm();
  assert.equal(restored.s.alarm, null);
  assert.equal(await restored.s.storage.get('room'), null);
  assert.equal(restored.s.writes, 0);
});

test('hard lifetime stops a room even with players and a saved round', async () => {
  const { s, room } = make({ players: [['p', { id: 'p' }]], created: Date.now() - 7_200_001, round: { seed: 'x' } });
  await s.ready; await room.alarm();
  assert.equal(s.alarm, null); assert.equal(await s.storage.get('room'), null);
});

test('bots cannot keep ticking without connected humans', async () => {
  const { s, room } = make(null); await s.ready;
  room.bots = { list: [{}], pending: [] }; room.round = {}; room.botNet = { g: { world: {} } };
  assert.equal(room.botsPlaying(), false);
  await room.scheduleTick(); assert.equal(s.writes, 0);
});


test('disconnected seats expire after eviction using persisted away time', async () => {
  const { s, room } = make({ players: [['p', { id: 'p', away: Date.now() - 181_000 }]], created: Date.now() - 200_000 });
  await s.ready; await room.alarm();
  assert.equal(room.players.size, 0);
  assert.ok((await s.storage.get('room')).emptySince);
});
