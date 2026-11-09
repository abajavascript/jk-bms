const UPLOT_URL = 'https://cdn.jsdelivr.net/npm/uplot@1.6.32/dist/uPlot.esm.js';

// JK02_32S holds at most 32 cells. Chip colors are the same custom properties.
export const MAX_CELLS = 32;
const GAP_SECONDS = 3;
const AXIS_FONT = '11px system-ui, sans-serif';
const TICK_SPACE = 72;

export const SERIES = {
  voltage: { label: 'Voltage', unit: 'V', digits: 3, colorVar: '--series-voltage', defaultOn: true },
  current: { label: 'Current', unit: 'A', digits: 3, colorVar: '--series-current', defaultOn: true },
  power: { label: 'Power', unit: 'W', digits: 1, colorVar: '--series-power', defaultOn: true },
  soc: { label: 'SOC', unit: '%', digits: 0, colorVar: '--series-soc', defaultOn: true },
  deltaVoltage: { label: 'Cell delta', unit: 'V', digits: 3, colorVar: '--series-delta', defaultOn: false },
  mosfetTemperature: { label: 'MOS temperature', unit: '°C', digits: 1, colorVar: '--series-mosfet', defaultOn: false },
  t1: { label: 'T1', unit: '°C', digits: 1, colorVar: '--series-t1', defaultOn: false },
  t2: { label: 'T2', unit: '°C', digits: 1, colorVar: '--series-t2', defaultOn: false },
  t3: { label: 'T3', unit: '°C', digits: 1, colorVar: '--series-t3', defaultOn: false },
  t4: { label: 'T4', unit: '°C', digits: 1, colorVar: '--series-t4', defaultOn: false },
  t5: { label: 'T5', unit: '°C', digits: 1, colorVar: '--series-t5', defaultOn: false }
};

export function cellSeries(index) {
  const number = index + 1;
  const key = `cell-${String(number).padStart(2, '0')}`;
  return {
    key,
    label: `Cell ${number}`,
    unit: 'V',
    digits: 3,
    colorVar: `--series-${key}`,
    defaultOn: false
  };
}

export function seriesKeysFor(cellCount) {
  const count = clampCellCount(cellCount);
  const keys = Object.keys(SERIES);
  if (count == null) return keys;
  for (let index = 0; index < count; index += 1) keys.push(cellSeries(index).key);
  return keys;
}

export function readingOf(sample, key) {
  if (typeof key === 'string' && key.startsWith('cell-')) {
    const index = Number(key.slice(5)) - 1;
    if (!Number.isInteger(index) || index < 0) return null;
    return finiteOrNull(sample?.cells?.[index]?.voltage);
  }
  return finiteOrNull(sample?.[key]);
}

export async function createChart(container) {
  let UPlot;
  try {
    UPlot = (await import(UPLOT_URL)).default;
  } catch (error) {
    console.warn(error);
    showLibraryError(container);
    return {
      push() {},
      clear() {},
      setVisible() { return false; },
      setCellCount() { return 0; },
      cellCount: () => 0
    };
  }

  const empty = ensureEmpty(container);
  const specs = new Map();
  const columns = {};
  const visible = {};
  const xs = [];
  let cellCount = 0;
  let origin = null;
  let lastT = null;
  let plot = null;
  let plotKeys = [];
  let frame = 0;
  const wideQuery = window.matchMedia('(min-width: 720px)');

  for (const [key, spec] of Object.entries(SERIES)) addSpec({ key, ...spec });

  function addSpec(spec) {
    specs.set(spec.key, spec);
    columns[spec.key] = Array(xs.length).fill(null);
    visible[spec.key] = spec.defaultOn;
  }

  function visibleKeys() {
    return [...specs.keys()].filter((key) => visible[key]);
  }

  function aligned(keys) {
    return [xs, ...keys.map((key) => columns[key])];
  }

  function sameKeys(keys) {
    return plotKeys.length === keys.length && plotKeys.every((key, index) => key === keys[index]);
  }

  function plotHeight() {
    return wideQuery.matches ? 320 : 240;
  }

  function destroyPlot() {
    if (!plot) return;
    plot.destroy();
    plot = null;
    plotKeys = [];
  }

  function mount(keys) {
    const width = Math.floor(container.clientWidth);
    if (width < 2 || !keys.length || !xs.length) return false;
    destroyPlot();
    plotKeys = keys.slice();
    plot = new UPlot(chartOptions(keys, width, plotHeight()), aligned(keys), container);
    return true;
  }

  function paint() {
    if (!xs.length) {
      empty.hidden = false;
      destroyPlot();
      return;
    }
    const keys = visibleKeys();
    if (!plot || !sameKeys(keys)) {
      empty.hidden = mount(keys);
      return;
    }
    plot.setData(aligned(keys));
    empty.hidden = true;
  }

  function scheduleDraw() {
    if (frame) return;
    frame = requestAnimationFrame(() => {
      frame = 0;
      paint();
    });
  }

  function ensureOneVisible() {
    if ([...specs.keys()].some((key) => visible[key])) return;
    if (specs.has('voltage')) visible.voltage = true;
  }

  function applyCellCount(count, draw) {
    const next = clampCellCount(count);
    if (next == null || next === cellCount) return cellCount;
    while (cellCount < next) {
      addSpec(cellSeries(cellCount));
      cellCount += 1;
    }
    while (cellCount > next) {
      cellCount -= 1;
      const key = cellSeries(cellCount).key;
      specs.delete(key);
      delete columns[key];
      delete visible[key];
    }
    ensureOneVisible();
    if (frame) {
      cancelAnimationFrame(frame);
      frame = 0;
    }
    if (draw && xs.length) paint();
    return cellCount;
  }

  function push(sample, timeMs) {
    const reported = Array.isArray(sample?.cells) ? sample.cells.length : 0;
    if (reported > cellCount) applyCellCount(Math.min(reported, MAX_CELLS), false);
    let t = timeMs / 1000;
    if (lastT != null && t <= lastT) t = lastT + 0.001;
    if (origin == null) origin = t;
    // A gap longer than 3 s breaks every line. uPlot treats null as a break.
    if (lastT != null && t - lastT > GAP_SECONDS) {
      xs.push(lastT + 0.001);
      for (const key of specs.keys()) columns[key].push(null);
    }
    xs.push(t);
    for (const key of specs.keys()) columns[key].push(readingOf(sample, key));
    lastT = t;
    scheduleDraw();
  }

  function clear() {
    xs.length = 0;
    for (const key of Object.keys(columns)) columns[key].length = 0;
    origin = null;
    lastT = null;
    if (frame) {
      cancelAnimationFrame(frame);
      frame = 0;
    }
    destroyPlot();
    empty.hidden = false;
  }

  function setVisible(key, on) {
    if (!specs.has(key)) return false;
    const next = Boolean(on);
    if (visible[key] === next) return next;
    if (!next && visibleKeys().length <= 1) return true;
    visible[key] = next;
    if (frame) {
      cancelAnimationFrame(frame);
      frame = 0;
    }
    if (xs.length) paint();
    return next;
  }

  function setCellCount(count) {
    return applyCellCount(count, true);
  }

  const observer = new ResizeObserver(() => {
    if (!xs.length) return;
    const width = Math.floor(container.clientWidth);
    const height = plotHeight();
    if (!plot) {
      empty.hidden = mount(visibleKeys());
      return;
    }
    if (width >= 2 && (plot.width !== width || plot.height !== height)) {
      plot.setSize({ width, height });
    }
  });
  observer.observe(container);
  wideQuery.addEventListener('change', () => {
    if (!plot) return;
    plot.setSize({ width: Math.floor(container.clientWidth), height: plotHeight() });
  });

  return { push, clear, setVisible, setCellCount, cellCount: () => cellCount };

  function chartOptions(keys, width, height) {
    return {
      width,
      height,
      scales: scalesFor(keys),
      axes: axesFor(keys),
      series: seriesFor(keys),
      cursor: {
        y: false,
        drag: { x: false, y: false, setScale: false }
      },
      legend: { show: true, live: true }
    };
  }

  function scalesFor(keys) {
    const scales = { x: { time: true } };
    for (const key of keys) scales[key] = { auto: true, range: paddedRange };
    return scales;
  }

  function axesFor(keys) {
    const axes = [
      xAxis(2, clockValues),
      xAxis(0, elapsedValues)
    ];
    keys.forEach((key, index) => {
      const spec = specs.get(key);
      const color = seriesColor(spec);
      axes.push({
        scale: key,
        side: index % 2 === 0 ? 3 : 1,
        stroke: color,
        font: AXIS_FONT,
        size: measureAxis,
        ticks: { stroke: color, width: 1, size: 4 },
        grid: index === 0 ? { stroke: '#1f2937', width: 1 } : { show: false },
        values: tickValues(spec.digits)
      });
    });
    return axes;
  }

  function seriesFor(keys) {
    return [
      {
        label: 'Time',
        value: (u, value) => {
          if (value == null || origin == null) return '—';
          return `${formatElapsed(value - origin)} · ${formatClock(value)}`;
        }
      },
      ...keys.map((key) => {
        const spec = specs.get(key);
        return {
          label: spec.label,
          scale: key,
          stroke: seriesColor(spec),
          width: 2,
          points: { size: 7, width: 2 },
          value: (u, value) => value == null ? '—' : formatReading(value, spec)
        };
      })
    ];
  }

  function clockValues(u, splits) {
    return splits.map((value) => value == null ? '' : formatClock(value));
  }

  function elapsedValues(u, splits) {
    return splits.map((value) => {
      if (value == null || origin == null) return '';
      return formatElapsed(value - origin);
    });
  }
}

function clampCellCount(count) {
  const next = Number(count);
  if (!Number.isInteger(next) || next < 0 || next > MAX_CELLS) return null;
  return next;
}

function finiteOrNull(value) {
  return typeof value === 'number' && Number.isFinite(value) ? value : null;
}

function seriesColor(spec) {
  const value = getComputedStyle(document.documentElement).getPropertyValue(spec.colorVar).trim();
  return value || '#9ca3af';
}

function xAxis(side, values) {
  return {
    scale: 'x',
    side,
    space: TICK_SPACE,
    stroke: '#9ca3af',
    font: AXIS_FONT,
    size: 28,
    ticks: { stroke: '#4b5563', width: 1, size: 4 },
    grid: side === 2 ? { stroke: '#1f2937', width: 1 } : { show: false },
    values
  };
}

function tickValues(digits) {
  return (u, splits) => splits.map((value) => value == null ? '' : Number(value).toFixed(digits));
}

function measureAxis(u, values, axisIdx) {
  if (!values || !values.length) return 58;
  const axis = u.axes[axisIdx];
  if (!axis || axis.side === 0 || axis.side === 2) return 28;
  const context = u.ctx;
  if (!context) return 58;
  const fontSize = Array.isArray(axis.font) ? axis.font[2] : 11;
  context.save();
  context.font = `${fontSize}px system-ui, sans-serif`;
  let longest = 0;
  for (const value of values) {
    if (value == null || value === '') continue;
    longest = Math.max(longest, context.measureText(String(value)).width);
  }
  context.restore();
  return Math.max(40, Math.ceil(longest + 16));
}

function paddedRange(u, min, max) {
  if (min == null || max == null) return [0, 1];
  if (min === max) {
    const cushion = Math.abs(min) * 0.05 || 1;
    return [min - cushion, max + cushion];
  }
  const span = max - min;
  return [min - span * 0.08, max + span * 0.08];
}

function formatReading(value, spec) {
  const text = Number(value).toFixed(spec.digits);
  return spec.unit ? `${text} ${spec.unit}` : text;
}

function formatClock(seconds) {
  const date = new Date(seconds * 1000);
  const pad = (value) => String(value).padStart(2, '0');
  return `${pad(date.getHours())}:${pad(date.getMinutes())}:${pad(date.getSeconds())}`;
}

function formatElapsed(seconds) {
  const whole = Math.max(0, Math.floor(seconds));
  const hours = Math.floor(whole / 3600);
  const minutes = Math.floor((whole % 3600) / 60);
  const secs = whole % 60;
  const pad = (value) => String(value).padStart(2, '0');
  if (hours > 0) return `${hours}:${pad(minutes)}:${pad(secs)}`;
  return `${minutes}:${pad(secs)}`;
}

function ensureEmpty(container) {
  let empty = container.querySelector('.chart-empty');
  if (!empty) {
    empty = document.createElement('p');
    empty.className = 'chart-empty';
    empty.textContent = 'Waiting for data';
    container.prepend(empty);
  }
  return empty;
}

function showLibraryError(container) {
  container.replaceChildren();
  const note = document.createElement('p');
  note.className = 'chart-empty';
  note.textContent = 'Chart library failed to load.';
  container.append(note);
}
