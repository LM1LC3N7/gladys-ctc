// -----------------------------------------------------------------------------
// Constants: Modbus, manifest keys, feature roles, limits and timings.
//
// A CTC controller (EcoZenith i255/i360/i550, EcoHeat, EcoPart, EcoLogic...)
// answers Modbus TCP on port 502 once "Modbus TCP" is chosen on its display
// (Installer > Define > Remote control > Ethernet). The register map comes
// from CTC's BMS manual 162 600 16-3 (2026-02-02) and lives in src/ctc.js.
// -----------------------------------------------------------------------------

export const DEFAULT_PORT = 502;
/** The Modbus unit (slave) id of the controller (CTC's default, as the reference). */
export const UNIT_ID = 1;

/** Feature roles (the last part of the feature external ids): frozen. */
export const FEATURES = {
  // Commands.
  HEATING_MODE: 'heating-mode',
  DHW_MODE: 'dhw-mode',
  ROOM_SETPOINT: 'room-setpoint',
  OVERRIDES: 'overrides',
  // Texts.
  SYSTEM_STATUS: 'system-status',
  HEATPUMP_STATUS: 'heatpump-status',
  HEATING_STATUS: 'heating-status',
  SMARTGRID: 'smartgrid-mode',
  DHW_MODE_SETTING: 'dhw-mode-setting',
  HEATING_MODE_SETTING: 'heating-mode-setting',
  // Flags derived from the heat pump status.
  COMPRESSOR: 'compressor',
  DEFROST: 'defrost',
  ALARM: 'alarm',
  // Temperatures.
  TEMP_OUTDOOR: 'temperature-outdoor',
  TEMP_RADIATOR: 'temperature-radiator',
  FLOW_SETPOINT: 'flow-setpoint',
  TEMP_FLOW: 'temperature-flow',
  TEMP_RETURN: 'temperature-return',
  TEMP_HP_IN: 'temperature-hp-in',
  TEMP_HP_OUT: 'temperature-hp-out',
  TEMP_DISCHARGE: 'temperature-discharge',
  TEMP_SUCTION: 'temperature-suction',
  TEMP_BRINE_IN: 'temperature-brine-in',
  TEMP_BRINE_OUT: 'temperature-brine-out',
  TEMP_HP_OUTDOOR: 'temperature-hp-outdoor',
  TEMP_ROOM: 'temperature-room',
  TEMP_ROOM_2: 'temperature-room-2',
  TANK_LOWER_SETPOINT: 'tank-lower-setpoint',
  TEMP_DHW_LOWER: 'temperature-dhw-lower',
  TEMP_DHW: 'temperature-dhw',
  ROOM_SETTING: 'room-setting',
  // Other values.
  PRESSURE_HIGH: 'pressure-high',
  PRESSURE_LOW: 'pressure-low',
  CHARGE_PUMP: 'charge-pump',
  BRINE_PUMP: 'brine-pump',
  FAN: 'fan',
  DEGREE_MINUTES: 'degree-minutes',
  IMMERSION_POWER: 'immersion-power',
  IMMERSION_POWER_LOWER: 'immersion-power-lower',
  CURRENT_L1: 'current-l1',
  CURRENT_L2: 'current-l2',
  CURRENT_L3: 'current-l3',
  IMMERSION_ENERGY: 'immersion-energy',
  COMPRESSOR_SPEED: 'compressor-speed',
  COMPRESSOR_HOURS: 'compressor-hours',
  COMPRESSOR_MINUTES_24H: 'compressor-minutes-24h',
  DHW_CAPACITY: 'dhw-capacity',
  COMPRESSOR_ENERGY: 'compressor-energy',
};

export const ACTIONS = {
  TEST_CONNECTION: 'test_connection',
  RELEASE_OVERRIDES: 'release_overrides',
};

/** The poll interval of the configuration, in seconds (the reference: 30 s). */
export const POLL_INTERVAL = {
  min: 10,
  max: 600,
  default: 30,
};

/** The room setpoint the commands may hold (heating circuit 1), in °C. */
export const ROOM_SETPOINT = { min: 10, max: 30 };

export const LIMITS = {
  /** Gladys: 300 states per minute. */
  statesPerMinute: 300,
  statesPerRequest: 100,
  /** Modbus TCP: 7 bytes of MBAP header + a PDU of 253 bytes at most. */
  frameBytes: 260,
  /** CTC: at most 100 registers per transmission (BMS manual). */
  registersPerRead: 100,
  /** Requests abandoned (silence) whose late answer is still recognised and dropped. */
  abandoned: 4,
  /** A block silent this many rounds in a row, while others answer, is left out. */
  missingPatience: 3,
};

export const SECOND = 1_000;
export const MINUTE = 60 * SECOND;
export const HOUR = 60 * MINUTE;

export const TIMINGS = {
  /** Opening the TCP connection. */
  connectTimeout: 3 * SECOND,
  /**
   * The controller needs a moment after the socket opens before it answers,
   * and after a close before it gives its single client slot back (the
   * reference, on real units: 3 s and 10 s).
   */
  connectDelay: 3 * SECOND,
  closeSettle: 10 * SECOND,
  /** Shortest gap between two transactions (the reference: 60 ms). */
  messageGap: 60,
  /** A read without answer: silence, how CTC says a register is missing. */
  readTimeout: 5 * SECOND,
  /** A heating stop cuts a read that has received nothing for this long. */
  cutAfter: SECOND,
  /** While a stop waits, the read in flight is looked at this often. */
  cutCheck: 200,
  /** Failed polls: 30 s, 1, 2, then 5 minutes, never shorter than the interval. */
  backoff: [30 * SECOND, MINUTE, 2 * MINUTE, 5 * MINUTE],
  /** The publisher sends what is pending every second; unchanged states again every 30 min. */
  flushInterval: SECOND,
  stateHeartbeat: 30 * MINUTE,
  /** The "Test the connection" button reads the controller at most this often. */
  testCooldown: 10 * SECOND,
  /**
   * Commands (Gladys waits 5 s for the ack): the identity read and the
   * write must leave by 3.5 s after the click, or the command is refused
   * unsent; the answer is awaited until 4.3 s, after which the command is
   * "sent, without confirmation".
   */
  commandSendBy: 3_500,
  commandAnswerBy: 4_300,
  commandReadMax: 2_000,
  commandMinRead: 300,
  /** The ack of a heating stop is given by then, whatever the write does. */
  stopAckBy: 3_500,
  /**
   * The 1000 block is volatile: the controller forgets a value 5 minutes
   * after the last write (BMS manual). Held values are written again every
   * minute; a heating stop not written for a minute is retried every 15 s.
   */
  keepalive: MINUTE,
  stopRetry: 15 * SECOND,
  expiry: 5 * MINUTE,
};
