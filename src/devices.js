// -----------------------------------------------------------------------------
// The controller -> one Gladys device and its states (pure).
//
// `ext:<selector>:heat-pump:ctc`: one CTC controller per integration.
// Modbus gives no serial number nor MAC address and the IP address may
// change, so the id is fixed; the identity checked before a command is the
// display software version (src/ctc.js IDENTITY). The feature roles (the
// last part of their external ids) are published forever: never rename them.
//
// A read-only feature appears once its register gave a value; the commands
// are always there. A device published again never loses a feature: those
// of the device already created in Gladys are kept as they are.
//
// No switch, no writable binary: a "turn everything off" must never reach
// the heat pump. The commands are two `text/select` (heating circuit 1
// mode, hot water mode) and the room setpoint (`thermostat/target-
// temperature`). Compressor, defrost and alarm are read-only flags.
//
// Energy: the two kWh counters are plain `unknown/decimal` values (unit in
// the name), never an `energy-sensor` index: nothing proves yet that they
// never go back nor jump (fiche, energy rules).
// -----------------------------------------------------------------------------

import {
  DEVICE_FEATURE_CATEGORIES as C,
  DEVICE_FEATURE_TYPES as T,
  DEVICE_FEATURE_UNITS as U,
} from '@gladysassistant/integration-sdk';
import { FEATURES as F, ROOM_SETPOINT } from './constants.js';
import { CONTROLS, VALUES } from './ctc.js';
import { DEVICE_NAME, ENUM_NAMES, FEATURE_NAMES, OPTION_NAMES, unknownCode, word } from './i18n.js';

const sensor = (definition) => ({
  read_only: true,
  has_feedback: false,
  keep_history: true,
  ...definition,
});
const probe = (min = -60, max = 150) =>
  sensor({
    category: C.TEMPERATURE_SENSOR,
    type: T.TEMPERATURE_SENSOR.PROBE,
    unit: U.CELSIUS,
    min,
    max,
  });
const room = sensor({
  category: C.TEMPERATURE_SENSOR,
  type: T.SENSOR.DECIMAL,
  unit: U.CELSIUS,
  min: -60,
  max: 150,
});
const text = sensor({ category: C.TEXT, type: T.TEXT.TEXT, min: 0, max: 0, keep_history: false });
const binary = sensor({ category: C.UNKNOWN, type: T.SENSOR.BINARY, min: 0, max: 1 });
const plain = (min, max) => sensor({ category: C.UNKNOWN, type: T.SENSOR.DECIMAL, min, max });
const select = {
  category: C.TEXT,
  type: T.TEXT.SELECT,
  min: 0,
  max: 0,
  read_only: false,
  has_feedback: true,
  keep_history: false,
};

/** The features, by role, in display order. */
const DEFINITIONS = {
  [F.HEATING_MODE]: select,
  [F.DHW_MODE]: select,
  [F.ROOM_SETPOINT]: {
    category: C.THERMOSTAT,
    type: T.THERMOSTAT.TARGET_TEMPERATURE,
    unit: U.CELSIUS,
    min: ROOM_SETPOINT.min,
    max: ROOM_SETPOINT.max,
    read_only: false,
    has_feedback: true,
    keep_history: true,
  },
  [F.OVERRIDES]: text,
  [F.SYSTEM_STATUS]: text,
  [F.HEATPUMP_STATUS]: text,
  [F.HEATING_STATUS]: text,
  [F.SMARTGRID]: text,
  [F.DHW_MODE_SETTING]: text,
  [F.HEATING_MODE_SETTING]: text,
  [F.COMPRESSOR]: binary,
  [F.DEFROST]: binary,
  [F.ALARM]: binary,
  [F.TEMP_OUTDOOR]: probe(),
  [F.TEMP_ROOM]: room,
  [F.TEMP_ROOM_2]: room,
  [F.ROOM_SETTING]: probe(0, 40),
  [F.TEMP_RADIATOR]: probe(),
  [F.FLOW_SETPOINT]: probe(0, 100),
  [F.TEMP_FLOW]: probe(),
  [F.TEMP_RETURN]: probe(),
  [F.TEMP_DHW]: probe(),
  [F.TEMP_DHW_LOWER]: probe(),
  [F.TANK_LOWER_SETPOINT]: probe(0, 100),
  [F.DHW_CAPACITY]: sensor({
    category: C.WATER_HEATER,
    type: T.WATER_HEATER.REMAINING_HOT_WATER,
    unit: U.PERCENT,
    min: 0,
    max: 100,
  }),
  [F.TEMP_HP_IN]: probe(),
  [F.TEMP_HP_OUT]: probe(),
  [F.TEMP_DISCHARGE]: probe(),
  [F.TEMP_SUCTION]: probe(),
  [F.TEMP_BRINE_IN]: probe(),
  [F.TEMP_BRINE_OUT]: probe(),
  [F.TEMP_HP_OUTDOOR]: probe(),
  [F.PRESSURE_HIGH]: sensor({
    category: C.PRESSURE_SENSOR,
    type: T.SENSOR.DECIMAL,
    unit: U.BAR,
    min: 0,
    max: 60,
  }),
  [F.PRESSURE_LOW]: sensor({
    category: C.PRESSURE_SENSOR,
    type: T.SENSOR.DECIMAL,
    unit: U.BAR,
    min: 0,
    max: 60,
  }),
  [F.COMPRESSOR_SPEED]: plain(0, 200),
  [F.CHARGE_PUMP]: plain(0, 100),
  [F.BRINE_PUMP]: plain(0, 100),
  [F.FAN]: plain(0, 100),
  [F.DEGREE_MINUTES]: plain(-5000, 5000),
  [F.IMMERSION_POWER]: sensor({
    category: C.ENERGY_SENSOR,
    type: T.ENERGY_SENSOR.POWER,
    unit: U.KILOWATT,
    min: 0,
    max: 100,
  }),
  [F.IMMERSION_POWER_LOWER]: sensor({
    category: C.ENERGY_SENSOR,
    type: T.ENERGY_SENSOR.POWER,
    unit: U.KILOWATT,
    min: 0,
    max: 100,
  }),
  [F.CURRENT_L1]: sensor({
    category: C.ENERGY_SENSOR,
    type: T.ENERGY_SENSOR.CURRENT,
    unit: U.AMPERE,
    min: 0,
    max: 200,
  }),
  [F.CURRENT_L2]: sensor({
    category: C.ENERGY_SENSOR,
    type: T.ENERGY_SENSOR.CURRENT,
    unit: U.AMPERE,
    min: 0,
    max: 200,
  }),
  [F.CURRENT_L3]: sensor({
    category: C.ENERGY_SENSOR,
    type: T.ENERGY_SENSOR.CURRENT,
    unit: U.AMPERE,
    min: 0,
    max: 200,
  }),
  [F.COMPRESSOR_HOURS]: plain(0, 10_000_000),
  [F.COMPRESSOR_MINUTES_24H]: plain(0, 1440),
  [F.IMMERSION_ENERGY]: plain(0, 65_534),
  [F.COMPRESSOR_ENERGY]: plain(0, 100_000_000),
};

export const ROLES = Object.keys(DEFINITIONS);
export const COMMAND_ROLES = [F.HEATING_MODE, F.DHW_MODE, F.ROOM_SETPOINT];
/** Always published: the commands and what Gladys holds. */
const ALWAYS = [...COMMAND_ROLES, F.OVERRIDES];
const FLAGS = [F.COMPRESSOR, F.DEFROST, F.ALARM];

/** The fields of a feature Gladys stores (what is kept of a created feature). */
const DECLARED = [
  'name',
  'external_id',
  'category',
  'type',
  'unit',
  'min',
  'max',
  'read_only',
  'has_feedback',
  'keep_history',
  'supported_options',
];

export const deviceIds = (gladys) => gladys.externalIds('heat-pump', 'ctc');

/** The role of one of our feature external ids, else undefined. */
export function parseFeatureId(gladys, externalId) {
  if (typeof externalId !== 'string') {
    return undefined;
  }
  const prefix = `${deviceIds(gladys).device}:`;
  if (!externalId.startsWith(prefix)) {
    return undefined;
  }
  const role = externalId.slice(prefix.length);
  return ROLES.includes(role) ? role : undefined;
}

/** The roles the values of one round report. */
export function reportedRoles(values) {
  return new Set(Object.keys(values).filter((role) => ROLES.includes(role)));
}

export function optionsOf(role, language) {
  return Object.keys(CONTROLS[role].options).map((key, index) => ({
    value: key,
    label: word(OPTION_NAMES[key], language),
    sort_order: index,
  }));
}

/**
 * The Gladys device. `roles`: those seen; `created`: the device already
 * created in Gladys, whose features are kept when the new build lacks them.
 */
export function buildDevice(gladys, { roles, identity, language, created }) {
  const ids = deviceIds(gladys);
  const params = [];
  if (identity) {
    params.push({ name: 'display_software', value: identity });
  }
  const built = {
    name: word(DEVICE_NAME, language),
    external_id: ids.device,
    model: 'CTC',
    should_poll: false,
    features: ROLES.filter((role) => ALWAYS.includes(role) || roles.has(role)).map((role) => ({
      name: word(FEATURE_NAMES[role], language),
      external_id: ids.feature(role),
      ...DEFINITIONS[role],
      ...(DEFINITIONS[role] === select ? { supported_options: optionsOf(role, language) } : {}),
    })),
    params,
  };
  return keepCreatedFeatures(built, created);
}

/** The features of the created device that the new build lacks, kept as they are. */
export function keepCreatedFeatures(built, created) {
  if (!created) {
    return built;
  }
  const have = new Set(built.features.map((f) => f.external_id));
  const kept = (created.features ?? [])
    .filter((f) => typeof f?.external_id === 'string' && !have.has(f.external_id))
    .map((f) =>
      Object.fromEntries(
        DECLARED.filter((k) => f[k] !== undefined && f[k] !== null).map((k) => [k, f[k]]),
      ),
    );
  return { ...built, features: [...built.features, ...kept] };
}

/** The text of a code read. */
export function enumText(role, value, language) {
  const names = ENUM_NAMES[VALUES[role].enum];
  return word(value.key ? names[value.key] : unknownCode(value.code), language);
}

/**
 * The states of one round: the values read (`values`, src/ctc.js decode)
 * and the commands (`controls`: `{ [role]: key | number }`, what Gladys
 * holds in force or the controller's own value), plus the hold text.
 */
export function deviceStates(ids, values, { controls, holdText, language }) {
  const states = [];
  for (const role of ROLES) {
    if (COMMAND_ROLES.includes(role) || role === F.OVERRIDES) {
      continue;
    }
    const value = values[role];
    if (value === undefined) {
      continue;
    }
    if (VALUES[role]?.enum) {
      states.push({ role, text: enumText(role, value, language) });
    } else if (FLAGS.includes(role) || Number.isFinite(value)) {
      states.push({ role, state: value });
    }
  }
  for (const [role, value] of Object.entries(controls ?? {})) {
    if (value === undefined) {
      continue;
    }
    states.push(typeof value === 'string' ? { role, text: value } : { role, state: value });
  }
  if (holdText) {
    states.push({ role: F.OVERRIDES, text: word(holdText, language) });
  }
  return states.map(({ role, ...value }) => ({
    device_feature_external_id: ids.feature(role),
    ...value,
  }));
}
