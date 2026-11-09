# JK-BMS Web Monitor

This page connects to a JK-BMS over Bluetooth Low Energy and shows what the battery is doing: pack voltage, current, power, state of charge, remaining capacity, every cell voltage and wire resistance, temperatures, and the balancer and mosfet states. Readings can be plotted and stored in a local file chosen in the browser, tab-separated by default or JSON lines when the name ends in `.jsonl`. The page only reads data; it never changes a BMS setting.

## Open the page

The hosted page is [https://abajavascript.github.io/jk-bms/](https://abajavascript.github.io/jk-bms/). What the app must do is in [doc/prd.md](doc/prd.md). Why it is built this way is in [doc/adr.md](doc/adr.md).

Chrome or Edge on a computer, and Chrome on Android, can connect. iPhone and iPad cannot. Open the site over HTTPS or from localhost. A file opened from disk cannot use Bluetooth or save to a chosen file.

To try it on this computer, from this folder:

```
python -m http.server 8000
```

Then open [http://127.0.0.1:8000/](http://127.0.0.1:8000/). On Android, turn Location on or the Bluetooth device list can stay empty, and keep the tab in the foreground.

Close the JK app on your phone first. The BMS accepts one Bluetooth connection at a time.

## Supported BMS

JK-BMS models with the JK02_32S protocol (hardware version 11 and later), for example `JK_B1A8S20P` with hardware `11.XW` and software `11.287`. Older JK02_24S units (hardware below 11) are detected from the device info and decoded with the 24S layout, which has not been checked on a real device yet. Very old JK04 firmware is not supported.

## Watch the battery

Press **Connect** and pick the BMS. Its name starts with `JK-` or `JK_`. The page asks the BMS for its device info and its cell info; the Device section fills in first, then live readings start. Current is negative while discharging. Power is voltage times current.

The Cells section shows each cell's voltage and wire resistance. The lowest and highest cells are highlighted. The chart shows voltage, current, power, and SOC, each on its own scale. Cell delta, temperatures, and individual cells can be turned on with the chips above it. Hover a point to read its value, the elapsed time, and the clock time.

If the BMS goes out of range, the page reconnects by itself and says so in the link log. **Disconnect** stops it.

Without a BMS, **Decode sample packet** under Packet details fills the page from frames captured on a real BMS.

## Log to a file

Press **Start logging**. **New file** creates a log when you enter a name. The file dialog defaults to tab-separated (`.tsv`). Choose JSON lines for a `.jsonl` file. **Existing file** keeps the current contents: an empty file starts a new log, and a file that already holds a JK-BMS log of that format for the same number of cells can be appended to or overridden.

Store every reading, or one averaged row every 5 seconds, 10 seconds, 30 seconds, 1 minute, 5 minutes, or 10 minutes. A tab-separated file has one header line, with one column per cell voltage and per cell resistance. A JSON lines file starts with `{"log":"jk-bms","version":1}` and then one JSON object per row, with the cells as arrays. Timestamps look like `2026-11-09 19:30:43 +02:00`. The full column list is in [doc/prd.md](doc/prd.md).

Closing the page saves the last finished row and disconnects. If the Bluetooth link drops, the page reconnects and keeps appending to the same file.
