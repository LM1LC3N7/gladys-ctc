# Changelog

All notable changes to this integration are documented in this file. The format
follows [Keep a Changelog](https://keepachangelog.com/en/1.1.0/) and the project
uses [semantic versioning](https://semver.org/).

Describe each change under `## [Unreleased]` as you make it. The Release
workflow moves that section under the version it ships, and the section becomes
the notes of the version's GitHub Release.

## [Unreleased]

### Added

- First version: CTC heat pumps over local Modbus TCP (BMS interface of the
  display): temperatures, pressures, statuses, compressor, defrost and alarm
  flags, energy counters as plain values.
- Control through the volatile 1000 block, written again every minute:
  heating circuit 1 mode, hot water mode, room setpoint of circuit 1, behind
  "Allow the commands" (off by default); "Heating off" always available,
  kept in `/data` and written again at start.
- "Test the connection" and "Give control back to the heat pump" buttons.
- A setpoint or mode held by Gladys ends after 24 hours or when the setting
  is changed at the panel; the heating off ends only by a click with the
  option, the panel (two readings in a row) or removing the address; the
  configuration is read again until Gladys answers.
