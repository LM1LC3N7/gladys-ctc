// -----------------------------------------------------------------------------
// A fake CTC controller behind the socket factory: it parses the Modbus TCP
// frames the client writes (functions 3 and 16), answers from its registers
// and lets a test change its behaviour per request (`ctc.behave`). Silence
// for a register it lacks, as a real CTC. No network: every socket is an
// in-memory EventEmitter whose events arrive on the next turns of the loop.
// -----------------------------------------------------------------------------

import { EventEmitter } from 'node:events';

export const HOST = '192.168.1.80';
export const NOW = Date.UTC(2026, 9, 27, 18, 0, 0);

const word = (value) => (value < 0 ? 0x10000 + value : value);

/** An EcoZenith i255 heating, compressor running; brine registers missing (air to water). */
export function i255Registers() {
  return {
    62000: word(-35),
    62005: 4,
    62006: 352,
    62007: 360,
    62011: 355,
    62015: 301,
    62017: 3,
    62027: 300,
    62037: 360,
    62047: 720,
    62057: word(-80),
    62067: 220,
    62077: 65,
    62087: 9999,
    62097: word(-9999),
    62107: 662,
    62117: 0,
    62127: 450,
    62147: word(-40),
    62167: word(-3447),
    62168: 0,
    62169: 0,
    62171: 52,
    62172: 48,
    62173: 50,
    62191: 1234,
    62193: 456,
    62203: 214,
    62204: 32767,
    62214: 0x2345,
    62215: 0x0001,
    62234: 600,
    62244: 1203,
    62245: 2023,
    62246: 3,
    62274: 450,
    62275: 420,
    62276: 510,
    62279: 857,
    62301: 0,
    62341: 9166,
    62342: 0,
    61500: 1,
    61509: 210,
    61542: 0,
  };
}

/**
 * The controller. `missing`: [start, end] ranges a read inside of which
 * stays silent; `behave(request)` may return 'silent', 'drop',
 * { exception }, { delayMs } or { raw: Buffer } for one request.
 */
export function fakeCtc({ registers = i255Registers(), missing = [], latencyMs = 5 } = {}) {
  const ctc = {
    registers,
    missing,
    latencyMs,
    behave: undefined,
    reachable: true,
    requests: [],
    writes: [],
    connections: 0,
    open: 0,
    sockets: new Set(),
    /** The register ranges asked, in order: 'r:62000+98', 'w:1015=0'. */
    log: [],
  };

  const answer = (socket, frame) => {
    const tid = frame.readUInt16BE(0);
    const unit = frame.readUInt8(6);
    const fn = frame.readUInt8(7);
    const address = frame.readUInt16BE(8);
    const request = { tid, unit, fn, address, at: Date.now() };
    if (fn === 3) {
      request.count = frame.readUInt16BE(10);
      ctc.log.push(`r:${address}+${request.count}`);
    } else if (fn === 16) {
      request.count = frame.readUInt16BE(10);
      request.value = frame.readUInt16BE(13);
      ctc.log.push(`w:${address}=${request.value}`);
      ctc.writes.push(request);
    }
    ctc.requests.push(request);
    const behaviour = ctc.behave?.(request);
    if (behaviour === 'silent') {
      return;
    }
    if (behaviour === 'drop') {
      socket.destroy();
      return;
    }
    let pdu;
    if (behaviour?.raw) {
      socket.emitLater('data', behaviour.raw);
      return;
    }
    if (behaviour?.exception) {
      pdu = Buffer.from([fn | 0x80, behaviour.exception]);
    } else if (fn === 3) {
      const end = address + request.count - 1;
      if (ctc.missing.some(([from, to]) => address <= to && end >= from)) {
        return;
      }
      pdu = Buffer.alloc(2 + request.count * 2);
      pdu[0] = 3;
      pdu[1] = request.count * 2;
      for (let i = 0; i < request.count; i += 1) {
        pdu.writeUInt16BE(ctc.registers[address + i] ?? 0, 2 + i * 2);
      }
    } else if (fn === 16) {
      ctc.registers[address] = request.value;
      pdu = frame.subarray(7, 12);
    } else {
      pdu = Buffer.from([fn | 0x80, 1]);
    }
    const out = Buffer.alloc(7 + pdu.length);
    out.writeUInt16BE(tid, 0);
    out.writeUInt16BE(0, 2);
    out.writeUInt16BE(pdu.length + 1, 4);
    out.writeUInt8(unit, 6);
    pdu.copy(out, 7);
    const wait = behaviour?.delayMs ?? ctc.latencyMs;
    socket.later(wait, () => socket.emit('data', out));
  };

  /** The socket factory given to the app (connect). */
  ctc.connect = ({ timers }) => {
    const socket = new EventEmitter();
    socket.destroyed = false;
    socket.writable = true;
    socket.inbox = Buffer.alloc(0);
    socket.setNoDelay = () => {};
    socket.emitLater = (event, ...args) =>
      setImmediate(() => {
        if (!socket.destroyed || event === 'close') {
          socket.emit(event, ...args);
        }
      });
    socket.later = (ms, fn) => {
      // Latencies are on the virtual clock of the test when given one.
      const run = () => {
        if (!socket.destroyed) fn();
      };
      if (timers && ms > 0) timers.setTimeout(run, ms);
      else setImmediate(run);
    };
    socket.write = (data) => {
      if (socket.destroyed) return false;
      socket.inbox = Buffer.concat([socket.inbox, data]);
      while (socket.inbox.length >= 7) {
        const total = 6 + socket.inbox.readUInt16BE(4);
        if (socket.inbox.length < total) break;
        const frame = socket.inbox.subarray(0, total);
        socket.inbox = socket.inbox.subarray(total);
        answer(socket, frame);
      }
      return true;
    };
    socket.destroy = () => {
      if (socket.destroyed) return;
      socket.destroyed = true;
      socket.writable = false;
      ctc.open -= 1;
      ctc.sockets.delete(socket);
      setImmediate(() => socket.emit('close'));
    };
    setImmediate(() => {
      if (!ctc.reachable) {
        socket.destroyed = true;
        socket.emit('error', new Error('ECONNREFUSED'));
        socket.emit('close');
        return;
      }
      ctc.connections += 1;
      ctc.open += 1;
      ctc.sockets.add(socket);
      socket.emit('connect');
    });
    return socket;
  };

  /** Closes every open connection from the controller side. */
  ctc.hangUp = () => {
    for (const socket of [...ctc.sockets]) socket.destroy();
  };

  return ctc;
}
