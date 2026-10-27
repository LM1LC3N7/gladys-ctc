// -----------------------------------------------------------------------------
// The app on a REAL moving clock (performance.now, Date.now, setTimeout),
// sped up 20 times, against a real loopback Modbus TCP server of the kit
// playing the controller: the rounds really start at the interval, the
// heating off really leaves within its budget and is written again every
// minute, with a bounded number of timers. Wide margins: a loaded machine
// makes timers late, never early.
// -----------------------------------------------------------------------------

import { test } from 'node:test';
import assert from 'node:assert/strict';
import { createFakeGladys } from '@gladysassistant/integration-sdk/testing';
import { CtcApp } from '../src/app.js';
import { createMemoryStore } from '../src/store.js';
import { measurePeriod, realClock, spyOn } from './kit/clock.mjs';
import { tcpServer } from './kit/tcp.mjs';
import { i255Registers } from './fixtures/fakeCtc.js';
import { createdDevice } from './helpers/app.js';

const SPEED = 20;

/** A controller on 127.0.0.1: functions 3 and 16 from its registers. */
function controller(registers = i255Registers()) {
  const writes = [];
  const device = tcpServer({
    onData(chunk) {
      const out = [];
      let at = 0;
      while (at + 7 <= chunk.length) {
        const frame = chunk.subarray(at, at + 6 + chunk.readUInt16BE(at + 4));
        at += frame.length;
        const fn = frame[7];
        const address = frame.readUInt16BE(8);
        let pdu;
        if (fn === 3) {
          const count = frame.readUInt16BE(10);
          pdu = Buffer.alloc(2 + count * 2);
          pdu[0] = 3;
          pdu[1] = count * 2;
          for (let i = 0; i < count; i += 1)
            pdu.writeUInt16BE(registers[address + i] ?? 0, 2 + i * 2);
        } else {
          writes.push({ address, value: frame.readUInt16BE(13), at: performance.now() * SPEED });
          pdu = frame.subarray(7, 12);
        }
        const answer = Buffer.alloc(7 + pdu.length);
        frame.copy(answer, 0, 0, 7);
        answer.writeUInt16BE(pdu.length + 1, 4);
        pdu.copy(answer, 7);
        out.push(answer);
      }
      return Buffer.concat(out);
    },
  });
  return { device, writes };
}

test('real clock x20: rounds at the interval; a heating off leaves at once and every minute', async (t) => {
  const { device: started, writes } = controller();
  const device = await started;
  t.after(() => device.close());
  const clock = realClock({ speed: SPEED });
  t.after(() => clock.close());
  const gladys = createFakeGladys({
    selector: 'ctc',
    config: {},
    devices: [createdDevice()],
  });
  await gladys.connect();
  const quiet = () => {};
  const app = new CtcApp({
    gladys,
    logger: { info: quiet, warn: quiet, error: quiet, debug: quiet },
    now: clock.now,
    monotonic: clock.monotonic,
    timers: clock.timers,
    store: createMemoryStore(),
  });
  t.after(() => app.stop());
  const rounds = spyOn(app, 'round', clock);
  await app.connected({ address: `127.0.0.1:${device.port}` });
  await measurePeriod(rounds, { count: 3, period: 30_000 });

  const asked = clock.monotonic();
  await app.setValue({}, { external_id: 'ext:ctc:heat-pump:ctc:heating-mode' }, 'off');
  assert.ok(writes.length >= 1, 'written');
  assert.ok(writes[0].at - asked < 3_500, `${writes[0].at - asked} ms`);
  // Written again about a minute later (the keepalive looks every 15 s).
  await clock.sleep(80_000);
  const stops = writes.filter((w) => w.address === 1015 && w.value === 0);
  assert.ok(stops.length >= 2, `${stops.length} writes`);
  const gap = stops[1].at - stops[0].at;
  assert.ok(gap >= 60_000 * 0.9 && gap <= 80_000, `rewritten after ${Math.round(gap)} ms`);
  assert.equal(device.peak, 1, 'one connection');
  assert.ok(clock.timersSet < 200, `${clock.timersSet} timers`);
});
