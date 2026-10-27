# CLAUDE.md

Project rules for coding assistants (Claude Code reads this file) and for
human contributors. Read **[TODO.md](./TODO.md) first**: status, decisions
already taken and the next milestones.

## What this is

A Gladys Assistant **external integration** of type `device`: a Node.js
service (Node 22+, ESM, no build step) in its own sandboxed Docker container,
talking to Gladys through `@gladysassistant/integration-sdk` (v0.16), its only
runtime dependency (Modbus TCP goes through our own client on `node:net`).
It reads a CTC heat pump through the Modbus TCP (BMS) interface of its
display and shows it as one Gladys device; three commands write CTC's
volatile 1000 block. Never tested with a real CTC, not affiliated with CTC.

## Commands

```bash
npm install
npm test                                  # node --test, the built-in runner
npm run lint                              # ESLint
npm run format:check                      # Prettier, as the CI runs it
npm run audit                             # npm audit --omit=dev
npm run cover                             # cover.png (800x534), plain Node
```

## Architecture

```
index.js                  SDK bootstrap; app.resume() before connect (heating off from /data)
src/handlers.js           every SDK handler -> the app (shared with the tests)
src/app.js                CtcApp: rounds, device, states, badge, status, buttons,
                          commands, holds and keepalive, the heating off
src/ctc.js                register map, blocks, decoding, writable registers (BMS manual)
src/modbus/client.js      Modbus TCP client (functions 3, 16), the Gate and its levels
src/devices.js            -> the Gladys device and its states (pure)
src/publisher.js          states within 300/min
src/store.js              /data: the heating off and its address only
src/config.js             config_schema normalized
src/constants.js          feature roles, limits, timings
src/i18n.js               runtime texts (en/fr)
test/fixtures/fakeCtc.js  the fake controller behind the socket factory
test/kit/                 copied from gladys-testkit (clocks, loopback TCP server)
```

## Rules

- **External ids are forever**: device `ext:ctc:heat-pump:ctc`, features
  named by the roles of `src/constants.js` FEATURES. A republished device
  never loses a feature.
- Manifest keys (`address`, `allow_commands`, `poll_interval`, `language`,
  the actions `test_connection`, `release_overrides`) are frozen.
- **Writes**: only `WRITABLE` of `src/ctc.js` (1007, 1010, 1015), refused
  in the client before anything else. Never the 615xx stored settings.
- **Modbus**: one client, one connection, one request at a time; every
  answer matched to its request; silence keeps the line (late answers
  dropped by transaction id); 60 ms between transactions, 3 s after a
  connection, 10 s after a close.
- **Heating off** (1015 = 0): never refused for the option, the identity,
  a read in flight (cut after 1 s of silence), a busy line or /data; kept
  in /data with its address, written at start before getConfig, every
  minute, every 15 s until acknowledged; given back only with the option.
- **Other commands**: `allow_commands`; identity (display software version)
  read again in the same session; sent within 3.5 s or not sent; cancelled
  by a heating off asked meanwhile; never replayed after a restart.
- **Never** a switch or a writable binary. No hot water temperature written.
- Clocks: `monotonic` for every deadline and hold; `now` only for /data.
- Units only from the core's `DEVICE_FEATURE_UNITS_BY_CATEGORY`.
- Files are UTF-8 without BOM (`test/encoding.test.js`).
- Code, comments, README in English; `docs/en.md` and `docs/fr.md` in sync.
- Every user-visible change adds a line under `## [Unreleased]` in
  `CHANGELOG.md`; versions belong to the Release workflow.
