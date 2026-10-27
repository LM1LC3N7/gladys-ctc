// -----------------------------------------------------------------------------
// A minimal Modbus TCP client on node:net for CTC's BMS interface: read
// holding registers (function 3) and write one register with function 16,
// the two functions the manual gives. Written here (see TODO.md
// "Decisions"), as gladys-stiebel-eltron's, with what a CTC controller needs:
//
//   - one client, one connection, one request at a time (the Gate): the
//     controller serves a single master and cannot pipeline;
//   - every answer attributed to its request: transaction id, protocol 0,
//     unit id and function must match, a read its byte count, a write the
//     echo of its address and quantity; anything else drops the connection;
//   - silence (no answer to a read) is how CTC says a register is missing:
//     the request fails TIMEOUT, the connection stays (as the reference on
//     real units) and the transaction id is remembered, so a late answer is
//     recognised and dropped, never taken for the next one; a write without
//     answer is handled the same way (`sent`: it may have been applied);
//   - paced: 60 ms between transactions, 3 s after the socket opens, 10 s
//     after a close before a new connection (the controller's settle time);
//   - bounded: a frame is 260 bytes at most; a byte that belongs to no
//     request drops the connection;
//   - only the addresses of src/ctc.js WRITABLE are ever written: checked
//     before anything else (the stored settings wear out);
//   - `sent` says whether the request may have left: a write that may have
//     reached the controller is never reported "not sent";
//   - never a pipeline, not even for a heating stop: the stop waits for the
//     end of the request in flight (its answer or its timeout), then passes
//     before everything queued (the Gate levels).
// -----------------------------------------------------------------------------

import net from 'node:net';
import { LIMITS, TIMINGS } from '../constants.js';
import { WRITABLE } from '../ctc.js';

export const ERROR_KINDS = {
  /** No TCP connection could be opened: nothing was sent. */
  UNREACHABLE: 'unreachable',
  /** Sent, no answer in time. */
  TIMEOUT: 'timeout',
  /** The connection closed while a request was in flight. */
  CLOSED: 'closed',
  /** An answer that does not belong to the request (the connection is dropped). */
  PROTOCOL: 'protocol',
  /** A Modbus exception answer: the controller refused the request. */
  EXCEPTION: 'exception',
  /** Still waiting for its turn (or its connection) at its deadline: nothing was sent. */
  LATE: 'late',
  /** An address this integration never writes: nothing was sent. */
  FORBIDDEN: 'forbidden',
};

export class ModbusError extends Error {
  constructor(kind, { code, sent = false, detail } = {}) {
    super(code === undefined ? kind : `${kind} ${code}`);
    this.name = 'ModbusError';
    this.kind = kind;
    this.code = code;
    this.sent = sent;
    this.detail = detail;
  }
}

/** A short reason for the logs and the messages: our own words only. */
export function errorReason(err) {
  if (err instanceof ModbusError) {
    return err.kind === ERROR_KINDS.EXCEPTION ? `Modbus exception ${err.code}` : err.kind;
  }
  return 'error';
}

const FUNCTION = { READ_HOLDING: 3, WRITE_MULTIPLE: 16 };
const HEADER = 7;

/** Gate levels: a heating stop, then a command (or a held value), then the reads. */
export const LEVEL = { STOP: 0, COMMAND: 1, READ: 2 };

/**
 * One job at a time; a lower level passes before a higher one but never
 * cuts the job running. A job still queued at `startBy` (monotonic) leaves
 * the queue, rejected LATE.
 */
export class Gate {
  constructor({ timers = globalThis, monotonic = () => performance.now() } = {}) {
    this.timers = timers;
    this.monotonic = monotonic;
    this.queue = [];
    this.running = undefined;
  }

  run(fn, { level = LEVEL.READ, startBy } = {}) {
    return new Promise((resolve, reject) => {
      const job = { fn, resolve, reject, level, timer: undefined };
      if (startBy !== undefined) {
        job.timer = this.timers.setTimeout(
          () => {
            const index = this.queue.indexOf(job);
            if (index !== -1) {
              this.queue.splice(index, 1);
              reject(new ModbusError(ERROR_KINDS.LATE));
            }
          },
          Math.max(0, startBy - this.monotonic()),
        );
      }
      const at = this.queue.findIndex((queued) => queued.level > level);
      this.queue.splice(at === -1 ? this.queue.length : at, 0, job);
      this.pump();
    });
  }

  /** Rejects every queued job (a stop, another address). */
  clear(err) {
    for (const job of this.queue.splice(0)) {
      this.timers.clearTimeout(job.timer);
      job.reject(err);
    }
  }

  pump() {
    if (this.running || this.queue.length === 0) {
      return;
    }
    const job = this.queue.shift();
    if (job.timer !== undefined) {
      this.timers.clearTimeout(job.timer);
    }
    this.running = job;
    Promise.resolve()
      .then(job.fn)
      .then(job.resolve, job.reject)
      .finally(() => {
        this.running = undefined;
        this.pump();
      });
  }
}

export class ModbusClient {
  constructor({
    host,
    port,
    unitId,
    connect = (options) => net.createConnection(options),
    timers = globalThis,
    monotonic = () => performance.now(),
    timings = TIMINGS,
    logger,
  }) {
    this.host = host;
    this.port = port;
    this.unitId = unitId;
    this.connect = connect;
    this.timers = timers;
    this.monotonic = monotonic;
    this.timings = timings;
    this.logger = logger;
    this.gate = new Gate({ timers, monotonic });
    this.socket = undefined;
    this.connecting = undefined;
    this.pending = undefined;
    this.inbox = Buffer.alloc(0);
    this.abandoned = [];
    this.transaction = 0;
    this.closed = false;
    this.lastRequestAt = -Infinity;
    this.closedAt = -Infinity;
    this.readyAt = -Infinity;
    /** Counts the connections opened (session state is reset on each). */
    this.connections = 0;
    /** Called with no argument when a connection is opened or lost. */
    this.onSession = undefined;
    /** The requests without the gate, for a job that holds it. */
    this.raw = {
      readHolding: (address, count, options) => this.read(address, count, options),
      writeRegister: (address, value, options) => this.write(address, value, options),
    };
  }

  // --- Through the gate ----------------------------------------------------------

  readHolding(address, count, options = {}) {
    return this.gate.run(() => this.raw.readHolding(address, count, options));
  }

  /** Holds the gate for `fn(raw)` at `level`; still queued at `startBy`: LATE. */
  session(fn, { level = LEVEL.COMMAND, startBy } = {}) {
    return this.gate.run(() => fn(this.raw), { level, startBy });
  }

  /** Drops the connection and every queued job (a stop, another address). */
  close() {
    this.closed = true;
    this.gate.clear(new ModbusError(ERROR_KINDS.UNREACHABLE));
    this.drop(new ModbusError(ERROR_KINDS.CLOSED, { sent: true }));
  }

  /** A read given up (silence): its late answer will be dropped, the line stays. */
  abandon(pending) {
    this.settle(pending);
    this.abandoned.push(pending.tid);
    if (this.abandoned.length > LIMITS.abandoned) {
      // Too many answers owed: the line is not trusted any more.
      this.drop(new ModbusError(ERROR_KINDS.TIMEOUT, { sent: true }));
    }
  }

  // --- Requests --------------------------------------------------------------------

  read(address, count, options = {}) {
    if (
      !Number.isInteger(address) ||
      !Number.isInteger(count) ||
      address < 0 ||
      count < 1 ||
      count > LIMITS.registersPerRead ||
      address + count > 0x10000
    ) {
      return Promise.reject(new RangeError('Invalid Modbus read'));
    }
    const pdu = Buffer.from([
      FUNCTION.READ_HOLDING,
      address >> 8,
      address & 0xff,
      count >> 8,
      count & 0xff,
    ]);
    return this.transact(pdu, options, (answer) => {
      const bytes = answer[1];
      if (answer.length < 2 || bytes !== count * 2 || answer.length !== 2 + bytes) {
        throw new ModbusError(ERROR_KINDS.PROTOCOL, { sent: true, detail: 'byte count' });
      }
      const words = [];
      for (let i = 0; i < count; i += 1) {
        words.push(answer.readUInt16BE(2 + i * 2));
      }
      return words;
    });
  }

  /** Function 16, one register: refused at once outside WRITABLE. */
  write(address, value, options = {}) {
    if (!WRITABLE.has(address)) {
      return Promise.reject(new ModbusError(ERROR_KINDS.FORBIDDEN, { detail: String(address) }));
    }
    if (!Number.isInteger(value) || value < 0 || value > 0xffff) {
      return Promise.reject(new RangeError('Invalid Modbus write'));
    }
    const pdu = Buffer.from([
      FUNCTION.WRITE_MULTIPLE,
      address >> 8,
      address & 0xff,
      0,
      1,
      2,
      value >> 8,
      value & 0xff,
    ]);
    // The answer of a write: its function, address and quantity, exactly.
    const echo = pdu.subarray(0, 5);
    return this.transact(pdu, options, (answer) => {
      if (!answer.equals(echo)) {
        throw new ModbusError(ERROR_KINDS.PROTOCOL, { sent: true, detail: 'echo' });
      }
      return value;
    });
  }

  /**
   * One request and its answer. `answerBy` (monotonic): the last moment to
   * wait for its answer (default: now + readTimeout); `startBy`: the last
   * moment the request may leave; `answerWithin`: the answer is awaited
   * this long after the bytes leave (then `answerBy` only bounds the wait
   * for the connection). `beforeSend`: a last check run once
   * connected, right before the bytes leave; what it throws is rethrown
   * with `beforeSend: true`, nothing sent.
   */
  async transact(pdu, { startBy, answerBy, answerWithin, beforeSend }, check) {
    if (this.closed) {
      throw new ModbusError(ERROR_KINDS.UNREACHABLE);
    }
    const end = answerBy ?? this.monotonic() + this.timings.readTimeout;
    const leaveBy = Math.min(startBy ?? end, end);
    await this.open(leaveBy);
    // The controller's pace: the delay after the connection, the gap
    // after the last transaction.
    const wait = Math.max(
      this.readyAt - this.monotonic(),
      this.lastRequestAt + this.timings.messageGap - this.monotonic(),
    );
    if (wait > 0) {
      if (this.monotonic() + wait > leaveBy) {
        throw new ModbusError(ERROR_KINDS.LATE);
      }
      await new Promise((resolve) => this.timers.setTimeout(resolve, wait));
    }
    if (this.monotonic() > leaveBy) {
      throw new ModbusError(ERROR_KINDS.LATE);
    }
    if (beforeSend) {
      try {
        beforeSend();
      } catch (err) {
        err.beforeSend = true;
        throw err;
      }
    }
    const socket = this.socket;
    if (!socket || this.pending || socket.destroyed) {
      throw new ModbusError(ERROR_KINDS.UNREACHABLE);
    }
    this.transaction = (this.transaction % 0xffff) + 1;
    const tid = this.transaction;
    const frame = Buffer.alloc(HEADER + pdu.length);
    frame.writeUInt16BE(tid, 0);
    frame.writeUInt16BE(0, 2);
    frame.writeUInt16BE(pdu.length + 1, 4);
    frame.writeUInt8(this.unitId, 6);
    pdu.copy(frame, HEADER);
    const until = answerWithin === undefined ? end : this.monotonic() + answerWithin;
    return new Promise((resolve, reject) => {
      const pending = {
        tid,
        fn: pdu[0],
        check,
        resolve,
        reject,
        timer: undefined,
      };
      pending.timer = this.timers.setTimeout(
        () => {
          if (this.pending !== pending) {
            return;
          }
          if (this.inbox.length > 0) {
            // Half an answer: the line is not trusted any more.
            this.fail(pending, new ModbusError(ERROR_KINDS.TIMEOUT, { sent: true }), true);
            return;
          }
          // Silence (a read or a write): the connection stays, so that a
          // heating stop waiting behind it leaves at once, without the
          // controller's 10 s settle; a late answer will be dropped.
          this.abandon(pending);
          pending.reject(new ModbusError(ERROR_KINDS.TIMEOUT, { sent: true }));
        },
        Math.max(0, until - this.monotonic()),
      );
      this.pending = pending;
      this.lastRequestAt = this.monotonic();
      // From here the request may reach the controller: `sent` in every error.
      socket.write(frame);
    });
  }

  /** The connection, opened when needed; gives up at `by` (nothing sent). */
  async open(by) {
    if (this.socket && (this.socket.destroyed || this.socket.writable === false)) {
      this.drop(new ModbusError(ERROR_KINDS.CLOSED));
    }
    if (this.socket) {
      return;
    }
    const settle = this.closedAt + this.timings.closeSettle - this.monotonic();
    if (settle > 0) {
      if (this.monotonic() + settle > by) {
        throw new ModbusError(ERROR_KINDS.LATE, { detail: 'settle' });
      }
      await new Promise((resolve) => this.timers.setTimeout(resolve, settle));
      if (this.closed) {
        throw new ModbusError(ERROR_KINDS.UNREACHABLE);
      }
      if (this.socket) {
        return;
      }
    }
    if (!this.connecting) {
      this.connecting = this.dial().finally(() => {
        this.connecting = undefined;
      });
    }
    let timer;
    const late = new Promise((_, reject) => {
      timer = this.timers.setTimeout(
        () => reject(new ModbusError(ERROR_KINDS.LATE)),
        Math.max(0, by - this.monotonic()),
      );
    });
    try {
      await Promise.race([this.connecting, late]);
    } finally {
      this.timers.clearTimeout(timer);
    }
  }

  dial() {
    return new Promise((resolve, reject) => {
      let settled = false;
      let socket;
      const timer = this.timers.setTimeout(() => {
        if (!settled) {
          settled = true;
          socket?.destroy();
          this.closedAt = this.monotonic();
          reject(new ModbusError(ERROR_KINDS.UNREACHABLE, { detail: 'connect timeout' }));
        }
      }, this.timings.connectTimeout);
      try {
        socket = this.connect({ host: this.host, port: this.port });
      } catch {
        settled = true;
        this.timers.clearTimeout(timer);
        reject(new ModbusError(ERROR_KINDS.UNREACHABLE));
        return;
      }
      socket.on('error', () => {
        if (!settled) {
          settled = true;
          this.timers.clearTimeout(timer);
          socket.destroy();
          reject(new ModbusError(ERROR_KINDS.UNREACHABLE));
        }
      });
      socket.once('connect', () => {
        if (settled) {
          socket.destroy();
          return;
        }
        settled = true;
        this.timers.clearTimeout(timer);
        if (this.closed) {
          socket.destroy();
          reject(new ModbusError(ERROR_KINDS.UNREACHABLE));
          return;
        }
        socket.setNoDelay?.(true);
        this.socket = socket;
        this.inbox = Buffer.alloc(0);
        this.abandoned = [];
        this.connections += 1;
        this.readyAt = this.monotonic() + this.timings.connectDelay;
        socket.on('data', (chunk) => this.receive(socket, chunk));
        socket.on('close', () => {
          if (this.socket === socket) {
            this.drop(new ModbusError(ERROR_KINDS.CLOSED, { sent: true }));
          }
        });
        this.onSession?.();
        resolve();
      });
      socket.once('close', () => {
        if (!settled) {
          settled = true;
          this.timers.clearTimeout(timer);
          reject(new ModbusError(ERROR_KINDS.UNREACHABLE));
        }
      });
    });
  }

  receive(socket, chunk) {
    if (socket !== this.socket) {
      return;
    }
    this.inbox = Buffer.concat([this.inbox, chunk]);
    while (this.socket === socket && this.inbox.length >= HEADER) {
      const length = this.inbox.readUInt16BE(4);
      if (this.inbox.readUInt16BE(2) !== 0 || length < 3 || length > LIMITS.frameBytes - 6) {
        this.protocol('header');
        return;
      }
      const total = 6 + length;
      if (this.inbox.length < total) {
        break;
      }
      const frame = this.inbox.subarray(0, total);
      this.inbox = this.inbox.subarray(total);
      this.handle(frame);
    }
    if (this.socket === socket && this.inbox.length > LIMITS.frameBytes) {
      this.protocol('too long');
    }
  }

  protocol(detail) {
    const err = new ModbusError(ERROR_KINDS.PROTOCOL, { sent: true, detail });
    if (this.pending) {
      this.fail(this.pending, err, true);
    } else {
      this.drop(err);
    }
  }

  handle(frame) {
    const tid = frame.readUInt16BE(0);
    const late = this.abandoned.indexOf(tid);
    if (late !== -1 && (!this.pending || this.pending.tid !== tid)) {
      // The late answer of a request given up: dropped, the line stays.
      this.abandoned.splice(late, 1);
      return;
    }
    const pending = this.pending;
    if (!pending || tid !== pending.tid || frame.readUInt8(6) !== this.unitId) {
      this.protocol('transaction');
      return;
    }
    const answer = frame.subarray(HEADER);
    if (answer[0] === (pending.fn | 0x80)) {
      if (answer.length !== 2) {
        this.protocol('exception');
        return;
      }
      // A well-formed refusal: the connection stays.
      this.fail(pending, new ModbusError(ERROR_KINDS.EXCEPTION, { code: answer[1], sent: true }));
      return;
    }
    if (answer[0] !== pending.fn) {
      this.protocol('function');
      return;
    }
    let value;
    try {
      value = pending.check(answer);
    } catch (err) {
      this.fail(pending, err, true);
      return;
    }
    this.settle(pending);
    pending.resolve(value);
  }

  settle(pending) {
    this.timers.clearTimeout(pending.timer);
    if (this.pending === pending) {
      this.pending = undefined;
    }
  }

  fail(pending, err, dropConnection = false) {
    if (this.pending !== pending) {
      return;
    }
    this.settle(pending);
    pending.reject(err);
    if (dropConnection) {
      this.drop(err);
    }
  }

  /** Closes the connection; a request in flight fails with `err`. */
  drop(err) {
    const socket = this.socket;
    this.socket = undefined;
    this.inbox = Buffer.alloc(0);
    this.abandoned = [];
    const pending = this.pending;
    if (pending) {
      this.settle(pending);
      pending.reject(err);
    }
    if (socket) {
      socket.destroy();
      this.closedAt = this.monotonic();
      this.onSession?.();
    }
  }
}
