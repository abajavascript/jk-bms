import { createBle } from './ble.js';
import { cellSeries, createChart } from './chart.js';
import { ask } from './dialogs.js';
import { createLogger } from './log.js';
import {
  BALANCE_ACTIONS,
  BATTERY_TYPES,
  CHARGE_STATUSES,
  PROFILE,
  SAMPLE_HEX,
  decodeFrame,
  decodeSamples,
  hexToBytes,
  toHex
} from './protocol.js';

const elements = Object.fromEntries(
  [
    'connect', 'disconnect', 'status', 'count', 'errorCount', 'error', 'linkLog', 'connectionNote',
    'demo', 'fileName', 'rows', 'logMode', 'startLog', 'stopLog', 'logState',
    'chips', 'cellChips', 'chart', 'cells', 'cellTemplate', 'cellSummary',
    'fileChoice', 'logKind', 'raw-failure',
    'crc-settings', 'counter-settings', 'raw-settings', 'undecoded-settings',
    'crc-cell', 'counter-cell', 'raw-cell', 'undecoded-cell',
    'crc-device', 'counter-device', 'raw-device', 'undecoded-device',
    'crc-logbook', 'counter-logbook', 'raw-logbook', 'undecoded-logbook'
  ].map((id) => [id, document.getElementById(id)])
);

const deviceElements = Object.fromEntries(
  ['model', 'hardware', 'software', 'serial', 'manufactured', 'powerOns', 'runtime', 'layout']
    .map((id) => [id, document.getElementById(`device-${id}`)])
);

const metricElements = Object.fromEntries(
  [
    'voltage', 'current', 'power', 'soc', 'remaining', 'fullCapacity', 'cycles', 'cycleCapacity', 'soh',
    'delta', 'minCell', 'minCellIndex', 'maxCell', 'maxCellIndex', 'mosfetTemperature',
    't1', 't2', 't3', 't4', 't5', 'balanceCurrent', 'balanceAction',
    'chargeMosfet', 'dischargeMosfet', 'precharge', 'heating', 'batteryType', 'chargeStatus', 'errors'
  ].map((id) => [id, document.getElementById(`metric-${id}`)])
);

const PACKET_SUFFIX = {
  settings: 'settings',
  cellInfo: 'cell',
  deviceInfo: 'device',
  logbook: 'logbook'
};

const FRAME_TYPE = {
  0x01: 'settings',
  0x02: 'cellInfo',
  0x03: 'deviceInfo',
  0x05: 'logbook'
};

const LINK_LOG_SIZE = 8;

let packetCount = 0;
let errorCount = 0;
let settings = null;
let deviceInfo = null;
let cellInfo = null;
let lastCellBytes = null;
let cellChipCount = -1;
const linkEvents = [];

const chart = await createChart(elements.chart);
const logger = createLogger({
  onFile: (name) => {
    elements.fileName.textContent = name;
  },
  onRows: (count) => {
    elements.rows.textContent = String(count);
  },
  onError: (error) => {
    elements.error.textContent = error?.message || String(error);
  }
});

const ble = createBle({
  profile: PROFILE,
  onPacket: (bytes) => {
    try {
      handleFrame(bytes);
    } catch (error) {
      noteError(error);
    }
  },
  onLink: ({ state, message }) => {
    elements.status.textContent = message;
    setLinkState(state);
    if (state !== 'selecting' && state !== 'connecting') addLinkEvent(state, message);
  }
});

function setLinkState(state) {
  elements.connect.disabled = state !== 'disconnected';
  elements.disconnect.disabled = state === 'disconnected' || state === 'selecting';
}

function addLinkEvent(state, message) {
  linkEvents.unshift({ state, message, time: formatClock(new Date()) });
  linkEvents.length = Math.min(linkEvents.length, LINK_LOG_SIZE);
  elements.linkLog.replaceChildren(...linkEvents.map((event) => {
    const item = document.createElement('li');
    item.className = event.state;
    const time = document.createElement('time');
    time.textContent = event.time;
    item.append(time, document.createTextNode(event.message));
    return item;
  }));
}

function syncLogButtons() {
  const logging = logger.isLogging();
  elements.startLog.disabled = logging;
  elements.stopLog.disabled = !logging;
  elements.logState.textContent = logging ? 'Logging' : logger.hasFile() ? 'Ready' : 'No file';
}

function showError(error) {
  if (error?.name === 'AbortError') return;
  elements.error.textContent = error?.message || String(error);
}

function noteError(error) {
  errorCount += 1;
  elements.errorCount.textContent = String(errorCount);
  showError(error);
}

function formatFixed(value, digits, unit) {
  if (value == null || Number.isNaN(value)) return '—';
  return `${Number(value).toFixed(digits)}${unit ? ` ${unit}` : ''}`;
}

function formatClock(date) {
  const pad = (value) => String(value).padStart(2, '0');
  return `${pad(date.getDate())}.${pad(date.getMonth() + 1)}.${date.getFullYear()} ${pad(date.getHours())}:${pad(date.getMinutes())}:${pad(date.getSeconds())}`;
}

function formatDuration(seconds) {
  if (seconds == null || !Number.isFinite(Number(seconds))) return '—';
  const total = Math.max(0, Math.floor(Number(seconds)));
  const hours = Math.floor(total / 3600);
  const minutes = Math.floor((total % 3600) / 60);
  const secs = total % 60;
  const pad = (value) => String(value).padStart(2, '0');
  return `${String(hours).padStart(3, '0')}:${pad(minutes)}:${pad(secs)}`;
}

function formatMade(text) {
  if (!/^\d{6}$/.test(text || '')) return text || '—';
  return `${text.slice(4, 6)}.${text.slice(2, 4)}.20${text.slice(0, 2)}`;
}

function named(list, value) {
  if (value == null || Number.isNaN(value)) return '—';
  return list[value] || String(value);
}

function onOff(value) {
  if (value == null) return '—';
  return value ? 'On' : 'Off';
}

function formatHex(bytes) {
  const lines = [];
  for (let offset = 0; offset < bytes.length; offset += 16) {
    const words = [];
    const end = Math.min(offset + 16, bytes.length);
    for (let index = offset; index < end; index += 1) words.push(toHex(bytes, index, index + 1));
    lines.push(words.join(' '));
  }
  return lines.join('\n');
}

function formatUndecoded(runs) {
  if (!runs?.length) return 'None';
  return runs.map((run) => `${run.offset}: ${run.hex}`).join('\n');
}

function showPacket(type, record, bytes) {
  const suffix = PACKET_SUFFIX[type];
  if (!suffix) return;
  elements[`crc-${suffix}`].textContent = 'passed';
  elements[`crc-${suffix}`].className = 'crc ok';
  elements[`counter-${suffix}`].textContent = String(record.counter);
  elements[`raw-${suffix}`].textContent = formatHex(bytes);
  elements[`undecoded-${suffix}`].textContent = formatUndecoded(record.undecoded);
}

function showFailure(error) {
  errorCount += 1;
  elements.errorCount.textContent = String(errorCount);
  const frame = error.frame instanceof Uint8Array ? error.frame : null;
  elements['raw-failure'].textContent = frame ? formatHex(frame) : (error.message || 'Checksum failed');
  const type = FRAME_TYPE[error.frameType];
  const suffix = PACKET_SUFFIX[type];
  if (!suffix) return;
  elements[`crc-${suffix}`].textContent = 'failed';
  elements[`crc-${suffix}`].className = 'crc bad';
  elements[`counter-${suffix}`].textContent = error.counter == null ? '—' : String(error.counter);
  if (frame) elements[`raw-${suffix}`].textContent = formatHex(frame);
}

function decodeOptions() {
  return {
    layout: deviceInfo?.layout,
    cellCount: settings?.cellCount
  };
}

function renderDevice() {
  deviceElements.model.textContent = deviceInfo?.model || '—';
  deviceElements.hardware.textContent = deviceInfo?.hardwareVersion || '—';
  deviceElements.software.textContent = deviceInfo?.softwareVersion || '—';
  deviceElements.serial.textContent = deviceInfo?.serialNumber || '—';
  deviceElements.manufactured.textContent = formatMade(deviceInfo?.manufacturingDate);
  deviceElements.powerOns.textContent = deviceInfo ? String(deviceInfo.powerOnCount) : '—';
  const runtime = cellInfo?.runtime ?? deviceInfo?.uptime;
  deviceElements.runtime.textContent = formatDuration(runtime);
  if (!deviceInfo?.layout) deviceElements.layout.textContent = '—';
  else deviceElements.layout.textContent = deviceInfo.layoutVerified ? deviceInfo.layout : `${deviceInfo.layout} (unverified)`;
}

function renderMetrics(record) {
  metricElements.voltage.textContent = formatFixed(record.voltage, 3, 'V');
  metricElements.current.textContent = formatFixed(record.current, 3, 'A');
  metricElements.power.textContent = formatFixed(record.power, 1, 'W');
  metricElements.soc.textContent = formatFixed(record.soc, 0, '%');
  metricElements.remaining.textContent = formatFixed(record.remainingCapacity, 3, 'Ah');
  metricElements.fullCapacity.textContent = formatFixed(record.fullCapacity, 3, 'Ah');
  metricElements.cycles.textContent = record.cycles == null ? '—' : String(record.cycles);
  metricElements.cycleCapacity.textContent = formatFixed(record.cycleCapacity, 3, 'Ah');
  metricElements.soh.textContent = formatFixed(record.soh, 0, '%');
  metricElements.delta.textContent = formatFixed(record.deltaVoltage, 3, 'V');
  metricElements.minCell.textContent = formatFixed(record.minVoltage, 3, 'V');
  metricElements.minCellIndex.textContent = record.minCellIndex == null ? '—' : `Cell ${record.minCellIndex + 1}`;
  metricElements.maxCell.textContent = formatFixed(record.maxVoltage, 3, 'V');
  metricElements.maxCellIndex.textContent = record.maxCellIndex == null ? '—' : `Cell ${record.maxCellIndex + 1}`;
  metricElements.mosfetTemperature.textContent = formatFixed(record.mosfetTemperature, 1, '°C');
  metricElements.t1.textContent = formatFixed(record.t1, 1, '°C');
  metricElements.t2.textContent = formatFixed(record.t2, 1, '°C');
  metricElements.t3.textContent = formatFixed(record.t3, 1, '°C');
  metricElements.t4.textContent = formatFixed(record.t4, 1, '°C');
  metricElements.t5.textContent = formatFixed(record.t5, 1, '°C');
  metricElements.balanceCurrent.textContent = formatFixed(record.balanceCurrent, 3, 'A');
  metricElements.balanceAction.textContent = named(BALANCE_ACTIONS, record.balanceAction);
  metricElements.chargeMosfet.textContent = onOff(record.chargeMosfet);
  metricElements.dischargeMosfet.textContent = onOff(record.dischargeMosfet);
  metricElements.precharge.textContent = onOff(record.precharge);
  metricElements.heating.textContent = onOff(record.heating);
  metricElements.batteryType.textContent = named(BATTERY_TYPES, record.batteryType);
  metricElements.chargeStatus.textContent = named(CHARGE_STATUSES, record.chargeStatus);
  metricElements.errors.textContent = !record.errors ? 'none' : record.errorsHex;
}

function renderCells(record) {
  const nodes = record.cells.map((cell) => {
    const node = elements.cellTemplate.content.firstElementChild.cloneNode(true);
    node.querySelector('.name').textContent = `Cell ${cell.index + 1}`;
    node.querySelector('.value').textContent = formatFixed(cell.voltage, 3, 'V');
    node.querySelector('.detail').textContent = formatFixed(cell.resistance, 3, 'Ω');
    if (!cell.enabled) node.classList.add('off');
    if (cell.index === record.minCellIndex) node.classList.add('min');
    if (cell.index === record.maxCellIndex) node.classList.add('max');
    return node;
  });
  elements.cells.replaceChildren(...nodes);
  elements.cellSummary.textContent = record.cells.length
    ? `${record.cellCount} cells · average ${formatFixed(record.averageVoltage, 3, 'V')} · delta ${formatFixed(record.deltaVoltage, 3, 'V')}`
    : 'Waiting for cell data…';
}

function syncCellChips(count) {
  if (count === cellChipCount) return;
  cellChipCount = count;
  const buttons = [];
  for (let index = 0; index < count; index += 1) {
    const spec = cellSeries(index);
    const button = document.createElement('button');
    button.type = 'button';
    button.dataset.series = spec.key;
    button.setAttribute('aria-pressed', 'false');
    button.textContent = spec.label;
    buttons.push(button);
  }
  elements.cellChips.replaceChildren(...buttons);
}

function acceptCell(record, { demo = false, time = Date.now(), refresh = false } = {}) {
  cellInfo = record;
  const count = settings?.cellCount || record.cellCount;
  if (count) {
    logger.setCellCount(count);
    chart.setCellCount(count);
    syncCellChips(count);
  }
  renderMetrics(record);
  renderCells(record);
  renderDevice();
  // A later settings or device-info frame only corrects this reading. It is not a new sample.
  if (refresh) return;
  chart.push(record, time);
  if (!demo) logger.onRecord(record, new Date(time));
}

function countPacket() {
  packetCount += 1;
  elements.count.textContent = String(packetCount);
}

function applyRecord(record, bytes, options = {}) {
  countPacket();
  showPacket(record.type, record, bytes);
  if (record.type === 'settings') {
    settings = record;
    if (lastCellBytes) redecodeCell(options);
    return;
  }
  if (record.type === 'deviceInfo') {
    deviceInfo = record;
    renderDevice();
    if (lastCellBytes) redecodeCell(options);
    return;
  }
  if (record.type === 'cellInfo') {
    lastCellBytes = Uint8Array.from(bytes);
    acceptCell(record, options);
  }
}

function redecodeCell(options) {
  try {
    const record = decodeFrame(lastCellBytes, decodeOptions());
    showPacket('cellInfo', record, lastCellBytes);
    acceptCell(record, { ...options, refresh: true });
  } catch (error) {
    if (error?.crcOk === false) showFailure(error);
    else noteError(error);
  }
}

function handleFrame(bytes) {
  try {
    const record = decodeFrame(bytes, decodeOptions());
    elements.error.textContent = '';
    applyRecord(record, bytes);
  } catch (error) {
    if (error?.crcOk === false) {
      showFailure(error);
      return;
    }
    throw error;
  }
}

function showSamples() {
  const samples = decodeSamples();
  deviceInfo = samples.deviceInfo;
  settings = samples.settings;
  applyRecord(samples.deviceInfo, hexToBytes(SAMPLE_HEX.deviceInfo), { demo: true });
  applyRecord(samples.settings, hexToBytes(SAMPLE_HEX.settings), { demo: true });
  applyRecord(samples.cellInfo, hexToBytes(SAMPLE_HEX.cellInfo), { demo: true });
}

function askFileChoice({ name, canAppend }) {
  return ask(elements.fileChoice, {
    message: canAppend
      ? `${name} already has this JK-BMS log. Append new rows, or override the file?`
      : `${name} is not a JK-BMS log for this cell count. Override it to start a new log, or cancel.`,
    hide: canAppend ? [] : ['append']
  });
}

async function guarded(action) {
  try {
    elements.error.textContent = '';
    await action();
  } catch (error) {
    showError(error);
  }
}

function onChipClick(event) {
  const button = event.target.closest('button[data-series]');
  if (!button || !event.currentTarget.contains(button)) return;
  const next = button.getAttribute('aria-pressed') !== 'true';
  const shown = chart.setVisible(button.dataset.series, next);
  button.setAttribute('aria-pressed', shown ? 'true' : 'false');
}

let startingLog = false;

elements.connect.addEventListener('click', () => guarded(() => ble.connect()));
elements.disconnect.addEventListener('click', () => guarded(() => ble.disconnect()));
elements.demo.addEventListener('click', () => guarded(async () => {
  showSamples();
}));
elements.logMode.addEventListener('change', () => guarded(async () => {
  await logger.flushPartial();
  logger.setIntervalSeconds(Number(elements.logMode.value));
}));
elements.startLog.addEventListener('click', () => guarded(async () => {
  if (startingLog || logger.isLogging()) return;
  startingLog = true;
  elements.startLog.disabled = true;
  try {
    const kind = await ask(elements.logKind);
    if (!kind) return;
    logger.setIntervalSeconds(Number(elements.logMode.value));
    await logger.openForLogging(kind, askFileChoice);
  } finally {
    startingLog = false;
    syncLogButtons();
  }
}));
elements.stopLog.addEventListener('click', () => guarded(async () => {
  await logger.stop();
  syncLogButtons();
}));
elements.chips.addEventListener('click', onChipClick);
elements.cellChips.addEventListener('click', onChipClick);

window.addEventListener('pagehide', () => {
  logger.flushPartial();
  ble.shutdown();
});

const missing = [];
if (!navigator.bluetooth) {
  missing.push('Web Bluetooth is unavailable in this browser. Use Chrome or Edge on a computer, or Chrome on Android. iPhone and iPad cannot connect.');
}
if (!window.showSaveFilePicker) {
  missing.push('Saving a log file is unavailable in this browser. Use Chrome or Edge.');
}
if (missing.length) elements.error.textContent = missing.join(' ');

setTimeout(() => {
  elements.connectionNote.hidden = true;
}, 10000);

logger.setIntervalSeconds(Number(elements.logMode.value));
setLinkState('disconnected');
syncLogButtons();
