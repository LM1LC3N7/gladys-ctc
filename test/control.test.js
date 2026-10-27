// -----------------------------------------------------------------------------
// The control: the heating off (protective, never refused), the commands
// behind the option, the keepalive of the volatile 1000 block, the order of
// the clicks, and the restart from /data.
// -----------------------------------------------------------------------------

import { test } from 'node:test';
import assert from 'node:assert/strict';
import { createMemoryStore } from '../src/store.js';
import { fakeCtc } from './fixtures/fakeCtc.js';
import { ALLOWED, CONFIG, ID, MINUTE, SECOND, command, setup, stateOf } from './helpers/app.js';

const writesTo = (ctc, address) => ctc.writes.filter((w) => w.address === address);

test('heating off without the option: written to 1015 = 0, acknowledged, kept in /data', async () => {
  const ctx = await setup();
  const out = await command(ctx, 'heating-mode', 'off');
  assert.equal(out.error, undefined);
  assert.deepEqual(
    writesTo(ctx.ctc, 1015).map((w) => w.value),
    [0],
  );
  assert.deepEqual(ctx.store.data.stop.host, '192.168.1.80');
  assert.equal(ctx.store.data.stop.port, 502);
  await ctx.wait(SECOND);
  assert.equal(stateOf(ctx.gladys, 'heating-mode'), 'off');
  assert.match(stateOf(ctx.gladys, 'overrides'), /Chauffage arrêté/);
  await ctx.app.stop();
});

test('heating off is never refused: offline controller, /data failing, getConfig never read', async () => {
  const ctc = fakeCtc();
  ctc.reachable = false;
  const store = createMemoryStore();
  store.fail = true;
  const ctx = await setup({ ctc, store });
  assert.equal(ctx.gladys.fake.connectionStatus.connected, false);
  const out = await command(ctx, 'heating-mode', 'off');
  // Not acknowledged yet: said so, never a success nor a refusal.
  assert.match(out.error.message, /pas encore acquitté/);
  assert.equal(ctx.app.heatingStop !== undefined, true);
  ctc.reachable = true;
  // Retried every 15 s (after the controller's settle time) until acknowledged.
  await ctx.wait(45 * SECOND);
  assert.ok(writesTo(ctc, 1015).length >= 1);
  assert.ok(ctx.app.heatingStop.ackedAt !== undefined);
  assert.match(JSON.stringify(ctx.gladys.fake.connectionStatus), /\/data/);
  await ctx.app.stop();
});

test('heating off never pipelined: it waits for the silent read, then passes before the queued reads', async () => {
  const ctc = fakeCtc();
  const ctx = await setup({ ctc });
  ctc.behave = (r) => (r.fn === 3 && r.address === 62191 ? 'silent' : undefined);
  const round = ctx.app.tick();
  await ctx.wait(400, 10);
  assert.ok(ctc.log.at(-1).startsWith('r:62191'), ctc.log.at(-1));
  const out = await command(ctx, 'heating-mode', 'off', 4 * SECOND);
  // The read times out after 5 s: not acknowledged within 3.5 s, said so.
  assert.match(out.error.message, /pas encore acquitté/);
  await ctx.during(round);
  const at = ctc.log.indexOf('w:1015=0');
  assert.equal(ctc.log[at - 1], 'r:62191+25', 'right after the silent read');
  assert.equal(ctc.log[at + 1], 'r:62234+13', 'before the queued reads');
  assert.equal(ctx.app.heatingStop.ackedAt !== undefined, true);
  await ctx.app.stop();
});

test('restart: the heating off in /data is written before the configuration is read', async () => {
  const store = createMemoryStore({
    version: 1,
    stop: { host: '192.168.1.80', port: 502, since: Date.UTC(2026, 9, 27) },
  });
  const ctx = await setup({ store, start: false });
  // getConfig is never answered here: only resume() runs (index.js).
  ctx.app.resume();
  await ctx.wait(5 * SECOND);
  assert.deepEqual(
    ctx.ctc.log.filter((l) => l.startsWith('w:')),
    ['w:1015=0'],
  );
  assert.equal(ctx.ctc.log[0], 'w:1015=0', 'before any read');
  await ctx.app.stop();
});

test('restart: a held mode or setpoint is never written again; a future /data date is not trusted', async () => {
  const future = Date.UTC(2030, 0, 1);
  const store = createMemoryStore({
    version: 1,
    stop: { host: '192.168.1.80', port: 502, since: future },
  });
  const ctx = await setup({ store, config: ALLOWED });
  assert.ok(ctx.app.heatingStop.since < future);
  assert.ok(ctx.ctc.writes.every((w) => w.address === 1015 && w.value === 0));
  await ctx.app.stop();
});

test('/data unreadable: not overwritten, the stop still written, the status says so', async () => {
  const store = createMemoryStore({}, { broken: true });
  const ctx = await setup({ store });
  const out = await command(ctx, 'heating-mode', 'off');
  assert.equal(out.error, undefined);
  assert.equal(store.saves, 0);
  await ctx.wait(SECOND);
  assert.match(ctx.gladys.fake.connectionStatus.message.en, /\/data/);
  await ctx.app.stop();
});

test('the commands are off by default; only the heating off works', async () => {
  const ctx = await setup();
  for (const [role, value] of [
    ['heating-mode', 'heat'],
    ['heating-mode', 'program'],
    ['dhw-mode', 'comfort'],
    ['room-setpoint', 21],
  ]) {
    const out = await command(ctx, role, value);
    assert.match(out.error.message, /Autoriser les commandes/, `${role} ${value}`);
  }
  assert.equal(ctx.ctc.writes.length, 0);
  await ctx.app.stop();
});

test('strict values: no number, no step, no range, no unknown option; read-only features', async () => {
  const ctx = await setup({ config: ALLOWED });
  for (const value of ['', null, 'abc', '1e2', true, 9.9, 30.1, 21.55, NaN, Infinity]) {
    const out = await command(ctx, 'room-setpoint', value);
    assert.ok(out.error, `room ${String(value)}`);
  }
  for (const value of ['cool', 'on', 'Off', '', 0, 1, '__proto__', 'constructor']) {
    const out = await command(ctx, 'heating-mode', value);
    assert.ok(out.error, `mode ${String(value)}`);
  }
  const ro = await ctx.during(
    ctx.app.setValue({}, { external_id: 'ext:ctc:heat-pump:ctc:temperature-outdoor' }, 1),
  );
  assert.match(ro.error.message, /lecture seule/);
  assert.equal(ctx.ctc.writes.length, 0);
  await ctx.app.stop();
});

test('room setpoint: identity read then 1010 = tenths, in the same session; held and shown', async () => {
  const ctx = await setup({ config: ALLOWED });
  ctx.ctc.log.length = 0;
  const out = await command(ctx, 'room-setpoint', 21.5);
  assert.equal(out.error, undefined);
  assert.deepEqual(ctx.ctc.log, ['r:62244+2', 'w:1010=215']);
  await ctx.wait(SECOND);
  assert.equal(stateOf(ctx.gladys, 'room-setpoint'), 21.5);
  await ctx.app.stop();
});

test('another controller (display software changed): nothing written', async () => {
  const ctx = await setup({ config: ALLOWED });
  ctx.ctc.registers[62245] = 2024;
  const out = await command(ctx, 'dhw-mode', 'comfort');
  assert.match(out.error.message, /version du logiciel/);
  assert.equal(ctx.ctc.writes.length, 0);
  await ctx.app.stop();
});

test('nothing asked before a heating off leaves after it', async () => {
  const ctx = await setup({ config: ALLOWED });
  // The identity read of the setpoint is slow: the off arrives meanwhile.
  ctx.ctc.behave = (r) => (r.fn === 3 && r.address === 62244 ? { delayMs: 800 } : undefined);
  const setpoint = command(ctx, 'room-setpoint', 25);
  await ctx.wait(100, 10);
  const off = await command(ctx, 'heating-mode', 'off');
  const sp = await setpoint;
  assert.equal(off.error, undefined);
  assert.match(sp.error.message, /Annulée par un arrêt du chauffage/);
  assert.deepEqual(
    ctx.ctc.writes.map((w) => `${w.address}=${w.value}`),
    ['1015=0'],
  );
  await ctx.app.stop();
});

test('a newer mode replaces the heating off only once it has left', async () => {
  const ctx = await setup({ config: ALLOWED });
  await command(ctx, 'heating-mode', 'off');
  await ctx.wait(3 * SECOND);
  // Not sent (another controller): the off stays.
  ctx.ctc.registers[62244] = 101;
  const refused = await command(ctx, 'heating-mode', 'heat');
  assert.ok(refused.error);
  assert.ok(ctx.app.heatingStop);
  ctx.ctc.registers[62244] = 1203;
  await ctx.wait(3 * SECOND);
  const out = await command(ctx, 'heating-mode', 'heat');
  assert.equal(out.error, undefined);
  assert.equal(ctx.app.heatingStop, undefined);
  assert.equal(ctx.store.data.stop, undefined);
  assert.deepEqual(
    writesTo(ctx.ctc, 1015).map((w) => w.value),
    [0, 1],
  );
  await ctx.app.stop();
});

test('a write without answer: "sent, without acknowledgement", never in force until written again', async () => {
  const ctx = await setup({ config: ALLOWED });
  ctx.ctc.behave = (r) => (r.fn === 16 ? 'silent' : undefined);
  const out = await command(ctx, 'dhw-mode', 'economy');
  assert.match(out.error.message, /sans acquittement/);
  assert.equal(ctx.app.controls()['dhw-mode'], 'program');
  ctx.ctc.behave = undefined;
  await ctx.wait(80 * SECOND);
  assert.equal(ctx.app.controls()['dhw-mode'], 'economy');
  await ctx.app.stop();
});

test('a refusal of the controller (exception 3) is a refusal, nothing held', async () => {
  const ctx = await setup({ config: ALLOWED });
  ctx.ctc.behave = (r) => (r.fn === 16 ? { exception: 3 } : undefined);
  const out = await command(ctx, 'dhw-mode', 'normal');
  assert.match(out.error.message, /refusé/);
  assert.equal(ctx.app.holds.size, 0);
  await ctx.app.stop();
});

test('keepalive: every minute; lapsed after 5 minutes without acknowledgement, never taken up again', async () => {
  const ctx = await setup({ config: ALLOWED });
  await command(ctx, 'room-setpoint', 20);
  await ctx.wait(3 * MINUTE + 5 * SECOND);
  const rewrites = writesTo(ctx.ctc, 1010).length;
  assert.ok(rewrites >= 3 && rewrites <= 5, `${rewrites} writes`);
  ctx.ctc.behave = (r) => (r.fn === 16 ? { exception: 4 } : undefined);
  await ctx.wait(6 * MINUTE);
  assert.equal(ctx.app.holds.size, 0, 'given back');
  ctx.ctc.behave = undefined;
  const before = writesTo(ctx.ctc, 1010).length;
  await ctx.wait(3 * MINUTE);
  assert.equal(writesTo(ctx.ctc, 1010).length, before);
  await ctx.app.stop();
});

test('the heating off is never dropped by the keepalive, even after 5 minutes unreachable', async () => {
  const ctx = await setup();
  await command(ctx, 'heating-mode', 'off');
  ctx.ctc.reachable = false;
  ctx.ctc.hangUp();
  await ctx.wait(7 * MINUTE);
  assert.ok(ctx.app.heatingStop);
  assert.match(stateOf(ctx.gladys, 'overrides'), /pas en vigueur/);
  ctx.ctc.reachable = true;
  const before = writesTo(ctx.ctc, 1015).length;
  await ctx.wait(MINUTE);
  assert.ok(writesTo(ctx.ctc, 1015).length > before);
  assert.equal(ctx.app.controls()['heating-mode'], 'off');
  await ctx.app.stop();
});

test('commands turned off: what Gladys held is given back, the heating off is kept', async () => {
  const ctx = await setup({ config: ALLOWED });
  await command(ctx, 'dhw-mode', 'comfort');
  await ctx.wait(3 * SECOND);
  await command(ctx, 'heating-mode', 'off');
  await ctx.during(ctx.app.configUpdated(CONFIG));
  assert.equal(ctx.app.holds.size, 0);
  assert.ok(ctx.app.heatingStop);
  const before = writesTo(ctx.ctc, 1007).length;
  await ctx.wait(3 * MINUTE);
  assert.equal(writesTo(ctx.ctc, 1007).length, before);
  await ctx.app.stop();
});

test('giving the heating off back needs the option and a /data written first', async () => {
  const ctx = await setup();
  await command(ctx, 'heating-mode', 'off');
  const button = await ctx.during(ctx.app.releaseOverrides());
  assert.match(button.value.fr, /gardé/);
  assert.ok(ctx.app.heatingStop);
  await ctx.during(ctx.app.configUpdated(ALLOWED));
  ctx.store.fail = true;
  const refused = await command(ctx, 'heating-mode', 'program');
  assert.match(refused.error.message, /\/data/);
  assert.ok(ctx.app.heatingStop);
  ctx.store.fail = false;
  const out = await command(ctx, 'heating-mode', 'program');
  assert.equal(out.error, undefined);
  assert.equal(ctx.app.heatingStop, undefined);
  assert.equal(ctx.store.data.stop, undefined);
  const before = writesTo(ctx.ctc, 1015).length;
  await ctx.wait(3 * MINUTE);
  assert.equal(writesTo(ctx.ctc, 1015).length, before, 'nothing written any more');
  await ctx.app.stop();
});

test('a new address: the heating off follows it, never dropped', async () => {
  const ctx = await setup();
  await command(ctx, 'heating-mode', 'off');
  await ctx.during(ctx.app.configUpdated({ address: '192.168.1.81' }));
  assert.equal(ctx.app.heatingStop.address.host, '192.168.1.81');
  assert.equal(ctx.store.data.stop.host, '192.168.1.81');
  await ctx.app.stop();
});

test('only the three control registers are ever written', async () => {
  const ctx = await setup({ config: ALLOWED });
  await command(ctx, 'heating-mode', 'auto');
  await ctx.wait(3 * SECOND);
  await command(ctx, 'dhw-mode', 'normal');
  await ctx.wait(3 * SECOND);
  await command(ctx, 'room-setpoint', 19);
  await ctx.wait(2 * MINUTE);
  assert.deepEqual([...new Set(ctx.ctc.writes.map((w) => w.address))].sort(), [1007, 1010, 1015]);
  await ctx.app.stop();
});

test('a scene: three commands at once, slow controller, all applied in time', async () => {
  const ctx = await setup({ config: ALLOWED });
  ctx.ctc.latencyMs = 250;
  const outs = await Promise.all([
    command(ctx, 'dhw-mode', 'economy'),
    command(ctx, 'room-setpoint', 19.5),
    command(ctx, 'heating-mode', 'auto'),
  ]);
  assert.deepEqual(
    outs.map((o) => o.error?.message),
    [undefined, undefined, undefined],
  );
  assert.deepEqual(
    ctx.ctc.writes.map((w) => `${w.address}=${w.value}`),
    ['1007=0', '1010=195', '1015=3'],
  );
  await ctx.app.stop();
});

test('the clicks of one feature in their order: a newer one decides', async () => {
  const ctx = await setup({ config: ALLOWED });
  ctx.ctc.behave = (r) => (r.fn === 3 && r.address === 62244 ? { delayMs: 500 } : undefined);
  const set = (value) => ctx.app.setValue({}, { external_id: ID('heating-mode') }, value);
  const first = ctx.during(set('heat'));
  await new Promise((r) => setImmediate(r));
  const second = await ctx.during(set('program'));
  assert.equal(second.error, undefined);
  const out = await first;
  assert.match(out.error.message, /plus récente/);
  assert.equal(writesTo(ctx.ctc, 1015).length, 0);
  assert.equal(ctx.app.holds.size, 0);
  await ctx.app.stop();
});

test('a mode whose write left before a heating off is never written again after it', async () => {
  const ctx = await setup({ config: ALLOWED });
  // The answer of the heat write is slow: the off arrives once it has left.
  ctx.ctc.behave = (r) => (r.fn === 16 && r.value === 1 ? { delayMs: 600 } : undefined);
  const heat = ctx.app.setValue({}, { external_id: ID('heating-mode') }, 'heat');
  await ctx.wait(200, 10);
  assert.equal(writesTo(ctx.ctc, 1015).length, 1, 'heat left');
  assert.equal(ctx.app.holds.size, 0, 'not acknowledged yet');
  const off = await command(ctx, 'heating-mode', 'off');
  await heat;
  assert.equal(off.error, undefined);
  assert.equal(ctx.app.holds.has('heating-mode'), false, 'never held after the off');
  await ctx.wait(3 * MINUTE);
  const values = writesTo(ctx.ctc, 1015).map((w) => w.value);
  assert.equal(values[0], 1);
  assert.ok(
    values.slice(1).every((v) => v === 0),
    `${values}`,
  );
  assert.equal(ctx.app.controls()['heating-mode'], 'off');
  await ctx.app.stop();
});
