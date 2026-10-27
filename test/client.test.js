// -----------------------------------------------------------------------------
// The Modbus client on a REAL loopback TCP server of the kit: framing,
// attribution of the answers, silence, late answers, the forbidden
// addresses, the cut of a silent read for a stop, one request at a time.
// -----------------------------------------------------------------------------

import { test } from 'node:test';
import assert from 'node:assert/strict';
import { ERROR_KINDS, LEVEL, ModbusClient } from '../src/modbus/client.js';
import { TIMINGS } from '../src/constants.js';
import { tcpServer } from './kit/tcp.mjs';

const FAST = {
  ...TIMINGS,
  connectDelay: 0,
  closeSettle: 0,
  messageGap: 0,
  readTimeout: 300,
};

/** Splits glued frames; `reply(frame)` -> Buffer | undefined per request. */
function modbusDevice(reply, options = {}) {
  return tcpServer({
    ...options,
    onData(chunk) {
      const out = [];
      let at = 0;
      while (at + 7 <= chunk.length) {
        const total = 6 + chunk.readUInt16BE(at + 4);
        const answer = reply(chunk.subarray(at, at + total));
        if (answer) out.push(answer);
        at += total;
      }
      return out.length ? Buffer.concat(out) : undefined;
    },
  });
}

const frame = (tid, pdu, unit = 1) => {
  const out = Buffer.alloc(7 + pdu.length);
  out.writeUInt16BE(tid, 0);
  out.writeUInt16BE(pdu.length + 1, 4);
  out.writeUInt8(unit, 6);
  Buffer.from(pdu).copy(out, 7);
  return out;
};
const readAnswer = (req, words) => {
  const count = req.readUInt16BE(10);
  const pdu = Buffer.alloc(2 + count * 2);
  pdu[0] = 3;
  pdu[1] = count * 2;
  for (let i = 0; i < count; i += 1) pdu.writeUInt16BE(words?.[i] ?? i, 2 + i * 2);
  return frame(req.readUInt16BE(0), pdu);
};

const client = (device, extra = {}) =>
  new ModbusClient({ host: '127.0.0.1', port: device.port, unitId: 1, timings: FAST, ...extra });

test('reads and writes with functions 3 and 16; a write answer is its exact echo', async (t) => {
  const device = await modbusDevice((req) =>
    req[7] === 3 ? readAnswer(req, [1, 2]) : frame(req.readUInt16BE(0), req.subarray(7, 12)),
  );
  t.after(() => device.close());
  const c = client(device);
  t.after(() => c.close());
  assert.deepEqual(await c.readHolding(62000, 2), [1, 2]);
  assert.equal(await c.session((raw) => raw.writeRegister(1015, 0)), 0);
  const write = device.received.at(-1).data;
  assert.deepEqual([...write.subarray(7)], [16, 0x03, 0xf7, 0, 1, 2, 0, 0]);
});

test('the stored settings and every other address are never written: nothing reaches the wire', async (t) => {
  const device = await modbusDevice(() => undefined);
  t.after(() => device.close());
  const c = client(device);
  t.after(() => c.close());
  for (const address of [61500, 61503, 61509, 61542, 62000, 1000, 1002, 1033, 1100, 0]) {
    await assert.rejects(
      c.session((raw) => raw.writeRegister(address, 1)),
      (err) => err.kind === ERROR_KINDS.FORBIDDEN && err.sent === false,
    );
  }
  assert.equal(device.connections, 0);
});

test('silence: TIMEOUT, the connection stays, the late answer is dropped, not taken for the next', async (t) => {
  let n = 0;
  const device = await modbusDevice((req) => {
    n += 1;
    return n === 1 ? undefined : readAnswer(req, [n]);
  });
  t.after(() => device.close());
  const c = client(device);
  t.after(() => c.close());
  const first = device.received.length;
  await assert.rejects(c.readHolding(62087, 1), (err) => err.kind === ERROR_KINDS.TIMEOUT);
  // The late answer of the first request arrives now, glued to nothing.
  const late = readAnswer(device.received[first].data, [999]);
  device.push(late);
  assert.deepEqual(await c.readHolding(62000, 1), [2]);
  assert.equal(device.connections, 1);
});

test('an answer to nobody, another transaction or unit, a wrong byte count: connection dropped', async (t) => {
  for (const bad of [
    (req) => frame(req.readUInt16BE(0) + 7, [3, 2, 0, 1]),
    (req) => frame(req.readUInt16BE(0), [3, 2, 0, 1], 9),
    (req) => frame(req.readUInt16BE(0), [3, 4, 0, 1]),
    (req) => frame(req.readUInt16BE(0), [4, 2, 0, 1]),
  ]) {
    const device = await modbusDevice(bad);
    const c = client(device);
    await assert.rejects(c.readHolding(62000, 1), (err) => err.kind === ERROR_KINDS.PROTOCOL);
    c.close();
    await device.close();
  }
  t.diagnostic('4 malformed answers refused');
});

test('an oversized answer is cut before it is read whole', async (t) => {
  const device = await modbusDevice((req) => {
    const out = Buffer.alloc(2000, 0);
    out.writeUInt16BE(req.readUInt16BE(0), 0);
    out.writeUInt16BE(1994, 4);
    return out;
  });
  t.after(() => device.close());
  const c = client(device);
  t.after(() => c.close());
  await assert.rejects(c.readHolding(62000, 1), (err) => err.kind === ERROR_KINDS.PROTOCOL);
});

test('a write without answer drops the line; a write exception keeps it', async (t) => {
  let mode = 'silent';
  const device = await modbusDevice((req) =>
    mode === 'silent' ? undefined : frame(req.readUInt16BE(0), [0x90, 3]),
  );
  t.after(() => device.close());
  const c = client(device);
  t.after(() => c.close());
  await assert.rejects(
    c.session((raw) => raw.writeRegister(1010, 210)),
    (err) => err.kind === ERROR_KINDS.TIMEOUT && err.sent === true,
  );
  mode = 'exception';
  await assert.rejects(
    c.session((raw) => raw.writeRegister(1010, 210)),
    (err) => err.kind === ERROR_KINDS.EXCEPTION && err.code === 3,
  );
  assert.equal(device.connections, 2);
});

test('never a pipeline: a stop waits for the read in flight, then passes before queued reads', async (t) => {
  const order = [];
  const device = await modbusDevice((req) => {
    const fn = req[7];
    const address = req.readUInt16BE(8);
    order.push({ what: `${fn}:${address}`, at: performance.now() });
    if (fn === 3 && address === 62191) return undefined;
    return fn === 3 ? readAnswer(req) : frame(req.readUInt16BE(0), req.subarray(7, 12));
  });
  t.after(() => device.close());
  const c = client(device);
  t.after(() => c.close());
  const silent = c.readHolding(62191, 25);
  const queued = c.readHolding(62234, 13);
  await new Promise((r) => setTimeout(r, 20));
  const stop = c.session((raw) => raw.writeRegister(1015, 0), { level: LEVEL.STOP });
  await assert.rejects(silent, (err) => err.kind === ERROR_KINDS.TIMEOUT);
  assert.equal(await stop, 0);
  await queued;
  assert.deepEqual(
    order.map((o) => o.what),
    ['3:62191', '16:1015', '3:62234'],
  );
  // The stop left only once the read had timed out.
  assert.ok(order[1].at - order[0].at >= FAST.readTimeout - 5, `${order[1].at - order[0].at} ms`);
  assert.equal(device.peak, 1);
});

test('a write is never cut by a stop', async (t) => {
  const device = await modbusDevice((req) => (req[7] === 16 ? undefined : readAnswer(req)));
  t.after(() => device.close());
  const c = client(device, { timings: { ...FAST, readTimeout: 400 } });
  t.after(() => c.close());
  const write = c.session((raw) => raw.writeRegister(1010, 200));
  await new Promise((r) => setTimeout(r, 20));
  const stop = c.session((raw) => raw.writeRegister(1015, 0), { level: LEVEL.STOP });
  await assert.rejects(write, (err) => err.kind === ERROR_KINDS.TIMEOUT);
  await assert.rejects(stop);
});
