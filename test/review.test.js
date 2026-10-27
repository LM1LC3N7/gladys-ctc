// -----------------------------------------------------------------------------
// Review r1: the configuration read again, the panel and the time ending the
// holds, the state shown after a lapse, a refused stop, a refused newer
// mode, a new address, the checks right before the bytes leave.
// -----------------------------------------------------------------------------

import { test } from 'node:test';
import assert from 'node:assert/strict';
import { createMemoryStore } from '../src/store.js';
import { fakeCtc } from './fixtures/fakeCtc.js';
import { ALLOWED, CONFIG, ID, MINUTE, SECOND, command, setup, stateOf } from './helpers/app.js';

const HOUR = 60 * MINUTE;
const writesTo = (ctc, address) => ctc.writes.filter((w) => w.address === address);

test('getConfig failing: read again (5 s, doubled), status said; rounds start once it comes', async () => {
  const ctx = await setup({ start: false });
  let fails = 2;
  const read = async () => {
    if (fails > 0) {
      fails -= 1;
      throw Object.assign(new Error('boom'), { status: 503 });
    }
    return CONFIG;
  };
  await ctx.during(ctx.app.connectedFrom(read));
  assert.match(ctx.gladys.fake.connectionStatus.message.fr, /configuration n'a pas pu être lue/);
  assert.equal(ctx.ctc.log.length, 0);
  await ctx.wait(20 * SECOND);
  assert.ok(ctx.ctc.log.includes('r:62000+98'), 'rounds started');
  assert.equal(ctx.gladys.fake.connectionStatus.connected, true);
  await ctx.app.stop();
});

test('heating off before the configuration: to the last address identified, kept in /data', async () => {
  const store = createMemoryStore({ version: 1, identified: { host: '192.168.1.80', port: 502 } });
  const ctx = await setup({ store, start: false });
  ctx.app.resume();
  const out = await command(ctx, 'heating-mode', 'off');
  // Waited for the configuration, then the connection: after the 3.5 s ack.
  assert.match(out.error.message, /pas encore acquitté/);
  await ctx.wait(5 * SECOND);
  assert.deepEqual(
    writesTo(ctx.ctc, 1015).map((w) => w.value),
    [0],
  );
  assert.ok(ctx.app.heatingStop.ackedAt !== undefined);
  assert.equal(ctx.store.data.stop.host, '192.168.1.80');
  await ctx.app.stop();
});

test('heating off before the configuration, no address known: the true reason', async () => {
  const ctx = await setup({ start: false });
  ctx.app.resume();
  const out = await command(ctx, 'heating-mode', 'off');
  assert.match(out.error.message, /configuration n'a pas encore été lue/);
  await ctx.app.stop();
});

test('a change at the panel gives the hold back: no more writes, /data cleared, said', async () => {
  const ctx = await setup({ config: ALLOWED });
  await command(ctx, 'room-setpoint', 19);
  await ctx.wait(3 * SECOND);
  await command(ctx, 'heating-mode', 'off');
  // Two rounds: the panel values are noted after the acknowledgement.
  await ctx.wait(65 * SECOND);
  ctx.ctc.registers[61542] = 1;
  ctx.ctc.registers[61509] = 230;
  // The room setpoint goes on one reading; the heating off on two in a row.
  await ctx.wait(31 * SECOND);
  assert.equal(ctx.app.holds.size, 0);
  assert.ok(ctx.app.heatingStop, 'one reading is not enough for the stop');
  await ctx.wait(30 * SECOND);
  assert.equal(ctx.app.heatingStop, undefined);
  assert.equal(ctx.app.holds.size, 0);
  assert.equal(ctx.store.data.stop, undefined);
  assert.ok(ctx.lines.some((l) => /changed at the panel/.test(l)));
  const before = ctx.ctc.writes.length;
  await ctx.wait(5 * MINUTE);
  assert.equal(ctx.ctc.writes.length, before);
  assert.match(stateOf(ctx.gladys, 'overrides'), /changé sur l'écran/);
  assert.equal(stateOf(ctx.gladys, 'heating-mode'), 'program');
  await ctx.app.stop();
});

test('a panel value not read gives nothing back', async () => {
  const ctc = fakeCtc({ missing: [[61540, 61545]] });
  const ctx = await setup({ ctc });
  await command(ctx, 'heating-mode', 'off');
  await ctx.wait(3 * MINUTE);
  assert.ok(ctx.app.heatingStop);
  await ctx.app.stop();
});

test('the 24-hour end: the held values, never the heating off (also after a restart)', async () => {
  const ctx = await setup({ config: ALLOWED });
  await command(ctx, 'dhw-mode', 'economy');
  await ctx.wait(3 * SECOND);
  await command(ctx, 'heating-mode', 'off');
  await ctx.wait(24 * HOUR + MINUTE, 5 * SECOND);
  assert.equal(ctx.app.holds.size, 0, 'the hot water mode given back');
  assert.ok(ctx.app.heatingStop, 'the heating off stays');
  assert.equal(ctx.store.data.stop.host, '192.168.1.80');
  assert.equal(ctx.app.controls()['heating-mode'], 'off');
  assert.match(ctx.gladys.fake.connectionStatus.message.fr, /tenu par Gladys depuis le 2026-10-27/);
  await ctx.app.stop();
  const old = createMemoryStore({
    version: 1,
    stop: { host: '192.168.1.80', port: 502, since: Date.UTC(2026, 9, 1) },
  });
  const again = await setup({ store: old, start: false });
  again.app.resume();
  await again.wait(5 * SECOND);
  assert.deepEqual(
    writesTo(again.ctc, 1015).map((w) => w.value),
    [0],
  );
  await again.app.stop();
});

test('the panel and the heating off: one odd reading, Off, or an unreadable value keep it', async () => {
  const ctx = await setup();
  const reads = () => ctx.ctc.log.filter((l) => l === 'r:61542+1').length;
  /** Sets 61542, then waits for exactly one more round to read it. */
  const round = async (value) => {
    ctx.ctc.registers[61542] = value;
    const n = reads();
    while (reads() === n) await ctx.wait(500, 50);
    await ctx.wait(500, 50);
  };
  await command(ctx, 'heating-mode', 'off');
  await round(0);
  await round(0);
  assert.equal(ctx.app.heatingStop.panel, 0);
  const seen = [];
  for (const value of [1, 0, 2, 2, 9999, 9999, 1, 9999, 1, 2, 1]) {
    await round(value);
    assert.ok(ctx.app.heatingStop, `kept after ${value} at ${seen.length}`);
    seen.push(value);
  }
  // A second On in a row: given back, the noted and read values logged.
  await round(1);
  assert.equal(ctx.app.heatingStop, undefined);
  assert.ok(ctx.lines.some((l) => /61542 noted 0, read 1 twice/.test(l)));
  await ctx.app.stop();
});

test('a held value read at the panel then unreadable is kept', async () => {
  const ctx = await setup({ config: ALLOWED });
  await command(ctx, 'room-setpoint', 19);
  await ctx.wait(65 * SECOND);
  assert.equal(ctx.app.holds.get('room-setpoint').panel, 21);
  ctx.ctc.registers[61509] = 32767;
  await ctx.wait(2 * MINUTE);
  assert.ok(ctx.app.holds.has('room-setpoint'));
  await ctx.app.stop();
});

test('a heating off write without answer frees the line in 5 s', async () => {
  const ctx = await setup();
  ctx.ctc.behave = (r) => (r.fn === 16 ? 'silent' : undefined);
  const set = ctx.app.setValue({}, { external_id: ID('heating-mode') }, 'off');
  ctx.during(set);
  await ctx.wait(50, 10);
  const sentAt = ctx.clock.monotonic();
  const round = ctx.app.tick();
  await ctx.during(round, 20 * SECOND);
  const readAt = ctx.ctc.requests.findIndex((r) => r.fn === 3 && r.address === 62000);
  assert.ok(readAt >= 0);
  assert.ok(ctx.clock.monotonic() - sentAt < 9 * SECOND, 'the round ran soon after');
  assert.equal(ctx.ctc.connections, 1, 'the line kept');
  await ctx.app.stop();
});

test('a stop moved to a new address keeps waiting for a CTC after a restart', async () => {
  const ctx = await setup();
  await command(ctx, 'heating-mode', 'off');
  for (const key of Object.keys(ctx.ctc.registers)) ctx.ctc.registers[key] = 0;
  await ctx.during(ctx.app.configUpdated({ address: '192.168.1.81' }));
  assert.equal(ctx.store.data.stop.waitIdentify, true);
  assert.equal(ctx.store.data.stop.expectIdentity, '2023.1203');
  await ctx.app.stop();
  const again = await setup({ store: ctx.store, ctc: ctx.ctc, start: false });
  const before = again.ctc.writes.length;
  again.app.resume();
  await again.wait(10 * SECOND);
  assert.equal(again.ctc.writes.length, before, 'not written before a CTC is identified');
  // Another controller (another identity) there: still not written.
  Object.assign(again.ctc.registers, { 62000: 10, 62244: 101, 62245: 2025 });
  await again.during(again.app.connected({ address: '192.168.1.81' }));
  await again.wait(MINUTE);
  assert.equal(again.ctc.writes.length, before);
  // The CTC known before: written.
  Object.assign(again.ctc.registers, { 62244: 1203, 62245: 2023 });
  await again.wait(2 * MINUTE);
  assert.ok(again.ctc.writes.length > before);
  await again.app.stop();
});

test('the address removed or the device deleted gives the heating off back', async () => {
  const ctx = await setup();
  await command(ctx, 'heating-mode', 'off');
  await ctx.during(ctx.app.configUpdated({ address: '' }));
  assert.equal(ctx.app.heatingStop, undefined);
  assert.equal(ctx.store.data.stop, undefined);
  await ctx.app.stop();
  const two = await setup();
  await command(two, 'heating-mode', 'off');
  await two.during(two.app.deviceDeleted({ external_id: 'ext:ctc:heat-pump:ctc' }));
  assert.equal(two.app.heatingStop, undefined);
  await two.app.stop();
});

test('a slow /data never holds a heating off back', async () => {
  const ctx = await setup({ config: ALLOWED });
  await command(ctx, 'heating-mode', 'off');
  await ctx.wait(3 * SECOND);
  const save = ctx.store.save;
  ctx.store.save = (data) =>
    new Promise((resolve) => ctx.clock.timers.setTimeout(resolve, 8000)).then(() =>
      save.call(ctx.store, data),
    );
  const heat = ctx.app.setValue({}, { external_id: ID('heating-mode') }, 'heat');
  await ctx.wait(100, 10);
  const asked = ctx.clock.monotonic();
  const out = await command(ctx, 'heating-mode', 'off');
  assert.equal(out.error, undefined);
  assert.ok(ctx.clock.monotonic() - asked < 3600);
  await ctx.during(
    heat.catch(() => {}),
    60 * SECOND,
  );
  assert.ok(ctx.app.heatingStop);
  await ctx.app.stop();
});

test('a lapsed stop: the select shows what the controller follows, the status says lapsed', async () => {
  const ctx = await setup();
  await command(ctx, 'heating-mode', 'off');
  await ctx.wait(2 * SECOND);
  assert.equal(stateOf(ctx.gladys, 'heating-mode'), 'off');
  ctx.ctc.reachable = false;
  ctx.ctc.hangUp();
  await ctx.wait(6 * MINUTE);
  assert.equal(stateOf(ctx.gladys, 'heating-mode'), 'program');
  assert.match(stateOf(ctx.gladys, 'overrides'), /pas en vigueur/);
  assert.match(ctx.gladys.fake.connectionStatus.message.en, /no longer acknowledged/);
  await ctx.app.stop();
});

test('a stop refused (exception 2): a refusal in the ack and the status, retries spaced, logged once', async () => {
  const ctx = await setup();
  ctx.ctc.behave = (r) => (r.fn === 16 ? { exception: 2 } : undefined);
  const out = await command(ctx, 'heating-mode', 'off');
  assert.match(out.error.message, /refusé l'arrêt du chauffage \(exception Modbus 2\)/);
  await ctx.wait(30 * MINUTE, 500);
  const tries = writesTo(ctx.ctc, 1015).length;
  assert.ok(tries >= 4 && tries <= 9, `${tries} tries in 30 min`);
  assert.equal(ctx.lines.filter((l) => /refused by the controller/.test(l)).length, 1);
  assert.match(ctx.gladys.fake.connectionStatus.message.fr, /refusé par le régulateur/);
  await ctx.app.stop();
});

test('a newer mode refused by the controller (exception 3): the stop and /data stay', async () => {
  const ctx = await setup({ config: ALLOWED });
  await command(ctx, 'heating-mode', 'off');
  await ctx.wait(3 * SECOND);
  ctx.ctc.behave = (r) => (r.fn === 16 && r.value === 1 ? { exception: 3 } : undefined);
  const out = await command(ctx, 'heating-mode', 'heat');
  assert.match(out.error.message, /refusé la commande/);
  assert.ok(ctx.app.heatingStop);
  assert.equal(ctx.store.data.stop.host, '192.168.1.80');
  const before = writesTo(ctx.ctc, 1015).filter((w) => w.value === 0).length;
  await ctx.wait(3 * MINUTE);
  assert.ok(writesTo(ctx.ctc, 1015).filter((w) => w.value === 0).length > before);
  await ctx.app.stop();
});

test('a newer mode with /data failing: refused, nothing sent, the stop stays', async () => {
  const ctx = await setup({ config: ALLOWED });
  await command(ctx, 'heating-mode', 'off');
  await ctx.wait(3 * SECOND);
  ctx.store.fail = true;
  const out = await command(ctx, 'heating-mode', 'auto');
  assert.match(out.error.message, /\/data/);
  assert.deepEqual(
    writesTo(ctx.ctc, 1015).map((w) => w.value),
    [0],
  );
  assert.ok(ctx.app.heatingStop);
  await ctx.app.stop();
});

test('a new address: the stop waits for a CTC identified there; never to a device that is not one', async () => {
  const ctx = await setup();
  await command(ctx, 'heating-mode', 'off');
  // The new address answers zeros: not a CTC.
  for (const key of Object.keys(ctx.ctc.registers)) ctx.ctc.registers[key] = 0;
  const before = ctx.ctc.writes.length;
  await ctx.during(ctx.app.configUpdated({ address: '192.168.1.81' }));
  await ctx.wait(5 * MINUTE);
  assert.equal(ctx.ctc.writes.length, before);
  assert.equal(ctx.gladys.fake.connectionStatus.connected, false);
  assert.match(ctx.gladys.fake.connectionStatus.message.en, /not identified as a CTC/);
  // Once a CTC is identified there, it is written.
  Object.assign(ctx.ctc.registers, { 62000: 10, 62244: 1203, 62245: 2023 });
  await ctx.wait(6 * MINUTE);
  assert.ok(ctx.ctc.writes.length > before);
  await ctx.app.stop();
});

test('the option is checked again right before the bytes leave', async () => {
  const ctx = await setup({ config: ALLOWED });
  ctx.ctc.behave = (r) => (r.fn === 3 && r.address === 62244 ? { delayMs: 400 } : undefined);
  const set = ctx.app.setValue({}, { external_id: ID('dhw-mode') }, 'comfort');
  await ctx.wait(100, 10);
  await ctx.app.configUpdated(CONFIG);
  const out = await ctx.during(set);
  assert.match(out.error.message, /Autoriser les commandes/);
  assert.equal(ctx.ctc.writes.length, 0);
  await ctx.app.stop();
});

test('a keepalive rewrite under way is cancelled by a heating off', async () => {
  const ctx = await setup({ config: ALLOWED });
  await command(ctx, 'room-setpoint', 20);
  ctx.ctc.behave = (r) => (r.fn === 3 && r.address === 62244 ? { delayMs: 800 } : undefined);
  // Up to the identity read of the next rewrite (about a minute later).
  let guard = 0;
  while (!ctx.ctc.log.slice(-1)[0]?.startsWith('r:62244') && guard < 2000) {
    await ctx.wait(50, 10);
    guard += 1;
  }
  const n1010 = writesTo(ctx.ctc, 1010).length;
  await command(ctx, 'heating-mode', 'off');
  await ctx.wait(2 * SECOND);
  const log = ctx.ctc.log;
  const stopAt = log.indexOf('w:1015=0');
  assert.ok(stopAt > 0);
  assert.equal(writesTo(ctx.ctc, 1010).length, n1010, 'the rewrite did not leave after the off');
  await ctx.app.stop();
});

test('the ack of a heating off comes within 3.5 s, whatever the write does', async () => {
  const ctx = await setup();
  ctx.ctc.behave = (r) => (r.fn === 16 ? { delayMs: 4500 } : undefined);
  const asked = ctx.clock.monotonic();
  let answeredAt;
  const set = ctx.app
    .setValue({}, { external_id: ID('heating-mode') }, 'off')
    .finally(() => (answeredAt = ctx.clock.monotonic()));
  const out = await ctx.during(set, 10 * SECOND);
  assert.match(out.error.message, /pas encore acquitté/);
  assert.ok(answeredAt - asked <= 3600, `${answeredAt - asked} ms`);
  await ctx.app.stop();
});
