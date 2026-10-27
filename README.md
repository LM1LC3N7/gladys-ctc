# gladys-ctc

A [Gladys Assistant](https://gladysassistant.com) external integration for
**CTC heat pumps** (EcoZenith i255/i360/i550, EcoHeat, EcoPart, and the EcoAir
they drive) over the local **Modbus TCP** interface of the display: about
fifty readings (temperatures, pressures, statuses, energy counters) and,
behind an off-by-default option, control through CTC's volatile registers.

Never tested with a real CTC. Not affiliated with CTC.

- Guide: [English](docs/en.md) · [Français](docs/fr.md)
- Register map: CTC's BMS manual 162 600 16-3 (2026-02-02); logic ported from
  [HA-CTC-Local-Easyconf](https://github.com/beolink/HA-CTC-Local-Easyconf)
  v0.29.0 (Apache-2.0), see [THIRD_PARTY_NOTICES.md](THIRD_PARTY_NOTICES.md).

## Safety

- Writes only to three registers of the volatile 1000 block (zone mode of
  heating circuit 1, hot water mode, room setpoint of circuit 1), which the
  controller forgets 5 minutes after the last write; the stored settings
  (EEPROM) are refused by the Modbus client itself.
- "Heating off" works without the option, is kept in `/data` and written
  again at start; every other command needs "Allow the commands".
- What Gladys holds ends after 24 hours, or as soon as the matching setting
  is changed at the panel.
- No hot water temperature is written.
- Modbus has no password: keep the heat pump on a trusted network.

## Development

```bash
npm install
npm test               # node --test (Node 22 and 24)
npm run lint
npm run format:check
npm run cover          # cover.png, plain Node
```

See [CLAUDE.md](CLAUDE.md) for the project rules and [TODO.md](TODO.md) for the
status and the decisions.

## License

[Apache-2.0](LICENSE).
