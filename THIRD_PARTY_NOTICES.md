# Third-party notices

This integration is released under the Apache License 2.0 (`LICENSE`). It
contains logic ported from the project below.

## HA-CTC-Local-Easyconf

- Source: https://github.com/beolink/HA-CTC-Local-Easyconf
- Version read: v0.29.0 (commit 07eb108, 2026-10-26)
- Copyright 2026 Andreas Reimers
- License: Apache License, Version 2.0

Ported to JavaScript, adapted, in `src/ctc.js` and `src/modbus/client.js`:
the Modbus blocks read in one round and the probe register read first, the
"no sensor" markers of CTC (±9999, ±10000, 32767, -32768, a pair of all
ones), the unsigned one-word immersion heater counter, the silence of a
missing register and the blocks left out after three silent rounds, the
pace of the controller (60 ms between transactions, 3 s after connecting,
10 s after a close), the five-minute expiry of the volatile 1000 block with
a write every minute, and the hard refusal to write anything but the
control registers. The register addresses, scales and codes are checked
against CTC's BMS manual 162 600 16-3 (2026-02-02); where they differ (the
codes of register 62005), the manual is followed.

```
                                 Apache License
                           Version 2.0, January 2004
                        http://www.apache.org/licenses/

   Licensed under the Apache License, Version 2.0 (the "License");
   you may not use this file except in compliance with the License.
   You may obtain a copy of the License at

       http://www.apache.org/licenses/LICENSE-2.0

   Unless required by applicable law or agreed to in writing, software
   distributed under the License is distributed on an "AS IS" BASIS,
   WITHOUT WARRANTIES OR CONDITIONS OF ANY KIND, either express or implied.
   See the License for the specific language governing permissions and
   limitations under the License.
```

The full text of the Apache License 2.0 is in `LICENSE`.

## gladys-testkit (tests only)

`test/kit/` is copied from `gladys-testkit` (Apache-2.0, same author as this
integration); it is not part of the image.
