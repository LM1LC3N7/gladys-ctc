// -----------------------------------------------------------------------------
// The integration: the CTC controller typed in the configuration (the IP
// address of its display), one Modbus round of its registers every poll
// interval, the Gladys device and its states, the transport badge, the two
// buttons, and the control through CTC's volatile 1000 block.
// index.js only wires the SDK handlers.
//
// The control (BMS manual: a 1000 register is forgotten 5 minutes after the
// last write, and at a restart of the controller):
//   - a value Gladys holds is written again every minute; when no write has
//     been acknowledged for 5 minutes, the controller has forgotten it and
//     Gladys says so;
//   - "Heating off" (zone mode HC1 = Off) is the protective command: never
//     refused for the option, an unread controller, a read in flight (cut
//     after 1 s of silence), a busy line or a /data failure; kept in /data
//     with its address and written again at start, before the configuration
//     is even read, then every minute (every 15 s until acknowledged);
//   - everything else (another mode, the hot water mode, the room setpoint)
//     needs "Allow the commands", is decided after a fresh read of the
//     controller's identity in the same Modbus session, is cancelled by a
//     heating off asked before it left, and is never written again after a
//     restart: the controller forgets it within 5 minutes;
//   - giving control back ("Controller's own program", or the button)
//     writes nothing; giving back a heating off restarts the heating and
//     needs the option.
//
// Clocks: `monotonic` for every deadline, pause and hold; `now` (wall) only
// for the date kept in /data.
// -----------------------------------------------------------------------------

import { DEVICE_TRANSPORTS, createLogger } from '@gladysassistant/integration-sdk';
import { addressKey, normalizeConfig, parseAddress, sameAddress } from './config.js';
import { FEATURES as F, LIMITS, ROOM_SETPOINT, SECOND, TIMINGS, UNIT_ID } from './constants.js';
import { BLOCKS, CONTROLS, IDENTITY, STOP, decode, identityOf, setpointWord } from './ctc.js';
import {
  COMMAND_ROLES,
  buildDevice,
  deviceIds,
  deviceStates,
  parseFeatureId,
  reportedRoles,
} from './devices.js';
import { ERRORS, HOLD_TEXTS, OPTION_NAMES, T, age, join, word } from './i18n.js';
import { ERROR_KINDS, LEVEL, ModbusClient, errorReason } from './modbus/client.js';
import { StatePublisher } from './publisher.js';
import { createFileStore } from './store.js';

/**
 * Modbus exception codes that say a write was not applied: 1 illegal
 * function, 2 illegal data address, 3 illegal data value, 6 busy, 10
 * gateway path unavailable. Any other code is ambiguous.
 */
const REFUSALS = new Set([1, 2, 3, 6, 10]);

/** Errors that end a round: the line, not a register. */
const LINE_ERRORS = new Set([
  ERROR_KINDS.UNREACHABLE,
  ERROR_KINDS.CLOSED,
  ERROR_KINDS.PROTOCOL,
  ERROR_KINDS.LATE,
]);

/** A number sent by Gladys: a finite number, or a plain decimal text ('' and null are not 0). */
function numberOf(value) {
  if (typeof value === 'number') {
    return Number.isFinite(value) ? value : undefined;
  }
  if (typeof value === 'string' && /^-?\d{1,3}(\.\d{1,3})?$/.test(value)) {
    return Number(value);
  }
  return undefined;
}

const delay = (timers, ms) => new Promise((resolve) => timers.setTimeout(resolve, ms));

export class CtcApp {
  constructor({
    gladys,
    logger = createLogger({ name: 'ctc' }),
    connect,
    now = Date.now,
    monotonic = () => performance.now(),
    timers = globalThis,
    store = createFileStore(),
    timings = TIMINGS,
  }) {
    this.gladys = gladys;
    this.logger = logger;
    /** The socket factory (tests); node:net otherwise. */
    this.connect = connect;
    this.now = now;
    this.monotonic = monotonic;
    this.timers = timers;
    this.store = store;
    this.timings = timings;
    this.publisher = new StatePublisher({ gladys, logger, monotonic, timers });
    this.config = normalizeConfig();
    this.client = undefined;
    this.generation = 0;
    this.started = false;
    this.resumed = false;
    this.storeOk = true;
    this.lastStatus = undefined;
    this.published = undefined;
    this.badge = undefined;
    this.lastTestAt = -Infinity;
    // The controller, as the last rounds saw it.
    this.values = undefined;
    this.identity = undefined;
    this.identityChanged = false;
    this.online = undefined;
    this.failures = 0;
    this.wait = undefined;
    this.error = undefined;
    this.missing = new Set();
    this.silent = new Map();
    this.seen = new Set();
    this.pollTimer = undefined;
    this.running = undefined;
    this.keepTimer = undefined;
    // The control.
    /** role -> { word, key?, value?, lastTryAt, ackedAt? } held by Gladys (not the stop). */
    this.holds = new Map();
    /** The heating stop: { address, since (wall), ackedAt?, lastTryAt, writing? } */
    this.heatingStop = undefined;
    /** Moves at every heating off: what was asked before it never leaves after it. */
    this.stopSeq = 0;
    /** role -> number of its last click (commands of a feature in click order). */
    this.clicks = new Map();
  }

  // --- Lifecycle -------------------------------------------------------------

  /**
   * At process start, before Gladys is even reached: a heating stop kept in
   * /data is written again at once to its address (no getConfig, no read).
   */
  resume() {
    if (this.resumed) {
      return;
    }
    this.resumed = true;
    const { data, ok } = this.store.load();
    this.storeOk = ok;
    if (!ok) {
      this.logger.warn('The state file in /data cannot be read: it is left as it is');
    }
    const kept = data?.stop;
    const address =
      kept && typeof kept.host === 'string' && Number.isInteger(kept.port)
        ? parseAddress(`${kept.host}:${kept.port}`)
        : undefined;
    if (!address) {
      return;
    }
    const since = Number.isFinite(kept.since) && kept.since <= this.now() ? kept.since : this.now();
    this.heatingStop = { address, since, ackedAt: undefined, lastTryAt: -Infinity };
    this.useClient(address);
    this.logger.info(`Heating off kept in /data: written again to ${addressKey(address)}`);
    this.writeStop().catch(() => {});
    this.startKeepalive();
  }

  /** The client of `address`, created when it changes (the old one closed). */
  useClient(address) {
    if (this.client && sameAddress(this.client.address, address)) {
      return this.client;
    }
    this.client?.close();
    this.client = undefined;
    if (!address) {
      return undefined;
    }
    const client = new ModbusClient({
      host: address.host,
      port: address.port,
      unitId: UNIT_ID,
      timers: this.timers,
      monotonic: this.monotonic,
      timings: this.timings,
      logger: this.logger,
      ...(this.connect ? { connect: this.connect } : {}),
    });
    client.address = address;
    this.client = client;
    return client;
  }

  async start(raw = {}) {
    this.resume();
    const running = this.running;
    this.generation += 1;
    this.clearPoll();
    await running;
    this.config = normalizeConfig(raw);
    const address = this.config.address;
    if (address && !sameAddress(this.client?.address, address)) {
      this.forgetController();
      if (this.heatingStop && !sameAddress(this.heatingStop.address, address)) {
        // The stop follows the address of the configuration: the same
        // heat pump moved, or the old address is wrong; never dropped.
        this.logger.warn(`Heating off moved to the new address ${addressKey(address)}`);
        this.heatingStop.address = address;
        this.heatingStop.ackedAt = undefined;
        this.persist().catch(() => {});
      }
      this.releaseSensitive('address changed');
    }
    if (address || !this.heatingStop) {
      this.useClient(address);
    }
    this.published = undefined;
    this.badge = undefined;
    this.lastStatus = undefined;
    this.publisher.start();
    this.startKeepalive();
    if (this.heatingStop && !this.heatingStop.writing && this.heatingStop.ackedAt === undefined) {
      this.writeStop().catch(() => {});
    }
    if (!address) {
      await this.publishAll();
      return;
    }
    await this.setStatus(false, T.connecting);
    await this.tick();
  }

  forgetController() {
    this.values = undefined;
    this.identity = undefined;
    this.online = undefined;
    this.failures = 0;
    this.wait = undefined;
    this.error = undefined;
    this.missing = new Set();
    this.silent = new Map();
  }

  /** The end (SIGTERM): nothing written any more; the controller forgets within 5 minutes. */
  async stop() {
    this.generation += 1;
    this.clearPoll();
    if (this.keepTimer) {
      this.timers.clearInterval(this.keepTimer);
      this.keepTimer = undefined;
    }
    this.client?.close();
    this.publisher.stop();
    await this.publisher.flush().catch(() => {});
  }

  clearPoll() {
    if (this.pollTimer) {
      this.timers.clearTimeout(this.pollTimer);
      this.pollTimer = undefined;
    }
  }

  /**
   * Connected to Gladys. The first time, start; after a reconnection (Gladys
   * restarted), resend what Gladys keeps in memory only (status, Discovery
   * list, badges) and the last states. The client, the holds and the stop stay.
   */
  async connected(raw = {}) {
    if (!this.started) {
      this.started = true;
      await this.start(raw);
      return;
    }
    if (this.needsRestart(raw)) {
      await this.start(raw);
      return;
    }
    this.applyConfig(raw);
    this.published = undefined;
    this.badge = undefined;
    this.lastStatus = undefined;
    this.gladys.forgetPublishedStates?.();
    await this.publishAll();
  }

  needsRestart(raw) {
    const next = normalizeConfig(raw);
    return (
      next.pollInterval !== this.config.pollInterval ||
      !sameAddress(next.address, this.config.address) ||
      next.invalid !== this.config.invalid
    );
  }

  applyConfig(raw) {
    const previous = this.config;
    this.config = normalizeConfig(raw);
    if (previous.allowCommands && !this.config.allowCommands) {
      this.logger.info('Commands disabled: what Gladys held is given back');
      this.releaseSensitive('commands disabled');
    }
    return previous;
  }

  /** A new address or interval restarts; the option and the language apply at once. */
  async configUpdated(raw = {}) {
    if (this.needsRestart(raw)) {
      await this.start(raw);
      return;
    }
    const previous = this.applyConfig(raw);
    this.published = previous.language === this.config.language ? this.published : undefined;
    await this.publishAll();
  }

  async setStatus(connected, message) {
    const key = JSON.stringify([connected, message ?? null]);
    if (key === this.lastStatus) {
      return;
    }
    this.lastStatus = key;
    await this.gladys
      .setConnectionStatus(connected, message)
      .catch((err) => this.logger.warn(`setConnectionStatus failed: ${err.message}`));
  }

  // --- Polling ---------------------------------------------------------------

  get interval() {
    return this.config.pollInterval * SECOND;
  }

  /** The next round: after a backoff when the last one failed, else the interval. */
  schedule(startedAt) {
    this.clearPoll();
    const wait = this.online === false ? this.wait : this.interval;
    const generation = this.generation;
    // Counted from the start of the round: the period is the interval.
    const due = startedAt + (wait ?? this.interval);
    this.pollTimer = this.timers.setTimeout(
      () => {
        this.pollTimer = undefined;
        if (generation === this.generation) {
          this.tick().catch(() => this.logger.error('CTC refresh failed'));
        }
      },
      Math.max(0, due - this.monotonic()),
    );
  }

  /** One round at a time: a tick during a round joins it. */
  tick() {
    if (!this.client || !this.config.address) {
      return Promise.resolve();
    }
    if (!this.running) {
      this.running = this.round().finally(() => {
        this.running = undefined;
      });
    }
    return this.running;
  }

  async round() {
    const generation = this.generation;
    const client = this.client;
    const startedAt = this.monotonic();
    this.lastRoundAt = startedAt;
    const raw = new Map();
    const answered = [];
    const unanswered = [];
    let failure;
    for (const block of BLOCKS) {
      if (this.missing.has(block.start)) {
        continue;
      }
      try {
        const words = await client.readHolding(block.start, block.count);
        words.forEach((w, i) => raw.set(block.start + i, w));
        answered.push(block.start);
      } catch (err) {
        if (generation !== this.generation) {
          return;
        }
        if (err.kind === ERROR_KINDS.CUT) {
          // Given up for a heating stop: neither a failure nor a silence.
          continue;
        }
        if (LINE_ERRORS.has(err.kind) || !err.kind) {
          failure = err;
          break;
        }
        if (block.core && answered.length === 0) {
          // The register every model answers is silent: the line is dead to us.
          failure = err;
          break;
        }
        unanswered.push(block.start);
      }
      if (generation !== this.generation) {
        return;
      }
    }
    if (generation !== this.generation) {
      return;
    }
    if (!failure && answered.length === 0) {
      failure = { reason: 'no answer' };
    }
    if (failure) {
      this.failed(failure);
    } else {
      this.learnMissing(answered, unanswered);
      this.succeeded(raw);
    }
    await this.publishAll();
    if (generation === this.generation) {
      this.schedule(startedAt);
    }
  }

  /** A block silent LIMITS.missingPatience rounds in a row, while others answer, is left out. */
  learnMissing(answered, unanswered) {
    for (const start of answered) {
      this.silent.delete(start);
    }
    for (const start of unanswered) {
      const count = (this.silent.get(start) ?? 0) + 1;
      this.silent.set(start, count);
      if (count >= LIMITS.missingPatience && !this.missing.has(start)) {
        this.missing.add(start);
        this.logger.info(`CTC: registers from ${start} never answer, left out until a restart`);
      }
    }
  }

  succeeded(raw) {
    const values = decode(raw);
    const identity = identityOf(raw.get(IDENTITY.start), raw.get(IDENTITY.start + 1));
    if (identity && this.identity && identity !== this.identity) {
      this.logger.warn('CTC: the display software version changed; what Gladys held is given back');
      this.releaseSensitive('identity changed');
      this.identityChanged = true;
    }
    if (identity) {
      this.identity = identity;
    }
    this.values = values;
    for (const role of reportedRoles(values)) {
      this.seen.add(role);
    }
    this.online = true;
    this.failures = 0;
    this.wait = undefined;
    this.error = undefined;
  }

  failed(err) {
    const reason = err.reason ?? errorReason(err);
    // Never read again sooner than the interval.
    const wait = Math.max(
      this.interval,
      this.timings.backoff[Math.min(this.failures, this.timings.backoff.length - 1)],
    );
    this.failures += 1;
    this.online = false;
    this.wait = wait;
    this.error = reason;
    this.values = undefined;
    this.logger.warn(
      `CTC ${addressKey(this.config.address)}: ${reason}; next try in ${Math.round(wait / 1000)} s`,
    );
  }

  get live() {
    return Boolean(this.online === true && this.values);
  }

  // --- The control -----------------------------------------------------------

  /** In force: a write acknowledged less than 5 minutes ago (the controller still holds it). */
  inForce(entry, mono = this.monotonic()) {
    return entry?.ackedAt !== undefined && mono - entry.ackedAt < this.timings.expiry;
  }

  /** What the three commands show: what Gladys holds in force, or the controller's own. */
  controls(mono = this.monotonic()) {
    const heating = this.holds.get(F.HEATING_MODE);
    const dhw = this.holds.get(F.DHW_MODE);
    const room = this.holds.get(F.ROOM_SETPOINT);
    let heatingKey = 'program';
    if (this.heatingStop) {
      heatingKey = this.inForce(this.heatingStop, mono) ? 'off' : undefined;
    } else if (this.inForce(heating, mono)) {
      heatingKey = heating.key;
    }
    return {
      [F.HEATING_MODE]: heatingKey,
      [F.DHW_MODE]: this.inForce(dhw, mono) ? dhw.key : 'program',
      [F.ROOM_SETPOINT]: this.inForce(room, mono) ? room.value : this.values?.[F.ROOM_SETTING],
    };
  }

  holdText(mono = this.monotonic()) {
    const parts = [];
    const stop = this.heatingStop;
    if (stop) {
      if (this.inForce(stop, mono)) {
        parts.push(HOLD_TEXTS.inForce(OPTION_NAMES.off, age(mono - stop.ackedAt)));
      } else if (stop.ackedAt === undefined) {
        parts.push(HOLD_TEXTS.stopPending);
      } else {
        parts.push(HOLD_TEXTS.stopLapsed(age(mono - stop.ackedAt)));
      }
    }
    for (const [role, entry] of this.holds) {
      if (!this.inForce(entry, mono)) {
        continue;
      }
      const name =
        role === F.ROOM_SETPOINT ? HOLD_TEXTS.roomSetpoint(entry.value) : OPTION_NAMES[entry.key];
      parts.push(HOLD_TEXTS.inForce(name, age(mono - entry.ackedAt)));
    }
    if (parts.length === 0) {
      return HOLD_TEXTS.none;
    }
    return { en: parts.map((p) => p.en).join(' · '), fr: parts.map((p) => p.fr).join(' · ') };
  }

  /** The sensitive holds are dropped: nothing written any more for them. */
  releaseSensitive(why) {
    if (this.holds.size > 0) {
      this.logger.info(`CTC: control given back (${why})`);
      this.holds.clear();
    }
  }

  /** The /data state: the heating stop and its address, nothing else. */
  persist() {
    const stop = this.heatingStop;
    const data = stop
      ? {
          version: 1,
          stop: { host: stop.address.host, port: stop.address.port, since: stop.since },
        }
      : { version: 1 };
    return this.store.save(data).then(
      () => {
        this.storeOk = true;
      },
      (err) => {
        this.storeOk = false;
        this.logger.warn(`The state file in /data could not be written: ${err.message}`);
        throw err;
      },
    );
  }

  startKeepalive() {
    if (this.keepTimer) {
      return;
    }
    this.keepTimer = this.timers.setInterval(() => {
      this.keepalive().catch((err) => this.logger.warn(`CTC keepalive failed: ${err.message}`));
    }, this.timings.stopRetry);
  }

  /** Every 15 s: the stop when due, then each held value written a minute ago or more. */
  async keepalive() {
    const mono = this.monotonic();
    const stop = this.heatingStop;
    if (stop && !stop.writing) {
      const acked = stop.ackedAt !== undefined && mono - stop.ackedAt < this.timings.keepalive;
      if (!acked && mono - stop.lastTryAt >= this.timings.stopRetry - 1) {
        await this.writeStop().catch(() => {});
      } else if (stop.ackedAt !== undefined && mono - stop.ackedAt >= this.timings.keepalive) {
        await this.writeStop().catch(() => {});
      }
    }
    for (const [role, entry] of [...this.holds]) {
      const now = this.monotonic();
      const since = entry.ackedAt ?? entry.setAt;
      if (now - since >= this.timings.expiry) {
        // The controller has forgotten it: never taken up again by itself.
        this.holds.delete(role);
        this.logger.warn(`CTC ${role}: no write acknowledged for 5 minutes, given back`);
        continue;
      }
      if (now - entry.lastTryAt < this.timings.keepalive) {
        continue;
      }
      if (!this.config.allowCommands) {
        this.releaseSensitive('commands disabled');
        break;
      }
      await this.rewrite(role, entry).catch(() => {});
    }
    await this.publishAll();
  }

  /** A held value written again, after a fresh read of the identity. */
  async rewrite(role, entry) {
    const client = this.client;
    if (!client) {
      return;
    }
    if (role === F.HEATING_MODE && this.heatingStop) {
      this.holds.delete(role);
      return;
    }
    entry.lastTryAt = this.monotonic();
    const seq = this.stopSeq;
    const check = () => {
      if (this.holds.get(role) !== entry || !this.config.allowCommands || seq !== this.stopSeq) {
        throw new Error('released');
      }
    };
    try {
      await client.session(
        async (raw) => {
          await this.checkIdentity(raw, this.monotonic() + this.timings.commandReadMax);
          check();
          await raw.writeRegister(CONTROLS[role].address, entry.word, { beforeSend: check });
        },
        { level: LEVEL.COMMAND },
      );
      if (this.holds.get(role) === entry) {
        entry.ackedAt = this.monotonic();
      }
    } catch (err) {
      if (err.kind === ERROR_KINDS.EXCEPTION && REFUSALS.has(err.code)) {
        this.holds.delete(role);
        this.logger.warn(
          `CTC ${role}: refused by the controller (${errorReason(err)}), given back`,
        );
        return;
      }
      if (err.identity) {
        this.holds.delete(role);
        this.logger.warn(`CTC ${role}: ${err.identity}, given back`);
        return;
      }
      this.logger.warn(`CTC ${role}: not written again (${err.kind ?? err.message})`);
    }
  }

  /** Reads the identity in the session; throws (err.identity) when it is not the one known. */
  async checkIdentity(raw, answerBy) {
    let words;
    try {
      words = await raw.readHolding(IDENTITY.start, IDENTITY.count, { answerBy });
    } catch (err) {
      err.unread = true;
      throw err;
    }
    const identity = identityOf(words[0], words[1]);
    if (!identity || !this.identity) {
      throw Object.assign(new Error('identity unknown'), { identity: 'identity unknown' });
    }
    if (identity !== this.identity) {
      throw Object.assign(new Error('another controller'), { identity: 'another controller' });
    }
  }

  /**
   * Writes the heating stop now, ahead of everything (a read in flight is
   * cut after 1 s of silence). One write at a time; a failure that sent
   * nothing is tried again within the ack budget.
   */
  writeStop() {
    const stop = this.heatingStop;
    if (!stop) {
      return Promise.resolve(false);
    }
    if (stop.writing) {
      return stop.writing;
    }
    const client = this.client;
    if (!client || !sameAddress(client.address, stop.address)) {
      this.useClient(stop.address);
    }
    const budgetEnd = this.monotonic() + this.timings.stopAckBy - 250;
    stop.writing = (async () => {
      for (;;) {
        stop.lastTryAt = this.monotonic();
        try {
          await this.client.session(
            (raw) =>
              raw.writeRegister(STOP.address, STOP.word, {
                answerBy:
                  this.monotonic() +
                  this.timings.closeSettle +
                  this.timings.connectDelay +
                  this.timings.connectTimeout +
                  this.timings.readTimeout,
              }),
            { level: LEVEL.STOP },
          );
          if (this.heatingStop === stop) {
            stop.ackedAt = this.monotonic();
          }
          return true;
        } catch (err) {
          const again =
            !err.sent && this.monotonic() + 250 < budgetEnd && this.heatingStop === stop;
          this.logger.warn(`CTC heating off: not acknowledged (${errorReason(err)})`);
          if (!again) {
            throw err;
          }
          await delay(this.timers, 250);
        }
      }
    })().finally(() => {
      stop.writing = undefined;
    });
    return stop.writing;
  }

  // --- The commands ------------------------------------------------------------

  refusal(text) {
    return new Error(word(text, this.config.language));
  }

  /** The value of a command, checked strictly: `{ release }` or `{ word, key?, value? }`. */
  parseCommand(role, value) {
    if (role === F.ROOM_SETPOINT) {
      const number = numberOf(value);
      if (number === undefined) {
        throw this.refusal(ERRORS.badNumber);
      }
      if (Math.abs(number * 10 - Math.round(number * 10)) > 1e-6) {
        throw this.refusal(ERRORS.badStep);
      }
      if (number < ROOM_SETPOINT.min || number > ROOM_SETPOINT.max) {
        throw this.refusal(ERRORS.outOfRange(ROOM_SETPOINT.min, ROOM_SETPOINT.max));
      }
      const w = setpointWord(number);
      // The final bound, on the word written.
      if (w < ROOM_SETPOINT.min * 10 || w > ROOM_SETPOINT.max * 10) {
        throw this.refusal(ERRORS.outOfRange(ROOM_SETPOINT.min, ROOM_SETPOINT.max));
      }
      return { word: w, value: w / 10 };
    }
    const options = CONTROLS[role].options;
    if (typeof value !== 'string' || !Object.hasOwn(options, value)) {
      throw this.refusal(ERRORS.badOption);
    }
    if (options[value] === undefined) {
      return { release: true, key: value };
    }
    return { word: options[value], key: value };
  }

  async setValue(_device, feature, value) {
    // The deadlines count from the arrival of the command, before any wait.
    const received = this.monotonic();
    const role = parseFeatureId(this.gladys, feature?.external_id);
    if (!role || !COMMAND_ROLES.includes(role)) {
      throw this.refusal(ERRORS.readOnly);
    }
    const wanted = this.parseCommand(role, value);
    if (role === F.HEATING_MODE && wanted.key === STOP.key) {
      return this.heatingOff(received);
    }
    if (!this.config.allowCommands) {
      throw this.refusal(ERRORS.disabled);
    }
    if (!this.config.address) {
      throw this.refusal(ERRORS.noAddress);
    }
    if (role === F.HEATING_MODE && this.heatingStop?.writing) {
      throw this.refusal(ERRORS.stopRunning);
    }
    // The clicks of one feature apply in their order: a newer one cancels
    // an older one that has not left, and an older one that left late
    // never takes the hold back from it.
    const order = (this.clicks.get(role) ?? 0) + 1;
    this.clicks.set(role, order);
    return wanted.release ? this.release(role) : this.command(role, wanted, received, order);
  }

  /**
   * "Heating off": never refused for the option, an unread controller, a
   * read in flight or /data. Recorded, kept in /data (not awaited), written
   * ahead of everything; the ack waits 3.5 s at most for the controller.
   */
  async heatingOff(received) {
    const address = this.config.address ?? this.heatingStop?.address;
    if (!address) {
      throw this.refusal(ERRORS.noAddress);
    }
    this.stopSeq += 1;
    // A heating mode held (heat, auto) is replaced: never written again.
    this.holds.delete(F.HEATING_MODE);
    if (!this.heatingStop) {
      this.heatingStop = {
        address,
        since: this.now(),
        ackedAt: undefined,
        lastTryAt: -Infinity,
      };
      this.logger.info(`CTC: heating off asked (${addressKey(address)})`);
    }
    this.persist().catch(() => {});
    this.startKeepalive();
    const writing = this.writeStop().then(
      () => true,
      () => false,
    );
    let timer;
    const late = new Promise((resolve) => {
      timer = this.timers.setTimeout(
        () => resolve(false),
        Math.max(0, received + this.timings.stopAckBy - this.monotonic()),
      );
    });
    const acked = await Promise.race([writing, late]);
    this.timers.clearTimeout(timer);
    this.publishAll().catch(() => {});
    if (!acked) {
      throw this.refusal(ERRORS.stopNotYet);
    }
  }

  /** "Controller's own program": nothing written; a stop given back needs /data first. */
  async release(role) {
    if (role === F.HEATING_MODE && this.heatingStop) {
      const stop = this.heatingStop;
      this.heatingStop = undefined;
      try {
        await this.persist();
      } catch {
        this.heatingStop = stop;
        throw this.refusal(ERRORS.storeFailed);
      }
      this.logger.info('CTC: heating off given back to the controller');
    }
    this.holds.delete(role);
    this.publishAll().catch(() => {});
  }

  /** The "Release" button: every value held; the stop only with the option. */
  async releaseOverrides() {
    const names = [];
    for (const [role, entry] of this.holds) {
      names.push(
        role === F.ROOM_SETPOINT ? HOLD_TEXTS.roomSetpoint(entry.value) : OPTION_NAMES[entry.key],
      );
    }
    this.holds.clear();
    const notes = [];
    if (this.heatingStop) {
      if (this.config.allowCommands) {
        try {
          await this.release(F.HEATING_MODE);
          names.push(OPTION_NAMES.off);
        } catch {
          notes.push(ERRORS.storeFailed);
        }
      } else {
        notes.push(T.release.stopKept);
      }
    }
    await this.publishAll();
    const done =
      names.length > 0
        ? T.release.done({
            en: names.map((n) => n.en).join(', '),
            fr: names.map((n) => n.fr).join(', '),
          })
        : T.release.nothing;
    return join([done, ...notes]);
  }

  /** The checks right before the bytes leave, on the latest state. */
  checkBeforeSend(generation, seq, role, order) {
    if (role !== undefined && this.clicks.get(role) !== order) {
      throw this.refusal(ERRORS.superseded);
    }
    if (!this.config.allowCommands) {
      throw this.refusal(ERRORS.disabled);
    }
    if (seq !== this.stopSeq) {
      throw this.refusal(ERRORS.cancelledByStop);
    }
    if (generation !== this.generation) {
      throw this.refusal(ERRORS.notSent('restart'));
    }
  }

  async command(role, wanted, received, order) {
    const generation = this.generation;
    const seq = this.stopSeq;
    const client = this.client;
    const sendBy = received + this.timings.commandSendBy;
    const readBy = Math.min(
      this.monotonic() + this.timings.commandReadMax,
      sendBy - this.timings.commandMinRead,
    );
    this.checkBeforeSend(generation, seq, role, order);
    let left = false;
    try {
      await client.session(
        async (raw) => {
          try {
            await this.checkIdentity(raw, readBy);
          } catch (err) {
            if (err.identity === 'another controller') {
              throw this.refusal(ERRORS.otherController);
            }
            if (err.identity) {
              throw this.refusal(ERRORS.noIdentity);
            }
            throw this.refusal(
              err.kind === ERROR_KINDS.LATE
                ? ERRORS.tooSlow
                : ERRORS.unknownState(errorReason(err)),
            );
          }
          this.checkBeforeSend(generation, seq, role, order);
          await raw.writeRegister(CONTROLS[role].address, wanted.word, {
            startBy: sendBy,
            answerBy: received + this.timings.commandAnswerBy,
            beforeSend: () => {
              this.checkBeforeSend(generation, seq, role, order);
              left = true;
              this.logger.info(`CTC ${role}: ${wanted.key ?? wanted.value}`);
              if (role === F.HEATING_MODE && this.heatingStop) {
                // The newer mode leaves now: the stop is not written again.
                this.heatingStop = undefined;
                this.persist().catch(() => {});
                this.logger.info('CTC: heating off replaced by a newer mode');
              }
            },
          });
        },
        { level: LEVEL.COMMAND, startBy: readBy - this.timings.commandMinRead },
      );
    } catch (err) {
      if (!left) {
        // Nothing left: our own refusals as they are, the line in our words.
        if (err.kind === ERROR_KINDS.LATE) {
          throw this.refusal(ERRORS.tooSlow);
        }
        if (err.kind && !err.beforeSend) {
          throw this.refusal(ERRORS.notSent(errorReason(err)));
        }
        throw err;
      }
      // The bytes may have left.
      if (err.kind === ERROR_KINDS.EXCEPTION && REFUSALS.has(err.code)) {
        throw this.refusal(ERRORS.refused(errorReason(err)));
      }
      // Kept, not acknowledged: written again by the keepalive (counted
      // from now: never taken for in force).
      this.hold(role, wanted, undefined, order, seq);
      this.publishAll().catch(() => {});
      throw this.refusal(ERRORS.sentUnconfirmed(errorReason(err)));
    }
    this.hold(role, wanted, this.monotonic(), order, seq);
    this.publishAll().catch(() => {});
  }

  /** A value now held by Gladys, unless a newer click of the feature came meanwhile. */
  hold(role, wanted, ackedAt, order, seq) {
    if (this.clicks.get(role) !== order || seq !== this.stopSeq) {
      // A newer click of this feature, or a heating off, came meanwhile:
      // it decides; this value is never written again.
      return;
    }
    const mono = this.monotonic();
    this.holds.set(role, {
      word: wanted.word,
      key: wanted.key,
      value: wanted.value,
      setAt: mono,
      lastTryAt: mono,
      ackedAt,
    });
    this.startKeepalive();
  }

  // --- Gladys ----------------------------------------------------------------

  createdDevice() {
    const id = deviceIds(this.gladys).device;
    return (this.gladys.devices ?? []).find((d) => d?.external_id === id);
  }

  async publishAll() {
    await this.publishDevice();
    this.queueStates();
    await this.flush();
    await this.publishBadge();
    await this.updateStatus();
  }

  async flush() {
    await this.publisher
      .flush()
      .catch((err) => this.logger.warn(`Sending to Gladys failed: ${err.message}`));
  }

  /** The Discovery list: the controller once read, or the device already created. */
  async publishDevice() {
    const created = this.createdDevice();
    if (!this.identity && !this.live && !created) {
      return;
    }
    const device = buildDevice(this.gladys, {
      roles: this.seen,
      identity: this.identity,
      language: this.config.language,
      created,
    });
    const json = JSON.stringify(device);
    if (json === this.published) {
      return;
    }
    try {
      await this.gladys.publishDiscoveredDevices([device]);
      this.published = json;
    } catch (err) {
      this.logger.warn(`Publishing the discovered device failed: ${err.message}`);
    }
  }

  createdFeatures() {
    return new Set(
      (this.gladys.devices ?? []).flatMap((d) => (d.features ?? []).map((f) => f.external_id)),
    );
  }

  /** The states: the values of the last round only when it succeeded; the commands always. */
  queueStates(created = this.createdFeatures()) {
    if (!this.createdDevice() && !created.size) {
      return;
    }
    const mono = this.monotonic();
    const ids = deviceIds(this.gladys);
    const states = deviceStates(ids, this.live ? this.values : {}, {
      controls: this.controls(mono),
      holdText: this.holdText(mono),
      language: this.config.language,
    });
    for (const { device_feature_external_id: id, ...value } of states) {
      if (created.has(id)) {
        this.publisher.push(id, value);
      }
    }
  }

  async publishBadge() {
    const device = this.createdDevice();
    if (!device || this.online === undefined) {
      return;
    }
    const entries = [
      {
        external_id: device.external_id,
        transport: this.live ? DEVICE_TRANSPORTS.LOCAL : DEVICE_TRANSPORTS.UNREACHABLE,
      },
    ];
    const json = JSON.stringify(entries);
    if (json === this.badge) {
      return;
    }
    try {
      await this.gladys.publishTransports(entries);
      this.badge = json;
    } catch (err) {
      this.logger.warn(`Transport badge failed: ${err.message}`);
    }
  }

  async updateStatus() {
    const [connected, message] = this.status();
    await this.setStatus(connected, message);
  }

  notes() {
    const notes = [];
    if (this.heatingStop) {
      notes.push(this.inForce(this.heatingStop) ? T.notes.stop : T.notes.stopPending);
    }
    if (!this.storeOk) {
      notes.push(T.notes.store);
    }
    if (this.identityChanged) {
      notes.push(T.notes.identity);
    }
    if (this.missing.size > 0) {
      notes.push(T.notes.missing([...this.missing].join(', ')));
    }
    return notes;
  }

  status() {
    if (!this.config.address) {
      const message = this.config.invalid
        ? join([T.noAddress, T.invalid(this.config.invalid)])
        : T.noAddress;
      return [false, join([message, ...this.notes()])];
    }
    if (this.online === false) {
      return [
        false,
        join([
          T.unreachable(addressKey(this.config.address), this.error, age(this.wait)),
          ...this.notes(),
        ]),
      ];
    }
    if (!this.live) {
      return [false, T.connecting];
    }
    return [true, T.connected(this.identity ?? '?', this.notes())];
  }

  /** A device was created (or updated): send its current values at once. */
  async deviceCreated(device) {
    this.badge = undefined;
    const created = this.createdFeatures();
    for (const f of device?.features ?? []) {
      created.add(f.external_id);
    }
    this.queueStates(created);
    await this.flush();
    await this.publishBadge();
    await this.updateStatus();
  }

  async deviceDeleted(device) {
    this.badge = undefined;
    if (typeof device?.external_id === 'string') {
      this.publisher.forget(device.external_id);
    }
  }

  /** The Discovery tab asks for a scan: the device of the last round, sent again. */
  async scan() {
    this.published = undefined;
    await this.publishDevice();
  }

  // --- Configuration buttons -------------------------------------------------

  async testConnection() {
    if (!this.config.address) {
      return this.status()[1];
    }
    if (this.monotonic() - this.lastTestAt < this.timings.testCooldown) {
      return join([T.test.cooldown, this.status()[1]]);
    }
    this.lastTestAt = this.monotonic();
    // A round now, never sooner than the interval after the last start.
    if (!this.running && this.pollTimer) {
      await this.tickIfDue();
    } else {
      await this.running;
    }
    return this.status()[1];
  }

  /** The button never reads sooner than the interval: within it, the last status. */
  async tickIfDue() {
    if (this.lastRoundAt !== undefined && this.monotonic() - this.lastRoundAt < this.interval) {
      return;
    }
    await this.tick();
  }
}
