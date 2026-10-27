// -----------------------------------------------------------------------------
// The polling: the device and its states, the blocks a model lacks, the
// failures and their backoff, the period on the monotonic clock only, the
// test button, the reconnection to Gladys.
// -----------------------------------------------------------------------------

import { test } from 'node:test';
import assert from 'node:assert/strict';
import { createFakeGladys } from '@gladysassistant/integration-sdk/testing';
import { buildDevice } from '../src/devices.js';
import { fakeCtc } from './fixtures/fakeCtc.js';
import { spyOn } from './kit/clock.mjs';
import { CONFIG, ID, MINUTE, SECOND, setup, stateOf } from './helpers/app.js';

const rounds = (ctc) => ctc.log.filter((l) => l === 'r:62000+98').length;

test('a round: the device in Discovery, the states, the badge, the status', async () => {
  const ctx = await setup();
  const device = ctx.gladys.fake.discoveredDevices[0];
  assert.equal(device.external_id, 'ext:ctc:heat-pump:ctc');
  const ids = device.features.map((f) => f.external_id);
  assert.ok(ids.includes(ID('heating-mode')) && ids.includes(ID('temperature-outdoor')));
  assert.ok(!ids.includes(ID('temperature-brine-in')), 'never read: no feature');
  assert.equal(stateOf(ctx.gladys, 'temperature-outdoor'), -3.5);
  assert.equal(stateOf(ctx.gladys, 'heatpump-status'), 'Compresseur en marche, chauffage');
  assert.equal(stateOf(ctx.gladys, 'room-setpoint'), 21, "the controller's own setting");
  assert.equal(ctx.gladys.fake.transports.at(-1).transport, 'local');
  assert.equal(ctx.gladys.fake.connectionStatus.connected, true);
  await ctx.app.stop();
});

test('every select option label is a string; no switch nor writable binary', () => {
  const gladys = createFakeGladys({ selector: 'ctc' });
  for (const language of ['fr', 'en']) {
    const device = buildDevice(gladys, { roles: new Set(['compressor']), language });
    for (const feature of device.features) {
      for (const option of feature.supported_options ?? []) {
        assert.equal(typeof option.label, 'string');
        assert.equal(typeof option.value, 'string');
      }
      assert.notEqual(feature.category, 'switch');
      if (feature.type === 'binary') assert.equal(feature.read_only, true, feature.external_id);
    }
  }
});

test('a block the model lacks: silent 3 rounds while others answer, then left out', async () => {
  const ctc = fakeCtc({ missing: [[62331, 62342]] });
  const ctx = await setup({ ctc });
  await ctx.wait(2 * 35 * SECOND);
  assert.equal(ctx.app.missing.has(62331), true);
  const asked = ctc.log.filter((l) => l.startsWith('r:62331')).length;
  await ctx.wait(2 * 35 * SECOND);
  assert.equal(ctc.log.filter((l) => l.startsWith('r:62331')).length, asked);
  assert.equal(ctx.app.online, true);
  assert.match(ctx.gladys.fake.connectionStatus.message.en, /62331/);
  await ctx.app.stop();
});

test('nothing answers: round failed, values not republished, backoff never under the interval', async () => {
  const ctx = await setup();
  const before = ctx.gladys.fake.states.length;
  ctx.ctc.behave = () => 'silent';
  await ctx.wait(40 * SECOND);
  assert.equal(ctx.app.online, false);
  assert.equal(ctx.gladys.fake.connectionStatus.connected, false);
  assert.equal(ctx.gladys.fake.transports.at(-1).transport, 'unreachable');
  const values = ctx.gladys.fake.states
    .slice(before)
    .filter((s) => s.device_feature_external_id === ID('temperature-outdoor'));
  assert.equal(values.length, 0);
  const spy = spyOn(ctx.app, 'round', ctx.clock);
  await ctx.wait(8 * MINUTE);
  const gaps = spy.calls.slice(1).map((c, i) => c.at - spy.calls[i].at);
  assert.ok(gaps.length >= 2);
  assert.ok(
    gaps.every((g) => g >= 30 * SECOND),
    `gaps ${gaps}`,
  );
  await ctx.app.stop();
});

test('the period is the interval on the monotonic clock: a wall clock jump changes nothing', async () => {
  const wall = { offset: 0 };
  const ctx = await setup({ wall });
  const spy = spyOn(ctx.app, 'round', ctx.clock);
  await ctx.wait(10 * SECOND);
  wall.offset = -3 * 3600 * SECOND;
  await ctx.wait(30 * SECOND);
  wall.offset = 5 * 3600 * SECOND;
  await ctx.wait(60 * SECOND);
  const gaps = spy.calls.slice(1).map((c, i) => c.at - spy.calls[i].at);
  assert.equal(spy.calls.length, 3, `rounds at ${spy.calls.map((c) => c.at)}`);
  assert.ok(
    gaps.every((g) => g >= 30 * SECOND && g < 30.5 * SECOND),
    `gaps ${gaps}`,
  );
  await ctx.app.stop();
});

test('the test button never reads sooner than the interval', async () => {
  const ctx = await setup();
  const n = rounds(ctx.ctc);
  for (let i = 0; i < 3; i += 1) {
    await ctx.during(ctx.app.testConnection());
    await ctx.wait(11 * SECOND);
  }
  assert.ok(rounds(ctx.ctc) <= n + 1, `${rounds(ctx.ctc) - n} extra rounds`);
  await ctx.app.stop();
});

test('reconnection to Gladys: status, Discovery and badge again; no extra read', async () => {
  const ctx = await setup();
  const n = rounds(ctx.ctc);
  const discovered = ctx.gladys.fake.bodies('POST', '/discovered_device').length;
  await ctx.during(ctx.app.connected(CONFIG));
  assert.equal(rounds(ctx.ctc), n);
  assert.equal(ctx.gladys.fake.bodies('POST', '/discovered_device').length, discovered + 1);
  await ctx.app.stop();
});

test('no address: the status asks for one; an invalid one is shown bounded, without controls', async () => {
  const ctx = await setup({ config: { address: 'http://bad host\u0007/x' } });
  const message = ctx.gladys.fake.connectionStatus.message.fr;
  assert.match(message, /Saisissez/);
  assert.ok(!message.includes(String.fromCharCode(7)));
  for (const bad of ['224.0.0.1', '0.0.0.0', '192.168.1.255', '255.255.255.255', 'a..b']) {
    await ctx.during(ctx.app.configUpdated({ address: bad }));
    assert.equal(ctx.app.config.address, undefined, bad);
  }
  await ctx.app.stop();
});

test('a feature of the created device is never lost when a value goes missing', async () => {
  const ctx = await setup();
  ctx.ctc.registers[62000] = 9999;
  await ctx.wait(31 * SECOND);
  const ids = ctx.gladys.fake.discoveredDevices[0].features.map((f) => f.external_id);
  assert.ok(ids.includes(ID('temperature-outdoor')));
  await ctx.wait(MINUTE);
  await ctx.app.stop();
});
