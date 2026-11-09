# Architecture decisions

Short notes for a single static page. The product behavior is in [prd.md](prd.md). Byte offsets and sample values are in [devices.md](../.cursor/skills/web-bluetooth-device/devices.md).

## 1. Static page, no backend

The page is HTML, CSS, and JavaScript ES modules with no build step, served by GitHub Pages. It repeats the structure of [atorch-s1wp](https://github.com/abajavascript/atorch-s1wp) so the two tools look and behave the same and share modules (`ble.js`, `log.js`, `dialogs.js`, the chart setup). Bluetooth and the file picker need HTTPS or localhost, so opening the HTML file from disk is not a supported way to run it.

## 2. Web Bluetooth with request commands

JK-BMS units advertise names starting with `JK-` or `JK_` and use service `0xFFE0` with one characteristic, `0xFFE1`, for both notify and write. Unlike the Atorch meter, the BMS sends nothing until asked. A request is 20 bytes: `AA 55 90 EB`, the command, a length byte, a 4-byte little-endian value, zeros, and a last byte that is the byte sum of bytes 0..18.

On every connect and reconnect the profile's `onReady` writes `0x97` (device info) and then `0x96` (cell info), using write-without-response. The BMS does not send an ATT write response, so a write-with-response would wait until the step timed out. After `0x96` the BMS streams cell info frames by itself, and it also sends the settings frame. If no checksummed cell-info frame has arrived, `0x96` is written again every few seconds. This is what the esphome component does in `update()`, and it covers a BMS that ignored the first request while it was waking up.

The Python prototype also wrote `0x90` and `0x9A`. Neither is needed: the BMS answers `0x97` and `0x96` alone, and `0x9A` is not a documented read command. The page writes nothing else, so it cannot change a setting by accident.

Each GATT step gives up after 20 seconds. A dropped link retries after 1, 2, 4, 8, and then every 15 seconds until the user disconnects or the page closes. A screen wake lock is held while the link is up and the page is visible.

## 3. Frames are reassembled and checksummed

A 300-byte frame arrives in several notifications (for example 128 + 128 + 44 bytes, depending on the MTU). The profile's framer starts a new buffer at each `55 AA EB 90` preamble, the same way the esphome `assemble()` does, and the page is given only complete 300-byte frames. When a frame is decoded, the byte sum of bytes 0..298 is compared with byte 299. Some firmware sends 320 bytes; the checksum still sits at byte 299, and the extra bytes are ignored. A frame that fails the checksum is counted and skipped; the link stays up. The transport creates a new framer on every connection, before the init writes, so a half frame from before a drop is never joined to a new one.

Byte 4 is the frame type: `0x01` settings, `0x02` cell info, `0x03` device info, `0x05` logbook. Byte 5 is a frame counter.

## 4. Layout chosen from the device info

JK firmware has several cell info layouts. The page supports:

- **JK02_32S** (hardware 11 and later, the default). The cell area is shifted by 16 bytes and every field after it by 32 bytes compared with JK02_24S. Validated against frames from the user's `JK_B1A8S20P` (HW `11.XW`, SW `11.287`).
- **JK02_24S** (hardware below 11). No shift. It is chosen when the device info frame reports a hardware version below 11. Not checked against a real device, so it is marked unverified.

Until the device info frame arrives, JK02_32S is assumed. JK04 (old firmware, float cell voltages) is out of scope. The esphome component takes the layout from its YAML configuration; the page has no configuration, so it reads the major number of the hardware version string instead.

## 5. Protocol sources

The offsets come from the esphome component by syssi, [`components/jk_bms_ble/jk_bms_ble.cpp`](https://github.com/syssi/esphome-jk-bms/blob/main/components/jk_bms_ble/jk_bms_ble.cpp) (`build_frame`, `assemble`, `decode_jk02_cell_info_`, `decode_jk02_settings_`, `decode_device_info_`). They were checked against frames captured from the user's BMS on 2026-11-09: all three frames pass the checksum and decode to plausible values (four cells at 3.327..3.328 V, pack 13.309 V, SOC 98 %, SOH 92 %). Comparing a live session with the JK app screen is part of the verification in prd.md. The captured frames are the `SAMPLE_HEX` frames in `js/protocol.js`.

The first prototype was a Python script using `bleak`. Its offsets and the captured frames are kept in devices.md, so the script is not part of the repository. Four of its readings were wrong and are fixed in the port:

- SOC was read from byte 141. On JK02_32S it is at 141 + 32 = 173. Byte 141 is inside the resistance area and read 0 on the captured frame, where the correct SOC is 98 %.
- Cell voltages and resistances stopped at the first zero. The page uses the cell count from the settings frame, falling back to the enabled-cell bitmask, so a cell that reads 0 V (a broken sense wire) is still shown.
- Device info bytes 78..85 were labeled as the protocol version. They are the manufacturing date as `YYMMDD` (`231105` on the captured frame).
- Device info bytes 118..121 were read as total runtime. They are part of the setup passcode string. Runtime comes from the cell info frame (byte 162 + offset).

## 6. Values computed on the page

- **Power** is voltage × current. The power field at 122 + offset is unsigned and cannot show discharge; esphome makes the same choice.
- **Lowest and highest cell** are found from the cell voltages. The BMS's own index bytes at 62 and 63 + offset did not match the voltages on the captured frame (they read cell 1 as the highest while cell 2 had the highest voltage), so they are kept as raw bytes only.
- **Average and delta** are also computed from the enabled cells. The BMS's own values at 58 and 60 + offset (3.327 V and 0.003 V on the captured frame, against a computed delta of 0.001 V) are not used.
- **Temperatures T3..T5** that read exactly 0 are treated as absent. Unused inputs on small BMS models report 0.

## 7. The log stays in a file the user picks

Readings are written with the File System Access API, with the same New file / Existing file and Append / Override flow as atorch-s1wp (`pickerId` `jk-bms-log`). The chosen name decides the format: `.jsonl` is JSON lines, every other name is tab-separated. The tab-separated header has one column per cell, so it depends on the pack size; an existing file can be appended only when its header matches the connected BMS exactly. JSONL keeps the cells as arrays, so its header line is `{"log":"jk-bms","version":1}` for every pack size.

Averaged rows take the mean of continuous values and the last sample of counters and states, so a 1-minute row never shows a half-on mosfet or a fractional cycle count. A partial bucket is written when logging stops, the interval changes, or the page hides. The file handle cannot be restored after a reload; the user picks the same file again and appends.

## 8. Chart library loaded from a CDN

The chart is [uPlot 1.6.32](https://github.com/leeoniya/uPlot) from jsDelivr, set up like atorch-s1wp. Voltage, current, power, and SOC are on by default, each with its own scale. Cell delta, temperatures, and per-cell voltages are optional, because a 16-cell pack would otherwise draw 16 lines over the main readings. If the library fails to load, the page still shows live numbers and can still log.

## 9. Read-only by design

The BMS controls charging and discharging of a large battery. A wrong write could switch off the output or change a protection limit. The page writes only the two read requests, and no code path builds any other command. Writing settings would need its own scope in the product brief and a confirmation dialog for every write.
