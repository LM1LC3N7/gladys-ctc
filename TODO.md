# TODO — CTC v1

Handoff document: what is done, what was decided, what comes next. Keep it
up to date at the end of every milestone.

## Status

- [x] **Milestone 1 — core** (2026-10-27): Modbus TCP read of one CTC
      controller (about fifty values), one device, three commands on the
      volatile 1000 block behind `allow_commands` (off), the heating off
      always available and kept in /data, keepalive, buttons, docs en/fr,
      cover. Tested against a fake controller and a loopback server only.
- [ ] **Milestone 2 — real CTC**: run against a real unit (see "To check").
- [ ] **Milestone 3 — more**: hot water setpoint (1033) once its scale is
      known, circuits 2 to 4, cooling, immersion heater and compressor
      limits, SmartGrid virtual inputs, alarm codes (65133, 65010–65069),
      an energy index with the approved guard of gladys-p1-monitor.

## To check on a real CTC

- The scale of 1010 (room setpoint, tenths as the reference writes it):
  the manual gives none for the 1000 block. Same question for 1033 before
  adding the hot water setpoint.
- Whether zone mode Off (1015 = 0) keeps the frost protection.
- The layout of 62244/62245 (display software "month day" and "year"):
  used as an identity, compared as read.
- Whether the controller keeps the TCP connection open between rounds and
  answers a read sent right after a silent one (the reference does it).
- The codes of 62005 (manual 2026: 7 = Off, 11 = Cooling; the reference
  had an older list) and of 62017 beyond 7.
- Whether the effect of 1015/1007/1010 shows in 62246, 62005, 62007.

## Decisions

- **Version 0.1.0 set by hand** in `package.json`, `package-lock.json`,
  the manifest and the `docker_image` tag
  (`ghcr.io/lm1lc3n7/gladys-ctc:0.1.0`); the first patch release gives
  0.1.1. `test/manifest.test.js` checks the four agree, never a number.
- **SDK 0.16.0** (latest on npm on 2026-10-27, as the template).
- **Reference**: HA-CTC-Local-Easyconf v0.29.0 (Apache-2.0, Andreas
  Reimers, commit 07eb108), cloned read only in `~/code/ref/lot17/ctc`.
  Registers checked against **CTC's BMS manual 162 600 16-3 (CR01143,
  2026-02-02)**, fetched from ctc.se: function 3 to read, 16 to write,
  offset 0, 100 registers per transmission; the 1000 block "W", "Value
  shall be updated before 5 minutes", reset at a restart. Where the
  reference and the manual differ (62005 codes), the manual is followed.
  Notice in `THIRD_PARTY_NOTICES.md`, shipped in the image with `LICENSE`.
- **Only the Modbus side**: the reference also reads the display's web
  interface, which moves the physical panel and answers anyone without a
  login; left out.
- **Own Modbus client, no dependency** (as gladys-stiebel-eltron): the
  rules (one request at a time, answers attributed by transaction id,
  silence kept apart from a lost line, the CTC pace, a write refused
  outside three addresses before anything) are easier to hold in ~400
  lines on `node:net` than around an npm client.
- **Silence**: a read without answer keeps the connection (as the
  reference on real units with pymodbus 3.8+); its transaction id is
  remembered (4 at most, then the line is dropped) and a late answer is
  dropped. A write without answer, or half a frame, drops the line.
- **Blocks**: exactly those the reference reads; 62000 (the probe) first; a
  round fails when the probe block is silent with nothing answered, or on
  a line error; a block silent 3 rounds in a row while others answer is
  left out until a restart (reference `MissingBlocks`).
- **Values**: markers ±9999, ±10000, 32767, -32768 and a pair of all ones
  are "no sensor"; every value has a plausible range; unknown values are
  never published. Energy counters are `unknown/decimal`, never an index.
- **One controller per integration**, device `ext:ctc:heat-pump:ctc`:
  Modbus gives no serial nor MAC. The identity checked before a command is
  the display software version (62244/62245), compared as read.
- **Commands**: zone mode HC1 (1015: off 0, heat 1, auto 3; cool and "on"
  left out), hot water mode (1007: 0, 1, 2), room setpoint HC1 (1010,
  tenths, 10–30 °C). `program` gives control back and writes nothing.
  **No hot water setpoint** (1033): its scale is not in the manual; a
  wrong factor could set the water above 60 °C. So no hot water ceiling in
  the configuration: no hot water temperature is ever written.
- **Heating off** = the protective command (fiche): independent of the
  option, the identity, the first round, a read in flight (cut after 1 s
  of silence, not counted as a failure), the backoff, /data. Kept in
  /data with its address; `index.js` calls `app.resume()` before
  `connect()`, so it is written at start without getConfig nor a read; a
  future date in /data is replaced by now (the date decides nothing).
  Written again every minute, every 15 s until acknowledged; never dropped
  by the 5-minute expiry. A new address moves it (the same pump renumbered
  or a wrong old address; never dropped). Given back (a restart of the
  heating) only with the option, /data written first.
- **Ordering**: a heating off moves `stopSeq`; a command that captured an
  older one is cancelled in `beforeSend` ("nothing asked before a stop
  leaves after it"); a newer heating mode removes the stop only from its
  `beforeSend`, i.e. once its bytes leave. Heating modes are refused while
  the stop write is in flight. Commands queue on the Modbus gate (a scene
  setting three features is written in full, in click order); a newer
  click of the same feature cancels an older one that has not left, and
  an older one acknowledged late never takes the hold back.
- **Holds**: in force only from an acknowledged write, for 5 minutes;
  written again every minute after a fresh identity read; dropped after 5
  minutes without acknowledgement (never taken up again), on an identity
  change, when the option is turned off, on a refusal. Never replayed
  after a restart (not in /data).
- **Confirmation**: the 1000 block is write only (manual): the echo of the
  controller is the acknowledgement; a write without it is "sent, without
  acknowledgement" (held, not in force, written again); exceptions 1, 2, 3,
  6, 10 are refusals.
- **Polling**: 30 s by default, 10 s – 10 min, period counted from the
  start of the round on the monotonic clock; failures 30 s, 1, 2, 5 min,
  never shorter than the interval; the test button never reads sooner
  than the interval. No 429 nor pause on Modbus.
- **Reconnection to Gladys**: status, Discovery, states and badge again,
  nothing read.
- **gladys_version >= 5.1.0**; **categories `climate`, `energy`**,
  transport `local`; no `keywords`/`countries` (to add with the store
  fields: keywords "CTC EcoZenith EcoAir EcoPart heat pump Modbus",
  countries SE, NO, FI, DE).
- **Template demo files** (devices, scenes, widgets, weather and their
  tests) removed.
- **Not checked here**: duplicates in the store and the forum (checked
  when the lot was proposed); `gi install` in the sandbox (no CTC to talk
  to: the status only says it does not answer).
