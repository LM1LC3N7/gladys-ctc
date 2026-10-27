// -----------------------------------------------------------------------------
// The CTC register map (pure): what is read, how it decodes, what may be
// written. Source: CTC's BMS manual 162 600 16-3 (CR01143, 2026-02-02),
// "Modbus address register/complete BMS list"; the read blocks are those
// HA-CTC-Local-Easyconf v0.29.0 (Apache-2.0) reads on real units (see
// THIRD_PARTY_NOTICES.md).
//
//   - Everything is a holding register: function 3 to read, 16 to write,
//     offset 0, at most 100 registers per transmission (manual).
//   - Signed words are two's complement; a 32-bit value is two words, the
//     least significant first (manual: "LSB", "(<< 16) MSB").
//   - CTC answers "no sensor" with markers (±9999, ±10000, 32767, -32768,
//     and both words all ones for a pair): never a value (the reference).
//   - Writes: only the volatile 1000 block, which the controller forgets 5
//     minutes after the last write and at a restart (manual, "Control
//     parameters"), and only the three registers below. The stored
//     settings (615xx, EEPROM with a limited number of write cycles) are
//     never written: src/modbus/client.js refuses any other address.
// -----------------------------------------------------------------------------

import { FEATURES as F } from './constants.js';

/** The register every model answers, read first in a round (the reference). */
export const PROBE_REGISTER = 62000;

/**
 * The blocks of a round, the probe's first. `core`: a round without it
 * fails. The others may be missing on a model (silence).
 */
export const BLOCKS = [
  { start: 62000, count: 98, core: true },
  { start: 62107, count: 41 },
  { start: 62167, count: 7 },
  { start: 62191, count: 25 },
  { start: 62234, count: 13 },
  { start: 62274, count: 6 },
  { start: 62301, count: 1 },
  { start: 62331, count: 12 },
  { start: 61500, count: 22 },
  { start: 61542, count: 1 },
];

/** The software version of the display: the only identity Modbus gives. */
export const IDENTITY = { start: 62244, count: 2 };

const SENTINELS = new Set([9999, -9999, 10000, -10000, 32767, -32768]);

/** Codes -> keys of the texts (src/i18n.js), from the manual. */
export const ENUMS = {
  system: {
    0: 'hpUpper',
    1: 'hpLower',
    2: 'additional',
    3: 'hpAndAdditional',
    4: 'heating',
    5: 'hotWater',
    6: 'pool',
    7: 'off',
    8: 'heatingMix',
    9: 'wood',
    10: 'hotWaterHeating',
    11: 'cooling',
    12: 'swap',
  },
  heatpump: {
    0: 'startDelay',
    1: 'readyToStart',
    2: 'waitingForFlow',
    3: 'heating',
    4: 'defrost',
    5: 'cooling',
    6: 'blocked',
    7: 'alarm',
    // Beyond the manual's 0-7: the codes the reference reads on real units.
    8: 'functionTest',
    30: 'notDefined',
    31: 'notAvailable',
    32: 'communicationError',
    33: 'hotWater',
  },
  heating: { 0: 'heatingOff', 1: 'vacation', 2: 'nightReduction', 3: 'on' },
  smartgrid: { 0: 'normal', 1: 'block', 2: 'lowPrice', 3: 'highCapacity' },
  dhwMode: { 0: 'economy', 1: 'normal', 2: 'comfort' },
  heatingModeSetting: { 0: 'auto', 1: 'on', 2: 'off' },
};

/**
 * Heat pump status codes behind the flags (manual 62017, and 33 = hot water
 * charge, compressor on, from the reference). Codes saying nothing about
 * the compressor (8 function test, 30-32 not defined, not available,
 * communication error, unknown codes) give no flag.
 */
export const COMPRESSOR_CODES = new Set([3, 5, 33]);
export const STOPPED_CODES = new Set([0, 1, 2, 4, 6, 7]);
export const DEFROST_CODE = 4;
export const ALARM_CODE = 7;

const t = (min, max) => ({ scale: 0.1, signed: true, min, max });
const TEMP = t(-60, 150);

/**
 * The values read, by role: address, scale, signedness, plausible range,
 * `pair` for 32 bits, `enum` for a code. Out of range = not a value.
 */
export const VALUES = {
  [F.TEMP_OUTDOOR]: { address: 62000, ...TEMP },
  [F.SYSTEM_STATUS]: { address: 62005, enum: 'system' },
  [F.TEMP_RADIATOR]: { address: 62006, ...TEMP },
  [F.FLOW_SETPOINT]: { address: 62007, ...t(0, 100) },
  [F.TEMP_FLOW]: { address: 62011, ...TEMP },
  [F.TEMP_RETURN]: { address: 62015, ...TEMP },
  [F.HEATPUMP_STATUS]: { address: 62017, enum: 'heatpump' },
  [F.TEMP_HP_IN]: { address: 62027, ...TEMP },
  [F.TEMP_HP_OUT]: { address: 62037, ...TEMP },
  [F.TEMP_DISCHARGE]: { address: 62047, ...TEMP },
  [F.TEMP_SUCTION]: { address: 62057, ...TEMP },
  [F.PRESSURE_HIGH]: { address: 62067, ...t(0, 60) },
  [F.PRESSURE_LOW]: { address: 62077, ...t(0, 60) },
  [F.TEMP_BRINE_IN]: { address: 62087, ...TEMP },
  [F.TEMP_BRINE_OUT]: { address: 62097, ...TEMP },
  [F.CHARGE_PUMP]: { address: 62107, ...t(0, 100) },
  [F.BRINE_PUMP]: { address: 62117, ...t(0, 100) },
  [F.FAN]: { address: 62127, ...t(0, 100) },
  [F.TEMP_HP_OUTDOOR]: { address: 62147, ...TEMP },
  [F.DEGREE_MINUTES]: { address: 62167, ...t(-5000, 5000) },
  [F.IMMERSION_POWER]: { address: 62168, ...t(0, 100) },
  [F.IMMERSION_POWER_LOWER]: { address: 62169, ...t(0, 100) },
  [F.CURRENT_L1]: { address: 62171, ...t(0, 200) },
  [F.CURRENT_L2]: { address: 62172, ...t(0, 200) },
  [F.CURRENT_L3]: { address: 62173, ...t(0, 200) },
  // Lifetime counter in one word: unsigned (the reference).
  [F.IMMERSION_ENERGY]: { address: 62191, scale: 1, signed: false, min: 0, max: 65_534 },
  [F.COMPRESSOR_SPEED]: { address: 62193, ...t(0, 200) },
  [F.TEMP_ROOM]: { address: 62203, ...TEMP },
  [F.TEMP_ROOM_2]: { address: 62204, ...TEMP },
  [F.COMPRESSOR_HOURS]: { address: 62214, pair: true, scale: 1, min: 0, max: 10_000_000 },
  [F.COMPRESSOR_MINUTES_24H]: { address: 62234, scale: 1, signed: false, min: 0, max: 1440 },
  [F.HEATING_STATUS]: { address: 62246, enum: 'heating' },
  [F.TANK_LOWER_SETPOINT]: { address: 62274, ...t(0, 100) },
  [F.TEMP_DHW_LOWER]: { address: 62275, ...TEMP },
  [F.TEMP_DHW]: { address: 62276, ...TEMP },
  [F.DHW_CAPACITY]: { address: 62279, ...t(0, 100) },
  [F.SMARTGRID]: { address: 62301, enum: 'smartgrid' },
  [F.COMPRESSOR_ENERGY]: { address: 62341, pair: true, scale: 1, min: 0, max: 100_000_000 },
  [F.DHW_MODE_SETTING]: { address: 61500, enum: 'dhwMode' },
  [F.ROOM_SETTING]: { address: 61509, ...t(0, 40) },
  [F.HEATING_MODE_SETTING]: { address: 61542, enum: 'heatingModeSetting' },
};

/**
 * The volatile control registers this integration writes (manual, "Value
 * shall be updated before 5 minutes", all W): nothing else, ever.
 *   - 1015 zone mode HC1: 0 = Off, 1 = Heat, 2 = cool, 3 = auto, 4 = On;
 *   - 1007 DHW mode: 0 = Economy, 1 = Normal, 2 = Comfort;
 *   - 1010 setpoint heat HC1, in tenths of °C (the manual gives no factor
 *     for the 1000 block; tenths as the stored 61509 and as the reference
 *     writes it on real units).
 * `program` gives control back: nothing is written, the controller forgets
 * the last value within 5 minutes.
 */
export const CONTROLS = {
  [F.HEATING_MODE]: {
    address: 1015,
    options: { program: undefined, off: 0, heat: 1, auto: 3 },
  },
  [F.DHW_MODE]: {
    address: 1007,
    options: { program: undefined, economy: 0, normal: 1, comfort: 2 },
  },
  [F.ROOM_SETPOINT]: { address: 1010, scale: 0.1 },
};

export const WRITABLE = new Set(Object.values(CONTROLS).map((c) => c.address));

/** The heating stop: zone mode HC1 Off. */
export const STOP = { role: F.HEATING_MODE, address: 1015, word: 0, key: 'off' };

const toSigned = (word) => (word > 0x7fff ? word - 0x10000 : word);

function decodeOne(def, raw) {
  const first = raw.get(def.address);
  if (first === undefined) {
    return undefined;
  }
  if (def.pair) {
    const second = raw.get(def.address + 1);
    if (second === undefined || (first === 0xffff && second === 0xffff)) {
      return undefined;
    }
    const value = second * 0x10000 + first;
    return value >= def.min && value <= def.max ? value * def.scale : undefined;
  }
  if (def.enum) {
    const code = toSigned(first);
    if (SENTINELS.has(code) || code < 0) {
      return undefined;
    }
    return { code, key: ENUMS[def.enum][code] };
  }
  const number = def.signed ? toSigned(first) : first;
  // The markers are signed words; an unsigned counter only has all ones.
  if ((def.signed && SENTINELS.has(number)) || (!def.signed && number === 0xffff)) {
    return undefined;
  }
  const value = Math.round(number * def.scale * 1000) / 1000;
  return value >= def.min && value <= def.max ? value : undefined;
}

/**
 * The words of a round (address -> word) to values by role, plus the
 * flags of the heat pump status and the identity. Unknown stays undefined.
 */
export function decode(raw) {
  const values = {};
  for (const [role, def] of Object.entries(VALUES)) {
    const value = decodeOne(def, raw);
    if (value !== undefined) {
      values[role] = value;
    }
  }
  const status = values[F.HEATPUMP_STATUS];
  if (status && (COMPRESSOR_CODES.has(status.code) || STOPPED_CODES.has(status.code))) {
    values[F.COMPRESSOR] = COMPRESSOR_CODES.has(status.code) ? 1 : 0;
    values[F.DEFROST] = status.code === DEFROST_CODE ? 1 : 0;
    values[F.ALARM] = status.code === ALARM_CODE ? 1 : 0;
  }
  return values;
}

/**
 * The identity of the controller from its two words: the software version
 * of the display (month-day, year). undefined when missing or a marker.
 */
export function identityOf(monthDay, year) {
  if (!Number.isInteger(monthDay) || !Number.isInteger(year)) {
    return undefined;
  }
  // The manual does not say how the words are laid out: they are compared
  // as they are, never interpreted; only markers and zeros are refused.
  if (SENTINELS.has(toSigned(monthDay)) || SENTINELS.has(toSigned(year))) {
    return undefined;
  }
  if (monthDay === 0 || year === 0 || monthDay === 0xffff || year === 0xffff) {
    return undefined;
  }
  return `${year}.${monthDay}`;
}

/** The room setpoint word for a value in °C (tenths, rounded). */
export const setpointWord = (value) => Math.round(value * 10);
