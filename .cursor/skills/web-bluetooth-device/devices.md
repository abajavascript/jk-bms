# Device notes

Treat anything marked "unverified" as a starting hypothesis. Confirm it against captured frames and the device screen before relying on it, then update this file.

## Atorch S1WP (AC energy meter) — verified

Source: the atorch-s1wp project (`js/protocol.js`).

- Name `S1WP_BLE`, service `0xFFE0`, notify characteristic `0xFFE1`. The meter sends readings unprompted, so no writes are needed.
- Frame: starts `FF 55`, at least 31 bytes, one frame per notification. Byte 2 `01` is the report message, byte 3 `01` is the AC meter type.
- Fields (big-endian):

| Offset | Bytes | Field | Scale |
|---|---|---|---|
| 4 | 3 | voltage | ×0.1 V |
| 7 | 3 | current | ×0.001 A |
| 10 | 3 | power | ×0.1 W |
| 13 | 4 | energy | ×0.01 kWh |
| 17 | 3 | price | raw |
| 20 | 2 | frequency | ×0.1 Hz |
| 22 | 2 | power factor | ×0.001 |
| 24 | 2 | temperature | °C |
| 26 | 2 + 1 + 1 | runtime | hours, minutes, seconds |
| 30 | 1 | standby | raw |

- Checksum not verified.
- Sample: `ff 55 01 01 00 08 4a 00 00 ce 00 00 90 00 00 11 1d 00 00 64 01 f4 01 49 00 20 01 4c 26 05 3c 00 00 00 00 7e`

## Atorch DL24 (DC electronic load) — unverified

- Expected to use the same Atorch family framing: `FF 55`, report message `01`, DC device type `02`, on `0xFFE0` / `0xFFE1`.
- DC field layout differs from S1WP (it has capacity in mAh and no frequency or power factor). Capture frames and map the offsets before decoding.
- Load control commands also start `FF 55` and carry a checksum. Out of scope for monitoring unless the product brief adds it.

## Atorch GR2PWS — unknown

- No protocol facts recorded yet. Follow "Adding a new device" in the skill and record the results here.

## JK BMS (JK02_32S) — verified

Sources: the jk-bms project (`js/protocol.js`), the esphome component by syssi, [`components/jk_bms_ble/jk_bms_ble.cpp`](https://github.com/syssi/esphome-jk-bms/blob/main/components/jk_bms_ble/jk_bms_ble.cpp), and frames captured on 2026-11-09 from `JK_B1A8S20P` (HW `11.XW`, SW `11.287`, made `231105`, 4 cells, 125 Ah nominal).

### Link

- Names start with `JK-` or `JK_`. Service `0xFFE0`, one characteristic `0xFFE1` for both notify and write.
- The BMS sends nothing until asked. In `onReady`, write `0x97` (device info), then `0x96` (cell info). Use write-without-response: the BMS does not send an ATT write response. After `0x96` it streams cell info frames and also sends the settings frame. If no checksummed cell-info frame has arrived, write `0x96` again every few seconds (esphome `update()`).
- `0x90` and `0x9A`, used by an early prototype, are not needed. `0xA1` requests the logbook.
- Request, 20 bytes: `AA 55 90 EB`, command, length, 4-byte value (little-endian), zeros, then byte 19 = byte sum of bytes 0..18 (& 0xFF). For a read request, length and value are 0.
  - `0x97`: `aa 55 90 eb 97 00 00 00 00 00 00 00 00 00 00 00 00 00 00 11`
  - `0x96`: `aa 55 90 eb 96 00 00 00 00 00 00 00 00 00 00 00 00 00 00 10`

### Frames

- Start `55 AA EB 90`. Byte 4 is the type (`0x01` settings, `0x02` cell info, `0x03` device info, `0x05` logbook), byte 5 a frame counter.
- 300 bytes, split across notifications (for example 128 + 128 + 44). Some firmware sends 320; the checksum is still at byte 299 and the rest is ignored.
- Framer: start a new buffer at every preamble, and once it holds 300 bytes or more, check that the byte sum of bytes 0..298 (& 0xFF) equals byte 299. All three captured frames pass.
- All multi-byte fields are little-endian.

### Layout selection

- JK02_32S (hardware major version 11 and later): cell area shifted by `o = 16`, every field from byte 112 on shifted by `O = 32`. Verified on the captured frames.
- JK02_24S (hardware below 11): `o = O = 0`, 24 cells, mosfet temperature at 134 and a 16-bit error mask at 136. Unverified.
- JK04 (old firmware, float cell values): not supported.
- esphome takes the layout from its YAML; the page reads the hardware version from the device info frame and assumes JK02_32S until it arrives.

### Cell info (`0x02`), JK02_32S

`o` = 16, `O` = 32. Value columns are from the captured frame.

| Offset | Bytes | Field | Scale | Captured |
|---|---|---|---|---|
| 6 + 2i | 2 | cell i voltage (i = 0..31) | ×0.001 V | 3.327, 3.328, 3.327, 3.327 |
| 54 + o | 4 | enabled cells bitmask | bits | `0f000000` (4 cells) |
| 58 + o | 2 | average cell voltage (BMS) | ×0.001 V | 3.327 |
| 60 + o | 2 | delta cell voltage (BMS) | ×0.001 V | 0.003 |
| 62 + o | 1 | max voltage cell index, 0-based (see notes) | raw | 0 |
| 63 + o | 1 | min voltage cell index, 0-based (see notes) | raw | 1 |
| 64 + o + 2i | 2 | cell i wire resistance | ×0.001 Ω | 0.051, 0.051, 0.052, 0.052 |
| 112 + O | 2 | mosfet temperature, signed | ×0.1 °C | 24.4 |
| 114 + O | 4 | wire resistance warning bitmask | bits | 0 |
| 118 + O | 4 | pack voltage | ×0.001 V | 13.309 |
| 122 + O | 4 | power, unsigned (not used) | ×0.001 W | 0 |
| 126 + O | 4 | current, signed, negative = discharge | ×0.001 A | 0 |
| 130 + O | 2 | T1, signed | ×0.1 °C | 21.0 |
| 132 + O | 2 | T2, signed | ×0.1 °C | 20.9 |
| 134 + O | 4 | errors bitmask | bits | 0 |
| 138 + O | 2 | balance current, signed | ×0.001 A | 0 |
| 140 + O | 1 | balance action: 0 off, 1 charging, 2 discharging | raw | 0 |
| 141 + O | 1 | SOC | % | 98 |
| 142 + O | 4 | remaining capacity | ×0.001 Ah | 112.633 |
| 146 + O | 4 | full charge capacity | ×0.001 Ah | 114.956 |
| 150 + O | 4 | cycle count | raw | 14 |
| 154 + O | 4 | total cycle capacity | ×0.001 Ah | 1628.894 |
| 158 + O | 1 | SOH | % | 92 |
| 159 + O | 1 | precharge | 0/1 | 0 |
| 162 + O | 4 | total runtime | s | 20206077 |
| 166 + O | 1 | charge mosfet | 0/1 | 1 |
| 167 + O | 1 | discharge mosfet | 0/1 | 1 |
| 168 + O | 1 | precharging | 0/1 | 0 |
| 182 + O | 1 | temperature sensor presence bitmask | bits | |
| 183 + O | 1 | heating | 0/1 | 0 |
| 204 + O | 2 | heating current, signed (see notes) | ×0.001 A | 7.2 |
| 222 + O | 2 | T5, signed | ×0.1 °C | 24.4 |
| 224 + O | 2 | T4, signed | ×0.1 °C | 0 |
| 226 + O | 2 | T3, signed | ×0.1 °C | 0 |
| 243 + O | 1 | battery type: 0 LFP, 1 Li-ion, 2 LTO | raw | 0 |
| 248 + O | 1 | charge status: 0 bulk, 1 absorption, 2 float | raw | 0 |
| 299 | 1 | checksum | | |

Notes:

- Compute power as voltage × current; the field at 122 + O is unsigned.
- Compute min, max, average, and delta from the cell voltages. The BMS index bytes at 62/63 + o did not match the voltages on the captured frame (the highest cell was cell 2, index 1), so their meaning is unverified.
- Take the cell count from the settings frame, falling back to the enabled bitmask. Do not stop at the first zero voltage: a broken sense wire reads 0 V.
- T3..T5 read 0 when the input is unused; show them as absent. On the captured 4-cell BMS, T5 equals the mosfet temperature.
- Heating current read 7.2 A with heating off on the captured BMS, which has no heater. Treat the field as unverified.

### Settings (`0x01`)

| Offset | Bytes | Field | Scale | Captured |
|---|---|---|---|---|
| 10 | 4 | cell UVP | ×0.001 V | 2.800 |
| 18 | 4 | cell OVP | ×0.001 V | 3.500 |
| 50 | 4 | max charge current | ×0.001 A | |
| 62 | 4 | max discharge current | ×0.001 A | |
| 114 | 4 | cell count | raw | 4 |
| 130 | 4 | nominal capacity | ×0.001 Ah | 125.000 |
| 138 | 4 | start balance voltage | ×0.001 V | 3.350 |

The full settings layout is in `decode_jk02_settings_` in the esphome source. The page reads only the cell count and the nominal capacity.

### Device info (`0x03`)

ASCII strings end at the first `00`.

| Offset | Bytes | Field | Captured |
|---|---|---|---|
| 6 | 16 | model (vendor ID) | `JK_B1A8S20P` |
| 22 | 8 | hardware version | `11.XW` |
| 30 | 8 | software version | `11.287` |
| 38 | 4 | uptime, s | 20205900 |
| 42 | 4 | power-on count | 41 |
| 46 | 16 | device name | `JK_B1A8S20P` |
| 78 | 6 | manufacturing date `YYMMDD` | `231105` |
| 86 | 11 | serial number, shown on the Device section, not used in readings | placeholder `0000000000` in the sample |
| 102 | 16 | user data | `Input Userdata` |

Bytes 78..85 are the manufacturing date, not a protocol version. Bytes 62, 97 and 118 are device and setup passcodes. They are not decoded, not displayed, and not used in readings, so they are left out of this table. The sample frame below has vendor defaults in those bytes and a placeholder serial, with the checksum recomputed. Do not commit a raw device info frame from a real BMS.

### Samples

Captured from `JK_B1A8S20P`; each is 300 bytes and passes the checksum. The device info sample has its passcode and serial bytes replaced (see above), so its checksum is different from the capture's.

- Settings (`0x01`): `55aaeb90017a58020000f00a0000860b0000ac0d00007a0d00000a000000ac0d0000f00a00000000000000000000280a000060ea00001e0000003c000000400d03002c0100003c0000003c000000e8030000bc02000058020000bc02000058020000140000001e000000e8030000200300000400000001000000010000000100000048e80100dc050000160d000000000000000000000000000000000000000000000000000000000000000000000000000000000000000000000000000000000000000000000000000000000000000000000000000000000000000000000000000000000000000000000000000000000000000000000000000000000000000000000000000000000000000000000000000000000000000b0710b0000003c3200fcf9ffff1f2d00000000000012`
- Cell info (`0x02`): `55aaeb90027aff0c000dff0cff0c00000000000000000000000000000000000000000000000000000000000000000000000000000000000000000000000000000000000000000f000000ff0c0300000133003300340034000000000000000000000000000000000000000000000000000000000000000000000000000000000000000000000000000000000000000000f40000000000fd3300000000000000000000d200d1000000000000000062f9b701000cc101000e000000deda18005c000000fd51340101010000000000000000000000000000ff00010000003a03000000009e4a4240000000003205201c00010001bb0500009ceb270000000000f40000000000000000000000000000000000000000000000000000000000000000feff7fdc0f010000000000005d`
- Device info (`0x03`): `55aaeb90037a4a4b5f4231413853323050000000000031312e585700000031312e32383700004c513401290000004a4b5f4231413853323050000000000031323334000000000000000000000000323331313035000030303030303030303030003132333400496e707574205573657264617461000031323334353600000000000000000000496e7075742055736572646174610000fcf9ffff1f2d000000000000900f00000000c0d8030000000001000000000000000000000000000000000000000000000000000000000000000000000000000000000000000000000000000000000000000000000000000000000000000000000000000000000000000000000000000000000000000000000000000000000000000000000000000000fe2f000000000000000000007a`
