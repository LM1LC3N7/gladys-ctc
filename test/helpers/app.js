// -----------------------------------------------------------------------------
// The app against the SDK's fake Gladys, the fake CTC and the kit's virtual
// clock (each read of it moves 1 µs: a decision reading it twice is caught).
// The wall clock can be set apart from the monotonic one (`wall.offset`).
// -----------------------------------------------------------------------------

import { createFakeGladys } from '@gladysassistant/integration-sdk/testing';
import { CtcApp } from '../../src/app.js';
import { buildDevice } from '../../src/devices.js';
import { createMemoryStore } from '../../src/store.js';
import { testClock } from '../kit/clock.mjs';
import { HOST, NOW, fakeCtc } from '../fixtures/fakeCtc.js';

export const SELECTOR = 'ctc';
export const SECOND = 1000;
export const MINUTE = 60 * SECOND;
export const CONFIG = { address: HOST };
export const ID = (role) => `ext:${SELECTOR}:heat-pump:ctc:${role}`;
export const ALLOWED = { address: HOST, allow_commands: true };

/** The device as the user created it from Discovery (every feature). */
export function createdDevice(language = 'fr') {
  const gladys = createFakeGladys({ selector: SELECTOR });
  const roles = new Set(Object.keys(buildDevice(gladys, { roles: new Set(), language }).features));
  const all = buildDevice(gladys, {
    roles: new Set([
      ...roles,
      'temperature-outdoor',
      'heatpump-status',
      'compressor',
      'room-setting',
      'temperature-dhw',
      'heating-status',
    ]),
    identity: '2023.1203',
    language,
  });
  return all;
}

export async function setup({
  config = CONFIG,
  ctc = fakeCtc(),
  store = createMemoryStore(),
  devices = [createdDevice()],
  wall = { offset: 0 },
  start = true,
} = {}) {
  const gladys = createFakeGladys({ selector: SELECTOR, config, devices });
  await gladys.connect();
  const clock = testClock({ start: NOW });
  const lines = [];
  const log = (...args) => lines.push(args.map(String).join(' '));
  const app = new CtcApp({
    gladys,
    logger: { lines, info: log, warn: log, error: log, debug: log },
    connect: (options) => ctc.connect({ ...options, timers: clock.timers }),
    now: () => clock.now() + wall.offset,
    monotonic: clock.monotonic,
    timers: clock.timers,
    store,
  });
  /** Moves the virtual clock by `ms` in small steps, letting the I/O run. */
  const wait = async (ms, step = 50) => {
    let left = ms;
    while (left > 0) {
      const d = Math.min(step, left);
      await clock.advance(d);
      for (let i = 0; i < 6; i += 1) await new Promise((r) => setImmediate(r));
      left -= d;
    }
  };
  /** Runs `promise` while the clock moves, up to `ms`; resolves its outcome. */
  const during = async (promise, ms = 10 * SECOND) => {
    let outcome;
    const settled = promise.then(
      (value) => (outcome = { value }),
      (error) => (outcome = { error }),
    );
    let spent = 0;
    while (!outcome && spent < ms) {
      await wait(50);
      spent += 50;
    }
    await settled.catch(() => {});
    return outcome ?? { pending: true };
  };
  const ctx = { app, gladys, clock, ctc, store, lines, wait, during, wall };
  if (start) {
    const started = during(app.connected(config), 30 * SECOND);
    await started;
  }
  return ctx;
}

/** setValue on one of our features, with the clock moving. */
export function command(ctx, role, value, ms = 10 * SECOND) {
  return ctx.during(ctx.app.setValue({}, { external_id: ID(role) }, value), ms);
}

/** The last state published for a role. */
export function stateOf(gladys, role) {
  const states = gladys.fake.states.filter((s) => s.device_feature_external_id === ID(role));
  const last = states.at(-1);
  return last?.text ?? last?.state;
}
