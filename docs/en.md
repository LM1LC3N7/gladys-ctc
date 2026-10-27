# CTC heat pumps in Gladys

This integration shows a CTC heat pump (EcoZenith i255, i360 or i550, EcoHeat,
EcoPart, and the EcoAir they drive) in Gladys, over the **Modbus TCP**
interface of its display, on your local network, without any cloud.

Never tested with a real CTC: it follows CTC's BMS manual (162 600 16-3,
2026-02-02) and the HA-CTC-Local-Easyconf integration for Home Assistant,
which runs on real units. Not affiliated with CTC.

## Before you start

1. A display with **3 ports** (the manual: only those talk Modbus over TCP/IP).
2. On the display: **Installer** (Advanced), **Define**, **Remote control**,
   set **Ethernet** to **Modbus TCP**. This is reported to exclude the
   myUplink cloud connection.
3. Give the display a fixed address in your router.
4. The controller serves **one Modbus client** at a time: remove any other
   one (Home Assistant, a script), or both will fail.
5. Modbus has no password: anyone who reaches port 502 can read the
   registers and write the control ones. Keep the heat pump on a **trusted
   network** (a VLAN, or a firewall rule letting only Gladys reach it), and
   never open port 502 to the internet.

## Configuration

| Field                         | What it does                                                                       |
| ----------------------------- | ---------------------------------------------------------------------------------- |
| IP address of the CTC display | An IPv4 address or a host name, port 502 unless you add one (`192.168.1.80:5020`). |
| Allow the commands            | Off by default. See "Control" below.                                               |
| Refresh interval              | 30 s by default, from 10 to 600 s.                                                 |
| Language                      | Names of the device and features added from now on, state texts, errors.           |

Save, then add the heat pump from the **Discovery** tab.

The **Test the connection** button reads the controller, at most once per
refresh interval, and shows its state.

## What you get

Temperatures (outdoor, flow and its setpoint, return, radiator water, heat
pump in and out, discharge and suction gas, brine, hot water upper and
lower, room 1 and 2), high and low pressure, compressor speed, charge pump,
brine pump and fan (%), degree minutes, immersion heater power, phase
currents, hot water capacity, compressor operating time and its last 24 h,
the immersion heater and compressor energy counters (kWh, plain values),
the system, heat pump, heating circuit 1 and SmartGrid statuses, and the
stored hot water mode, room setting and heating mode of circuit 1, read
only. Compressor running, defrosting and "stopped by an alarm" are derived
from the heat pump status.

A value appears once its register answered with a number. CTC answers
"no sensor" with markers (9999, 32767...) and stays silent for a register
the model lacks: such a block is left out after three silent rounds, until
the integration restarts, and the configuration screen lists it.

The energy counters are plain values, not an energy index: nothing proves
yet that they never go back nor jump.

## Control

Gladys writes only to CTC's **volatile control registers** (the 1000 block),
never to the stored settings, whose memory tolerates a limited number of
writes; the code refuses any other address before anything is sent. The
controller forgets a control value **5 minutes** after the last write and at
its own restart, so Gladys writes what it holds again every minute. If the
integration stops, the heat pump goes back to its own settings within 5
minutes.

Three commands:

- **Heating circuit 1 mode**: _Controller's own program_ (gives control
  back, writes nothing), _Heating off_, _Heating_, _Auto_.
- **Hot water mode**: _Controller's own program_, _Economy_, _Normal_,
  _Comfort_. The temperatures of these modes are the controller's own
  settings: Gladys writes no hot water temperature.
- **Room setpoint, circuit 1**: 10 to 30 °C, in tenths of a degree.

When nothing is in force (nothing held, or a hold the controller no longer
acknowledges), the commands show what the controller follows: its own
program, its own room setting. The feature **Control held by Gladys** says
what is held and since when, what is asked but not in force, and the last
hold that ended.

### How a hold ends

What Gladys holds (the heating off included) ends:

- **at the panel**: change the matching setting on the display (heating
  mode of circuit 1 for the circuit mode and the heating off, room setting
  of circuit 1, hot water mode). Gladys notes these settings after the
  controller acknowledged its value and gives the hold back as soon as one
  of them changes (a setting it cannot read gives nothing back);
- **after 24 hours**, by itself;
- with _Controller's own program_ or the button **Give control back to the
  heat pump** (for the heating off: only with "Allow the commands");
- when "Allow the commands" is turned off (not the heating off), when the
  display software version changes, or when the controller refuses a value
  (not the heating off);
- in the last resort, by setting Ethernet back to anything but Modbus TCP
  on the display, or stopping the integration: the controller forgets
  within 5 minutes.

Whether the panel or the 1000 block wins while Gladys holds a value is not
known (never tested with a real CTC).

### Heating off

_Heating off_ (zone mode of circuit 1 = Off) is the protective command. It
works **even when "Allow the commands" is off**, while the controller has
not been read yet, after a failed round and when `/data` cannot be written.
It never waits behind the queued reads: it waits only for the Modbus
request in flight to end (its answer, or 5 s of silence: CTC answers one
request at a time), then leaves first.

It is refused only when no controller address is known: none in the
configuration and none kept in `/data` (the address of the stop, or the
last address where a CTC was identified). Before the configuration has
been read from Gladys (it is read again every 5 s, doubled up to 5
minutes, while Gladys does not answer), it waits for it up to 2.5 s, then
uses the address kept in `/data`.

It is kept in `/data` with its address and its date: after a restart of
the integration it is written again at once, before the configuration is
even read, unless it is older than 24 hours. When the configuration gives
a new address, it is written there only once a round has identified a CTC
at that address.

When the controller does not acknowledge it within 3.5 s, Gladys answers
that it is recorded and not yet acknowledged; when the controller refuses
it (Modbus exception 1, 2 or 3), Gladys says so. In both cases it is kept
and tried again: after 15 s, then twice as long each time, up to 5 minutes
(30 minutes after a refusal). Once acknowledged, it is written again every
minute.

A newer mode (_Heating_, _Auto_) replaces it once its write has left;
`/data` is written before that. If the controller refuses the newer mode,
the heating off stays. A command asked before the heating off and not
sent yet is cancelled.

Whether CTC keeps its frost protection with the zone mode Off is not known:
check it on your installation before relying on it in winter.

### The other commands

They need **Allow the commands**. Before each write, Gladys reads the
display software version again in the same Modbus session and refuses when
it is missing or not the one read before (another controller at that
address). The write must leave within 3.5 s of the click or it is not sent.
Several commands at once (a scene) are written one after the other, in
order; a newer click of the same feature replaces an older one not sent
yet. A write the controller acknowledges is held; one without an answer is
reported "sent, without acknowledgement" and written again within the
minute; a write refused by the controller is not held. None of them is
written again after a restart of the integration: the controller forgets
them within 5 minutes.

The control registers cannot be read back (the manual: write only): the
acknowledgement of the controller is the confirmation Gladys can give. The
statuses (heating circuit 1, heat pump) show the effect.

## Not done (yet)

The hot water setpoint (register 1033: the manual gives no scale for the
1000 block, a wrong guess could overheat the water), the heating circuits 2
to 4, cooling, the immersion heater and compressor limits, the SmartGrid
inputs, the alarm codes (65xxx), the display's web interface.
