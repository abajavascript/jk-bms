# Product brief

This page watches one JK-BMS over Bluetooth and records what the battery is doing: pack voltage, current, power, state of charge, every cell voltage, temperatures, balancer and mosfet states. It is the JK counterpart of the [Atorch Energy Monitor page](https://github.com/abajavascript/atorch-s1wp) and keeps its layout, chart, link log, and log file flow.

How to open the page and use it is in the [README](../README.md). Why the page is built this way is in [adr.md](adr.md).

## User

One person near the battery, with Chrome or Edge on a computer, or Chrome on Android. The phone or computer stays in Bluetooth range for the whole session, which can last hours (a charge, a discharge, or a balancing check).

## In scope

- Connect to a BMS whose advertised name starts with `JK-` or `JK_` and show live readings.
- Ask the BMS for device info and cell info after every connect and reconnect. The BMS sends nothing until it is asked.
- Reassemble frames that arrive split across several notifications, and check each frame's checksum.
- Decode the JK02_32S layout (hardware version 11 and later). JK02_24S (hardware below 11) is selected from the device info and is marked unverified.
- Reconnect when the Bluetooth link drops, and say so in the link log.
- Show device info, live readings, and a per-cell grid with the lowest and highest cell highlighted.
- Plot readings over time with series that can be turned on and off.
- Write readings to a file the user chooses in the browser. Tab-separated is the default. A name ending in `.jsonl` is JSON lines.
- Show the latest raw frame of each type under Packet details, and decode a built-in sample frame without a device.

## Out of scope

- Any write to the BMS other than the two read requests: no settings, no switching mosfets, no balancer control, no calibration.
- JK04 (old firmware) frames, and the JK RS485/CAN wired protocols.
- Decoding the logbook frame (type `0x05`). It is shown as raw hex only.
- Energy accumulated since the start of a test (an Atorch-style **Zero accumulated** block). Planned once the matching JK app screen is known. The log already holds power, current, remaining capacity, and SOC, so it can be computed later.
- Log profiles (a minimal or custom column set). The only profile for now is "full".
- Accounts, a server, or uploading the log.
- iPhone and iPad. Those browsers have no Web Bluetooth.
- Restoring the chosen file after a reload.

## Requirements

1. **Connect** opens the Bluetooth chooser filtered to names starting with `JK-` or `JK_`. After the link is up, the page writes the device info request (`0x97`) and then the cell info request (`0x96`), without waiting for a write response. If no checksummed cell info frame has arrived, `0x96` is sent again every few seconds until one does.
2. A frame starts at each `55 AA EB 90` preamble. Once 300 bytes are collected, the byte sum of bytes 0..298 must equal byte 299. A frame that fails is counted as an error, shown in Packet details, and skipped; the link stays up. Bytes after 300 (frames can be 320 bytes) are ignored.
3. The Device section shows model, hardware version, software version, serial number, manufacturing date, power-on count, and BMS runtime.
4. Live readings show pack voltage (V), current (A, negative while discharging), power (W, voltage × current), SOC (%), remaining and full-charge capacity (Ah), cycle count, cycle capacity (Ah), SOH (%), cell delta (V), lowest and highest cell (V and number), mosfet temperature and T1..T5 (°C), balancer current and action, and the charge, discharge, precharge, and heating states.
5. The Cells section shows one tile per cell with its voltage and wire resistance. The cell count comes from the settings frame (`0x01`) when it has arrived, otherwise from the enabled-cell bitmask in the cell info frame. The lowest and highest cells are computed from the voltages and highlighted.
6. Temperatures that read exactly 0 on sensors T3..T5 are treated as absent and shown as `—`.
7. The chart starts with voltage, current, power, and SOC visible, each on its own scale. Cell delta, temperatures, and individual cell voltages are optional chips. A gap longer than 3 seconds breaks the line. Hovering a point shows the value, the elapsed time, and the clock time.
8. **Start logging** asks for a new file or an existing one. A name ending in `.jsonl` is a JSONL log; every other name is tab-separated. A new file gets that format's header. An empty existing file starts a new log. A file that already has this log's header for that format and the same cell count can be appended or overridden. Any other non-empty file can only be overridden or cancelled.
9. The store list is every reading, or one averaged row every 5 seconds, 10 seconds, 30 seconds, 1 minute, 5 minutes, or 10 minutes. Averaged rows use the mean of continuous values (voltages, current, power, temperatures, resistances, balancer and heating current) and the last sample's counters and states (SOC, capacities, cycles, SOH, mosfet states, balance action, errors, runtime).
10. Each finished row is written before the next one starts. Stopping the log, changing the store interval, or leaving the page writes a partial interval if one is open.
11. A dropped link reconnects on its own, sends both requests again, and keeps using the same file. Disconnect stops reconnecting. Closing the page disconnects and writes the last finished row.
12. **Decode sample packet** runs the built-in sample frames through the decoder and fills the page without a device and without logging.
13. Packet details shows the latest raw frame of each type in hex, the bytes that are not decoded, and whether the checksum passed.
14. Nothing horizontally scrolls at 360 px width.

## Log columns

Both formats carry the same fields ("full" profile):

- `timestamp`
- pack: `voltage_v`, `current_a`, `power_w`
- capacity: `soc_pct`, `remaining_ah`, `full_capacity_ah`, `cycles`, `cycle_capacity_ah`, `soh_pct`
- cell summary: `cell_avg_v`, `cell_delta_v`, `cell_min_v`, `cell_max_v`, `cell_min_idx`, `cell_max_idx`
- temperatures: `mos_temp_c`, `t1_c`, `t2_c`, `t3_c`, `t4_c`, `t5_c`
- balancer and mosfets: `balance_current_a`, `balance_action`, `charge_mos`, `discharge_mos`, `precharge`, `heating`, `heating_current_a`
- status: `errors_hex`, `runtime_s`
- per cell: `cell_01_v` .. `cell_NN_v`, then `res_01_ohm` .. `res_NN_ohm`

`NN` is the cell count, so the tab-separated header depends on the pack size. Cell indexes are 1-based. States are `0` or `1`. `balance_action` is `0` off, `1` charging balancer, `2` discharging balancer. An absent temperature is empty in a tab-separated file and `null` in JSONL.

Timestamps look like `2026-11-09 19:30:43 +02:00`.

A tab-separated file has one header line and one row per record. A JSONL file starts with `{"log":"jk-bms","version":1}`. Each later line is one JSON object with the same keys, except that cell voltages and resistances are arrays named `cells_v` and `res_ohm`. Numbers use the same precision as the tab-separated columns: 3 decimals for volts, amps, ohms, and amp-hours, 1 decimal for watts and °C.

## Done when

A charge or discharge can be watched live from the page, the readings match the JK app screen for the same moment, the page reconnects by itself after the BMS goes out of range and back, and the log file contains the readings from that run.
