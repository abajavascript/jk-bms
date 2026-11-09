// Full-profile log. The TSV header grows with the cell count, so an existing
// file can be appended only when that count matches. JSONL keeps one header
// and stores cells in arrays.

export const LOG_ID = 'jk-bms';
export const LOG_VERSION = 1;
export const MAX_CELLS = 32;

const AVERAGE_KEYS = [
  'voltage', 'current', 'power',
  'averageVoltage', 'deltaVoltage', 'minVoltage', 'maxVoltage',
  'mosfetTemperature', 't1', 't2', 't3', 't4', 't5',
  'balanceCurrent', 'heatingCurrent'
];

const SCALARS = [
  { name: 'voltage_v', digits: 3, get: (record) => record.voltage },
  { name: 'current_a', digits: 3, get: (record) => record.current },
  { name: 'power_w', digits: 1, get: (record) => record.power },
  { name: 'soc_pct', digits: 0, get: (record) => record.soc },
  { name: 'remaining_ah', digits: 3, get: (record) => record.remainingCapacity },
  { name: 'full_capacity_ah', digits: 3, get: (record) => record.fullCapacity },
  { name: 'cycles', digits: 0, get: (record) => record.cycles },
  { name: 'cycle_capacity_ah', digits: 3, get: (record) => record.cycleCapacity },
  { name: 'soh_pct', digits: 0, get: (record) => record.soh },
  { name: 'cell_avg_v', digits: 3, get: (record) => record.averageVoltage },
  { name: 'cell_delta_v', digits: 3, get: (record) => record.deltaVoltage },
  { name: 'cell_min_v', digits: 3, get: (record) => record.minVoltage },
  { name: 'cell_max_v', digits: 3, get: (record) => record.maxVoltage },
  { name: 'cell_min_idx', integer: true, get: (record) => oneBased(record.minCellIndex) },
  { name: 'cell_max_idx', integer: true, get: (record) => oneBased(record.maxCellIndex) },
  { name: 'mos_temp_c', digits: 1, get: (record) => record.mosfetTemperature },
  { name: 't1_c', digits: 1, get: (record) => record.t1 },
  { name: 't2_c', digits: 1, get: (record) => record.t2 },
  { name: 't3_c', digits: 1, get: (record) => record.t3 },
  { name: 't4_c', digits: 1, get: (record) => record.t4 },
  { name: 't5_c', digits: 1, get: (record) => record.t5 },
  { name: 'balance_current_a', digits: 3, get: (record) => record.balanceCurrent },
  { name: 'balance_action', digits: 0, get: (record) => record.balanceAction },
  { name: 'charge_mos', digits: 0, get: (record) => record.chargeMosfet },
  { name: 'discharge_mos', digits: 0, get: (record) => record.dischargeMosfet },
  { name: 'precharge', digits: 0, get: (record) => record.precharge },
  { name: 'heating', digits: 0, get: (record) => record.heating },
  { name: 'heating_current_a', digits: 3, get: (record) => record.heatingCurrent },
  { name: 'errors_hex', text: true, get: (record) => record.errorsHex ?? null },
  { name: 'runtime_s', integer: true, get: (record) => record.runtime ?? null }
];

const SNAPSHOT_KEYS = [
  'voltage', 'current', 'power', 'soc', 'remainingCapacity', 'fullCapacity', 'cycles', 'cycleCapacity', 'soh',
  'averageVoltage', 'deltaVoltage', 'minVoltage', 'maxVoltage', 'minCellIndex', 'maxCellIndex',
  'mosfetTemperature', 't1', 't2', 't3', 't4', 't5',
  'balanceCurrent', 'balanceAction', 'chargeMosfet', 'dischargeMosfet', 'precharge', 'heating', 'heatingCurrent',
  'errorsHex', 'runtime'
];

export function formatTimestamp(date = new Date()) {
  const pad = (value) => String(value).padStart(2, '0');
  const offsetMinutes = -date.getTimezoneOffset();
  const sign = offsetMinutes >= 0 ? '+' : '-';
  const absolute = Math.abs(offsetMinutes);
  return `${date.getFullYear()}-${pad(date.getMonth() + 1)}-${pad(date.getDate())} ${pad(date.getHours())}:${pad(date.getMinutes())}:${pad(date.getSeconds())} ${sign}${pad(Math.floor(absolute / 60))}:${pad(absolute % 60)}`;
}

export function fixed(digits) {
  return (value) => (value == null || Number.isNaN(value) ? '' : Number(value).toFixed(digits));
}

export function tsvFormat({ columns }) {
  const fields = () => {
    const list = typeof columns === 'function' ? columns() : columns;
    if (!Array.isArray(list) || !list.length) throw new Error('A TSV log needs at least one column.');
    return list;
  };
  return {
    extension: '.tsv',
    mime: 'text/tab-separated-values',
    description: 'Tab-separated values',
    get header() {
      return ['timestamp', ...fields().map((column) => column.name)].join('\t');
    },
    isOwnFile(text) {
      // The first line has to be this header. A different cell count is a different header.
      return firstLine(text) === this.header;
    },
    row(record, date) {
      return [
        formatTimestamp(date),
        ...fields().map((column) => cell(column.value(record)))
      ].join('\t');
    }
  };
}

export function jsonlFormat({ id, version = 1, row: formatRow, matches }) {
  const header = JSON.stringify({ log: id, version });
  return {
    extension: '.jsonl',
    mime: 'application/x-ndjson',
    description: 'JSON lines',
    header,
    isOwnFile(text) {
      if (!jsonlHeaderMatches(text, id, version)) return false;
      return matches ? matches(text) : true;
    },
    row: formatRow || ((record, date) => JSON.stringify({ timestamp: formatTimestamp(date), ...record }))
  };
}

export function averageAggregate(keys) {
  return (entries) => {
    const last = entries[entries.length - 1];
    const record = { ...last.record };
    for (const key of keys) {
      record[key] = entries.reduce((sum, entry) => sum + entry.record[key], 0) / entries.length;
    }
    return record;
  };
}

export function fullProfileColumns(cellCount) {
  const count = requireCount(cellCount);
  const columns = SCALARS.map(columnFrom);
  for (let index = 0; index < count; index += 1) {
    columns.push(columnFrom({
      name: `cell_${pad2(index + 1)}_v`,
      digits: 3,
      get: (record) => record.cells?.[index]?.voltage ?? null
    }));
  }
  for (let index = 0; index < count; index += 1) {
    columns.push(columnFrom({
      name: `res_${pad2(index + 1)}_ohm`,
      digits: 3,
      get: (record) => record.cells?.[index]?.resistance ?? null
    }));
  }
  return columns;
}

export function packJsonlFormat(cellCount) {
  const countOf = () => (typeof cellCount === 'function' ? cellCount() : cellCount);
  return jsonlFormat({
    id: LOG_ID,
    version: LOG_VERSION,
    matches: (text) => jsonlCellCountMatches(text, countOf()),
    row: (record, date) => JSON.stringify(packJsonlRecord(record, date, countOf()))
  });
}

export function packJsonlRecord(record, date, cellCount) {
  const count = requireCount(cellCount);
  const row = { timestamp: formatTimestamp(date) };
  for (const field of SCALARS) row[field.name] = jsonField(field, record);
  row.cells_v = Array.from({ length: count }, (_, index) => jsonNumber(3, record?.cells?.[index]?.voltage));
  row.res_ohm = Array.from({ length: count }, (_, index) => jsonNumber(3, record?.cells?.[index]?.resistance));
  return row;
}

export function aggregatePack(entries, cellCount) {
  if (!entries?.length) throw new Error('No readings to average.');
  const count = requireCount(cellCount);
  const last = entries[entries.length - 1].record;
  const record = { ...last, cells: [] };
  for (const key of AVERAGE_KEYS) record[key] = meanOf(entries, (item) => item[key]);
  for (let index = 0; index < count; index += 1) {
    record.cells.push({
      voltage: meanOf(entries, (item) => item.cells?.[index]?.voltage),
      resistance: meanOf(entries, (item) => item.cells?.[index]?.resistance)
    });
  }
  return record;
}

export function createLogger(options = {}) {
  if (options.format || options.formats) return createFileLogger(options);
  return createPackLogger(options);
}

function createPackLogger({ onFile, onRows, onError }) {
  const state = { cellCount: 0, locked: null, mismatchNoted: false };
  const activeCount = () => state.locked ?? state.cellCount;
  const file = createFileLogger({
    formats: [
      tsvFormat({ columns: () => fullProfileColumns(activeCount()) }),
      packJsonlFormat(activeCount)
    ],
    aggregate: (entries) => aggregatePack(entries, activeCount()),
    suggestedName: 'jk-bms-log.tsv',
    pickerId: 'jk-bms-log',
    onFile,
    onRows,
    onError
  });

  function setCellCount(count) {
    const next = Number(count);
    if (!Number.isInteger(next) || next < 1 || next > MAX_CELLS) return activeCount();
    if (state.locked != null) {
      if (next !== state.locked && !state.mismatchNoted) {
        state.mismatchNoted = true;
        onError?.(new Error(`This log was started for ${state.locked} cells. The BMS now reports ${next}. Rows keep ${state.locked} cells.`));
      }
      return state.locked;
    }
    state.cellCount = next;
    return next;
  }

  async function openForLogging(kind, decide) {
    if (file.isLogging()) return false;
    if (!Number.isInteger(state.cellCount) || state.cellCount < 1) {
      throw new Error('Wait for a cell reading before logging. The log header depends on the cell count.');
    }
    state.locked = state.cellCount;
    state.mismatchNoted = false;
    try {
      const opened = await file.openForLogging(kind, decide);
      if (!opened) state.locked = null;
      return opened;
    } catch (error) {
      state.locked = null;
      throw error;
    }
  }

  async function stop() {
    try {
      await file.stop();
    } finally {
      state.locked = null;
      state.mismatchNoted = false;
    }
  }

  function onRecord(record, date = new Date()) {
    file.onRecord(snapshotPack(record, activeCount()), date);
  }

  return {
    openForLogging,
    stop,
    onRecord,
    flushPartial: () => file.flushPartial(),
    setIntervalSeconds: (seconds) => file.setIntervalSeconds(seconds),
    setCellCount,
    cellCount: activeCount,
    isLogging: () => file.isLogging(),
    hasFile: () => file.hasFile(),
    rowsWritten: () => file.rowsWritten()
  };
}

function createFileLogger({ format, formats, aggregate = (entries) => entries[entries.length - 1].record, suggestedName, pickerId, onFile, onRows, onError }) {
  const available = formats?.length ? formats : format ? [format] : [];
  if (!available.length) throw new Error('createLogger needs a format.');
  let handle = null;
  let active = available[0];
  let logging = false;
  let intervalMs = 0;
  let queue = Promise.resolve();
  let rowsWritten = 0;
  let bucket = [];
  let bucketStarted = 0;
  let needsLeadingNewline = false;

  function formatForName(name) {
    const lower = String(name).toLowerCase();
    return available.find((item) => lower.endsWith(item.extension.toLowerCase())) || available[0];
  }

  function setIntervalSeconds(seconds) {
    const parsed = Number(seconds);
    intervalMs = Number.isFinite(parsed) && parsed >= 1 ? Math.floor(parsed) * 1000 : 0;
  }

  async function openForLogging(kind, decide) {
    if (logging) return false;
    if (kind === 'new') {
      // The save picker creates a missing name. It also clears an existing file before returning.
      assertPicker(window.showSaveFilePicker, 'showSaveFilePicker');
      await replace(await pickFile('save'));
    } else if (kind === 'existing') {
      // The open picker keeps existing bytes so append can still read them.
      assertPicker(window.showOpenFilePicker, 'showOpenFilePicker');
      const next = await pickFile('open');
      const permission = await next.requestPermission({ mode: 'readwrite' });
      if (permission !== 'granted') throw new Error('Write permission was not granted for that file.');
      const text = await (await next.getFile()).text();
      if (text.length === 0) {
        await replace(next);
      } else {
        const chosen = formatForName(next.name);
        const canAppend = chosen.isOwnFile(text);
        const action = await decide({ name: next.name, canAppend });
        if (action === 'append') {
          if (!canAppend) throw new Error('That file does not start with this log header.');
          await adopt(next, !text.endsWith('\n'));
        } else if (action === 'override') {
          await replace(next);
        } else {
          return false;
        }
      }
    } else {
      return false;
    }
    logging = true;
    bucket = [];
    bucketStarted = 0;
    return true;
  }

  async function adopt(next, leadingNewline) {
    await queue;
    handle = next;
    active = formatForName(next.name);
    needsLeadingNewline = leadingNewline;
    resetCount(next);
  }

  async function replace(next) {
    await queue;
    handle = next;
    active = formatForName(next.name);
    needsLeadingNewline = false;
    resetCount(next);
    const writable = await next.createWritable();
    let committed = false;
    try {
      if (active.header) await writable.write(`${active.header}\n`);
      await writable.close();
      committed = true;
    } finally {
      if (!committed) {
        try { await writable.abort(); } catch { /* close already finished */ }
      }
    }
  }

  function resetCount(next) {
    rowsWritten = 0;
    onRows?.(0);
    onFile?.(next.name);
  }

  async function stop() {
    logging = false;
    await flushPartial();
  }

  function onRecord(record, date = new Date()) {
    if (!logging || !handle) return;
    if (!intervalMs) {
      enqueue([active.row(record, date)]).catch(() => {});
      return;
    }
    const now = date.getTime();
    if (bucket.length && now - bucketStarted >= intervalMs) {
      const entries = bucket;
      bucket = [];
      enqueue([active.row(aggregate(entries), entries[entries.length - 1].date)]).catch(() => {});
    }
    if (!bucket.length) bucketStarted = now;
    bucket.push({ record, date });
  }

  async function flushPartial() {
    const entries = bucket;
    bucket = [];
    bucketStarted = 0;
    if (!entries.length || !handle) {
      await queue;
      return;
    }
    await enqueue([active.row(aggregate(entries), entries[entries.length - 1].date)]);
  }

  function enqueue(lines) {
    const prefix = needsLeadingNewline ? '\n' : '';
    needsLeadingNewline = false;
    const text = prefix + lines.map((line) => `${line}\n`).join('');
    const job = queue.then(() => commit(text, lines.length));
    queue = job.catch((error) => onError?.(error));
    return job;
  }

  async function commit(text, count) {
    if (!handle) throw new Error('No log file is selected.');
    const size = (await handle.getFile()).size;
    // close() is what replaces the real file. Until then Chrome keeps a .crswap sibling.
    const writable = await handle.createWritable({ keepExistingData: true });
    try {
      await writable.seek(size);
      await writable.write(text);
    } finally {
      await writable.close();
    }
    rowsWritten += count;
    onRows?.(rowsWritten);
  }

  function pickerTypes(plain) {
    return available.map((item) => ({
      description: item.description,
      accept: plain ? { 'text/plain': [item.extension] } : { [item.mime]: [item.extension] }
    }));
  }

  async function pickFile(kind) {
    const open = kind === 'save' ? window.showSaveFilePicker : window.showOpenFilePicker;
    const options = (types) => ({
      id: pickerId,
      types,
      // All files stays in the dialog. A name with no known extension uses the first format.
      ...(kind === 'save' ? { suggestedName: suggestedName || `log${available[0].extension}` } : { multiple: false })
    });
    let chosen;
    try {
      chosen = await open(options(pickerTypes(false)));
    } catch (error) {
      // Some platforms reject the MIME type with a TypeError; text/plain is accepted everywhere.
      if (error?.name === 'AbortError' || !(error instanceof TypeError)) throw error;
      chosen = await open(options(pickerTypes(true)));
    }
    return kind === 'save' ? chosen : chosen[0];
  }

  return {
    openForLogging,
    stop,
    onRecord,
    flushPartial,
    setIntervalSeconds,
    isLogging: () => logging,
    hasFile: () => Boolean(handle),
    rowsWritten: () => rowsWritten
  };
}

function columnFrom(field) {
  return { ...field, value: (record) => tsvField(field, record) };
}

function tsvField(field, record) {
  const value = field.get(record ?? {});
  if (field.text) return value == null ? '' : String(value);
  if (field.integer) {
    return value == null || !Number.isFinite(Number(value)) ? '' : String(Math.trunc(Number(value)));
  }
  return fixed(field.digits)(value);
}

function jsonField(field, record) {
  const value = field.get(record ?? {});
  if (field.text) return value == null || value === '' ? null : String(value);
  if (field.integer) {
    return value == null || !Number.isFinite(Number(value)) ? null : Math.trunc(Number(value));
  }
  return jsonNumber(field.digits, value);
}

function jsonNumber(digits, value) {
  if (typeof value !== 'number' || !Number.isFinite(value)) return null;
  return Number(value.toFixed(digits));
}

function jsonlCellCountMatches(text, cellCount) {
  const line = firstDataLine(text);
  if (line == null) return true;
  try {
    const row = JSON.parse(line);
    return Array.isArray(row?.cells_v) && row.cells_v.length === cellCount
      && Array.isArray(row?.res_ohm) && row.res_ohm.length === cellCount;
  } catch {
    return false;
  }
}

function snapshotPack(record, cellCount) {
  const count = Number.isInteger(cellCount) && cellCount > 0 ? Math.min(cellCount, MAX_CELLS) : 0;
  const snap = { cells: [] };
  for (const key of SNAPSHOT_KEYS) snap[key] = record?.[key] ?? null;
  for (let index = 0; index < count; index += 1) {
    snap.cells.push({
      voltage: record?.cells?.[index]?.voltage ?? null,
      resistance: record?.cells?.[index]?.resistance ?? null
    });
  }
  return snap;
}

function meanOf(entries, read) {
  let sum = 0;
  let count = 0;
  for (const entry of entries) {
    const value = read(entry.record);
    if (typeof value !== 'number' || !Number.isFinite(value)) continue;
    sum += value;
    count += 1;
  }
  return count ? sum / count : null;
}

function oneBased(index) {
  return index == null || !Number.isFinite(Number(index)) ? null : Number(index) + 1;
}

function requireCount(cellCount) {
  const count = Number(cellCount);
  if (!Number.isInteger(count) || count < 1 || count > MAX_CELLS) {
    throw new Error(`Cell count must be from 1 to ${MAX_CELLS}.`);
  }
  return count;
}

function pad2(value) {
  return String(value).padStart(2, '0');
}

function firstLine(text) {
  const end = text.indexOf('\n');
  const line = end < 0 ? text : text.slice(0, end);
  return line.endsWith('\r') ? line.slice(0, -1) : line;
}

function firstDataLine(text) {
  const lines = String(text).split(/\r?\n/);
  for (let index = 1; index < lines.length; index += 1) {
    if (lines[index].trim()) return lines[index].trim();
  }
  return null;
}

function jsonlHeaderMatches(text, id, version) {
  try {
    const first = JSON.parse(firstLine(text));
    return first?.log === id && first?.version === version;
  } catch {
    return false;
  }
}

function cell(value) {
  return value == null ? '' : String(value).replace(/[\t\r\n]+/g, ' ');
}

function assertPicker(fn, name) {
  if (typeof fn !== 'function') {
    throw new Error(`This page cannot write a chosen file (${name} is missing). Open it from http://localhost or HTTPS in Chrome or Edge.`);
  }
}
