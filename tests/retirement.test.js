import test from 'node:test';
import assert from 'node:assert/strict';
import { readFileSync } from 'node:fs';
import retired from '../server/retired.js';

test('production multiplayer deployment is stateless and deletes only RoomObject', () => {
  const config = readFileSync(new URL('../server/wrangler.toml', import.meta.url), 'utf8');
  assert.match(config, /main = "retired.js"/);
  assert.match(config, /workers_dev = false/);
  assert.match(config, /preview_urls = false/);
  assert.match(config, /routes = \[\]/);
  assert.doesNotMatch(config, /\[\[durable_objects\.bindings\]\]/);
  assert.match(config, /deleted_classes = \["RoomObject"\]/);
  assert.doesNotMatch(config, /UsageBudget/);
});

test('retirement stub cannot touch any paid service binding', async () => {
  const env = new Proxy({}, { get() { assert.fail('no service bindings may be accessed'); } });
  const response = await retired.fetch(new Request('https://retired.invalid/new'), env);
  assert.equal(response.status, 410);
  assert.match(await response.text(), /retired/);
});
