// JK-BMS read protocol. JK04 float frames are not decoded.
// JK02_24S offsets are unverified against a real device.

export const HEADER = Uint8Array.of(0x55, 0xaa, 0xeb, 0x90);
export const FRAME_LENGTH = 300;
export const CMD_DEVICE_INFO = 0x97;
export const CMD_CELL_INFO = 0x96;

// Spacing for a repeated 0x96 while no cell-info frame has arrived.
export const CELL_INFO_RETRY_MS = 5000;

export const LAYOUTS = {
  JK02_32S: {
    id: 'JK02_32S',
    verified: true,
    cellOffset: 16,
    fieldOffset: 32,
    maxCells: 32,
    mosfetOffset: 112,
    errorsOffset: 134,
    errorsBytes: 4,
    extended: true
  },
  JK02_24S: {
    id: 'JK02_24S',
    verified: false,
    cellOffset: 0,
    fieldOffset: 0,
    maxCells: 24,
    mosfetOffset: 134,
    errorsOffset: 136,
    errorsBytes: 2,
    extended: false
  }
};

// Device-info passcodes. Left out of decoded fields and out of the undecoded list.
export const DEVICE_INFO_WITHHELD = [
  { offset: 62, length: 16 },
  { offset: 97, length: 5 },
  { offset: 118, length: 16 }
];

export const BALANCE_ACTIONS = ['off', 'charging', 'discharging'];
export const BATTERY_TYPES = ['LFP', 'Li-ion', 'LTO'];
export const CHARGE_STATUSES = ['bulk', 'absorption', 'float'];

export const SAMPLE_HEX = {
  settings: '55aaeb90017a58020000f00a0000860b0000ac0d00007a0d00000a000000ac0d0000f00a00000000000000000000280a000060ea00001e0000003c000000400d03002c0100003c0000003c000000e8030000bc02000058020000bc02000058020000140000001e000000e8030000200300000400000001000000010000000100000048e80100dc050000160d000000000000000000000000000000000000000000000000000000000000000000000000000000000000000000000000000000000000000000000000000000000000000000000000000000000000000000000000000000000000000000000000000000000000000000000000000000000000000000000000000000000000000000000000000000000000b0710b0000003c3200fcf9ffff1f2d00000000000012',
  cellInfo: '55aaeb90027aff0c000dff0cff0c00000000000000000000000000000000000000000000000000000000000000000000000000000000000000000000000000000000000000000f000000ff0c0300000133003300340034000000000000000000000000000000000000000000000000000000000000000000000000000000000000000000000000000000000000000000f40000000000fd3300000000000000000000d200d1000000000000000062f9b701000cc101000e000000deda18005c000000fd51340101010000000000000000000000000000ff00010000003a03000000009e4a4240000000003205201c00010001bb0500009ceb270000000000f40000000000000000000000000000000000000000000000000000000000000000feff7fdc0f010000000000005d',
  deviceInfo: '55aaeb90037a4a4b5f4231413853323050000000000031312e585700000031312e32383700004c513401290000004a4b5f4231413853323050000000000031323334000000000000000000000000323331313035000030303030303030303030003132333400496e707574205573657264617461000031323334353600000000000000000000496e7075742055736572646174610000fcf9ffff1f2d000000000000900f00000000c0d8030000000001000000000000000000000000000000000000000000000000000000000000000000000000000000000000000000000000000000000000000000000000000000000000000000000000000000000000000000000000000000000000000000000000000000000000000000000000000000fe2f000000000000000000007a'
};

export function frameLength(buffer) {
  return buffer.length >= FRAME_LENGTH ? FRAME_LENGTH : null;
}

export const FRAMER = { header: HEADER, frameLength };

// Read requests only. A non-zero value in this frame writes a BMS setting.
export function buildCommand(command) {
  if (command !== CMD_DEVICE_INFO && command !== CMD_CELL_INFO) {
    throw new Error(`Command 0x${byteHex(command)} is not a read request`);
  }
  const frame = new Uint8Array(20);
  frame[0] = 0xaa;
  frame[1] = 0x55;
  frame[2] = 0x90;
  frame[3] = 0xeb;
  frame[4] = command;
  frame[19] = checksum(frame, 19);
  return frame;
}

export const COMMAND_DEVICE_INFO = buildCommand(CMD_DEVICE_INFO);
export const COMMAND_CELL_INFO = buildCommand(CMD_CELL_INFO);

// A cell-info frame the BMS actually sent: preamble, type 0x02, and a matching checksum.
// Notifications are shorter than this, so the check runs on a reassembled frame.
export function isCellInfoFrame(bytes) {
  if (!bytes || bytes.length < FRAME_LENGTH) return false;
  for (let i = 0; i < HEADER.length; i += 1) {
    if (bytes[i] !== HEADER[i]) return false;
  }
  if (bytes[4] !== 0x02) return false;
  return checksum(bytes, FRAME_LENGTH - 1) === bytes[FRAME_LENGTH - 1];
}

export const PROFILE = {
  filters: [{ namePrefix: 'JK-' }, { namePrefix: 'JK_' }, { namePrefix: 'PowMr' }],
  service: 0xffe0,
  notify: 0xffe1,
  write: 0xffe1,
  // The BMS accepts the write but never sends an ATT response.
  writeWithoutResponse: true,
  framer: FRAMER,
  onReady: async (link) => {
    await link.write(COMMAND_DEVICE_INFO);
    await link.write(COMMAND_CELL_INFO);
  },
  // After 0x96 the BMS streams on its own. Resend only while no cell-info frame has arrived.
  silence: {
    everyMs: CELL_INFO_RETRY_MS,
    seen: isCellInfoFrame,
    run: (link) => link.write(COMMAND_CELL_INFO)
  }
};

export function checksum(bytes, length = bytes.length) {
  let sum = 0;
  for (let i = 0; i < length; i += 1) sum = (sum + bytes[i]) & 0xff;
  return sum;
}

export function hexToBytes(hex) {
  const clean = String(hex).replace(/\s+/g, '');
  if (clean.length % 2 !== 0) throw new Error('Hex length must be even');
  const bytes = new Uint8Array(clean.length / 2);
  for (let i = 0; i < bytes.length; i += 1) {
    const byte = Number.parseInt(clean.slice(i * 2, i * 2 + 2), 16);
    if (Number.isNaN(byte)) throw new Error('Invalid hex');
    bytes[i] = byte;
  }
  return bytes;
}

export function toHex(bytes, start = 0, end = bytes.length) {
  let hex = '';
  for (let i = start; i < end; i += 1) hex += byteHex(bytes[i]);
  return hex;
}

export function hardwareMajor(hardwareVersion) {
  const match = /^(\d+)/.exec(String(hardwareVersion ?? '').trim());
  return match ? Number(match[1]) : null;
}

export function layoutForHardware(hardwareVersion) {
  const major = hardwareMajor(hardwareVersion);
  if (major == null || major >= 11) return LAYOUTS.JK02_32S;
  return LAYOUTS.JK02_24S;
}

export function decodeFrame(bytes, options = {}) {
  const frame = copyFrame(bytes);
  const span = cover(frame);
  const record = baseRecord(frame, span);
  switch (record.frameType) {
    case 0x01:
      return decodeSettings(frame, span, record);
    case 0x02:
      return decodeCellInfo(frame, span, record, options);
    case 0x03:
      return decodeDeviceInfo(frame, span, record);
    case 0x05:
      record.type = 'logbook';
      record.undecoded = span.gaps();
      return record;
    default:
      throw Object.assign(new Error(`Unsupported frame type 0x${byteHex(record.frameType)}`), {
        frame,
        frameType: record.frameType,
        counter: record.counter,
        crcOk: true
      });
  }
}

export function decodeSamples() {
  const settings = decodeFrame(hexToBytes(SAMPLE_HEX.settings));
  const deviceInfo = decodeFrame(hexToBytes(SAMPLE_HEX.deviceInfo));
  const cellInfo = decodeFrame(hexToBytes(SAMPLE_HEX.cellInfo), {
    layout: deviceInfo.layout,
    cellCount: settings.cellCount
  });
  return { settings, deviceInfo, cellInfo };
}

function decodeSettings(frame, span, record) {
  const read = fieldReader(frame, span);
  record.type = 'settings';
  record.cellUvp = milli(read.u32(10));
  record.cellOvp = milli(read.u32(18));
  record.maxChargeCurrent = milli(read.u32(50));
  record.maxDischargeCurrent = milli(read.u32(62));
  record.cellCount = read.u32(114);
  record.nominalCapacity = milli(read.u32(130));
  record.balanceStartVoltage = milli(read.u32(138));
  record.undecoded = span.gaps();
  return record;
}

function decodeCellInfo(frame, span, record, options) {
  const layout = resolveLayout(options.layout);
  const read = fieldReader(frame, span);
  const cell = layout.cellOffset;
  const tail = layout.fieldOffset;
  // A 0 V reading is a cell (a broken sense wire), not the end of the list.
  span.mark(6, layout.maxCells * 2);
  span.mark(64 + cell, layout.maxCells * 2);
  const enabledMask = read.u32(54 + cell);
  const count = resolveCellCount(options.cellCount, enabledMask, layout.maxCells);
  const cells = [];
  for (let i = 0; i < count; i += 1) {
    cells.push({
      index: i,
      voltage: milli(u16(frame, 6 + i * 2)),
      resistance: milli(u16(frame, 64 + cell + i * 2)),
      enabled: ((enabledMask >>> i) & 1) === 1
    });
  }
  const summary = summarize(cells);
  record.type = 'cellInfo';
  record.layout = layout.id;
  record.layoutVerified = layout.verified;
  record.cellCount = count;
  record.cells = cells;
  record.enabledMask = enabledMask;
  Object.assign(record, summary);
  // The captured frame's own min/max indexes did not match the cell voltages.
  record.bmsAverageVoltage = milli(read.u16(58 + cell));
  record.bmsDeltaVoltage = milli(read.u16(60 + cell));
  record.bmsMaxCellIndex = read.u8(62 + cell);
  record.bmsMinCellIndex = read.u8(63 + cell);
  record.mosfetTemperature = deci(read.s16(layout.mosfetOffset + tail));
  record.wireWarningMask = read.u32(114 + tail);
  record.voltage = milli(read.u32(118 + tail));
  record.current = milli(read.s32(126 + tail));
  record.power = record.voltage * record.current;
  record.t1 = deci(read.s16(130 + tail));
  record.t2 = deci(read.s16(132 + tail));
  record.errors = layout.errorsBytes === 4 ? read.u32(layout.errorsOffset + tail) : read.u16(layout.errorsOffset + tail);
  record.errorsHex = record.errors.toString(16).padStart(layout.errorsBytes * 2, '0');
  record.balanceCurrent = milli(read.s16(138 + tail));
  record.balanceAction = read.u8(140 + tail);
  record.soc = read.u8(141 + tail);
  record.remainingCapacity = milli(read.u32(142 + tail));
  record.fullCapacity = milli(read.u32(146 + tail));
  record.cycles = read.u32(150 + tail);
  record.cycleCapacity = milli(read.u32(154 + tail));
  record.soh = read.u8(158 + tail);
  record.precharge = flag(read.u8(159 + tail));
  record.runtime = read.u32(162 + tail);
  record.chargeMosfet = flag(read.u8(166 + tail));
  record.dischargeMosfet = flag(read.u8(167 + tail));
  record.precharging = flag(read.u8(168 + tail));
  record.temperatureSensorMask = read.u8(182 + tail);
  record.heating = flag(read.u8(183 + tail));
  // Unverified on the captured 4-cell BMS: it read 7.2 A with heating off and no heater.
  record.heatingCurrent = milli(read.s16(204 + tail));
  record.t3 = null;
  record.t4 = null;
  record.t5 = null;
  record.batteryType = null;
  record.chargeStatus = null;
  if (layout.extended) {
    // Unused T3..T5 inputs read exactly 0. A real 0.0 °C is indistinguishable, so it is absent.
    record.t5 = optionalTemperature(read.s16(222 + tail));
    record.t4 = optionalTemperature(read.s16(224 + tail));
    record.t3 = optionalTemperature(read.s16(226 + tail));
    record.batteryType = read.u8(243 + tail);
    record.chargeStatus = read.u8(248 + tail);
  }
  record.undecoded = span.gaps();
  return record;
}

function decodeDeviceInfo(frame, span, record) {
  const read = fieldReader(frame, span);
  for (const range of DEVICE_INFO_WITHHELD) span.mark(range.offset, range.length);
  const hardwareVersion = read.ascii(22, 8);
  const layout = layoutForHardware(hardwareVersion);
  record.type = 'deviceInfo';
  record.model = read.ascii(6, 16);
  record.hardwareVersion = hardwareVersion;
  record.softwareVersion = read.ascii(30, 8);
  record.hardwareMajor = hardwareMajor(hardwareVersion);
  record.layout = layout.id;
  record.layoutVerified = layout.verified;
  record.uptime = read.u32(38);
  record.powerOnCount = read.u32(42);
  record.deviceName = read.ascii(46, 16);
  record.manufacturingDate = read.ascii(78, 6);
  record.serialNumber = read.ascii(86, 11);
  record.userData = read.ascii(102, 16);
  record.withheld = DEVICE_INFO_WITHHELD;
  record.undecoded = span.gaps();
  return record;
}

function copyFrame(input) {
  const bytes = asBytes(input);
  if (bytes.length < FRAME_LENGTH) {
    throw new Error(`Frame is ${bytes.length} bytes, expected at least ${FRAME_LENGTH}`);
  }
  for (let i = 0; i < HEADER.length; i += 1) {
    if (bytes[i] !== HEADER[i]) throw new Error('Frame header is not 55 AA EB 90');
  }
  const frame = Uint8Array.from(bytes.subarray(0, FRAME_LENGTH));
  const computed = checksum(frame, FRAME_LENGTH - 1);
  if (computed !== frame[FRAME_LENGTH - 1]) {
    throw Object.assign(
      new Error(`Frame checksum failed: computed ${byteHex(computed)}, received ${byteHex(frame[FRAME_LENGTH - 1])}`),
      { frame, frameType: frame[4], counter: frame[5], crcOk: false }
    );
  }
  return frame;
}

function baseRecord(frame, span) {
  span.mark(0, 6);
  span.mark(FRAME_LENGTH - 1, 1);
  return {
    type: '',
    frameType: frame[4],
    counter: frame[5],
    crcOk: true,
    header: toHex(frame, 0, 4),
    raw: frame
  };
}

function resolveLayout(layout) {
  if (layout == null) return LAYOUTS.JK02_32S;
  if (typeof layout === 'string') {
    const found = LAYOUTS[layout];
    if (!found) throw new Error(`Unknown layout ${layout}`);
    return found;
  }
  if (layout.id && LAYOUTS[layout.id]) return LAYOUTS[layout.id];
  throw new Error('Unknown layout');
}

function resolveCellCount(requested, mask, maxCells) {
  if (Number.isInteger(requested) && requested > 0) return Math.min(requested, maxCells);
  let highest = -1;
  for (let i = 0; i < maxCells; i += 1) {
    if ((mask >>> i) & 1) highest = i;
  }
  return highest + 1;
}

function summarize(cells) {
  const enabled = cells.filter((cell) => cell.enabled);
  const source = enabled.length ? enabled : cells;
  if (!source.length) {
    return {
      averageVoltage: null,
      deltaVoltage: null,
      minVoltage: null,
      maxVoltage: null,
      minCellIndex: null,
      maxCellIndex: null
    };
  }
  let min = source[0];
  let max = source[0];
  let sum = 0;
  for (const cell of source) {
    sum += cell.voltage;
    if (cell.voltage < min.voltage) min = cell;
    if (cell.voltage > max.voltage) max = cell;
  }
  return {
    averageVoltage: sum / source.length,
    deltaVoltage: max.voltage - min.voltage,
    minVoltage: min.voltage,
    maxVoltage: max.voltage,
    minCellIndex: min.index,
    maxCellIndex: max.index
  };
}

function fieldReader(frame, span) {
  return {
    u8(offset) {
      span.mark(offset, 1);
      return frame[offset];
    },
    u16(offset) {
      span.mark(offset, 2);
      return u16(frame, offset);
    },
    s16(offset) {
      const value = this.u16(offset);
      return value & 0x8000 ? value - 0x10000 : value;
    },
    u32(offset) {
      span.mark(offset, 4);
      return u32(frame, offset);
    },
    s32(offset) {
      return this.u32(offset) | 0;
    },
    ascii(offset, length) {
      span.mark(offset, length);
      let text = '';
      for (let i = 0; i < length; i += 1) {
        const byte = frame[offset + i];
        if (byte === 0) break;
        if (byte >= 32 && byte <= 126) text += String.fromCharCode(byte);
      }
      return text;
    }
  };
}

function cover(frame) {
  const used = new Uint8Array(frame.length);
  return {
    mark(offset, length) {
      const end = offset + length;
      if (offset < 0 || end > frame.length) {
        throw new Error(`Field at ${offset} length ${length} is outside the frame`);
      }
      used.fill(1, offset, end);
    },
    gaps() {
      const runs = [];
      let index = 0;
      while (index < frame.length) {
        if (used[index]) {
          index += 1;
          continue;
        }
        const start = index;
        while (index < frame.length && !used[index]) index += 1;
        runs.push({ offset: start, hex: toHex(frame, start, index) });
      }
      return runs;
    }
  };
}

function asBytes(value) {
  if (typeof value === 'string') throw new Error('Pass bytes to decodeFrame; use hexToBytes for a hex string');
  if (value instanceof Uint8Array) return value;
  if (ArrayBuffer.isView(value)) return new Uint8Array(value.buffer, value.byteOffset, value.byteLength);
  if (Array.isArray(value)) return Uint8Array.from(value);
  throw new Error('Frame is not bytes');
}

function u16(frame, offset) {
  return frame[offset] | (frame[offset + 1] << 8);
}

function u32(frame, offset) {
  return (frame[offset]
    + (frame[offset + 1] << 8)
    + (frame[offset + 2] << 16)
    + frame[offset + 3] * 0x1000000) >>> 0;
}

function milli(value) {
  return value * 0.001;
}

function deci(value) {
  return value * 0.1;
}

function optionalTemperature(raw) {
  return raw === 0 ? null : deci(raw);
}

function flag(value) {
  return value ? 1 : 0;
}

function byteHex(value) {
  return (value & 0xff).toString(16).padStart(2, '0');
}
