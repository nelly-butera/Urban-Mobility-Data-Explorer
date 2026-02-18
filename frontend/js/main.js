/**
 * NYC TAXI MOBILITY ANALYTICS — main.js
 * ────────────────────────────────────────────────────────
 * Sections:
 *  1. DATA UTILITIES
 *  2. CHART RENDERING FUNCTIONS
 *  3. PAGE INITIALIZERS
 *  4. EVENT LISTENERS
 * ────────────────────────────────────────────────────────
 */

'use strict';

/* 1. DATA UTILITIES */

const DATA = {
  boroughs: ['Manhattan', 'Brooklyn', 'Queens', 'Bronx', 'Staten Island'],

  boroughColors: {
    'Manhattan':    '#f5c518',
    'Brooklyn':     '#60a5fa',
    'Queens':       '#3dd68c',
    'Bronx':        '#f97316',
    'Staten Island':'#a78bfa',
  },

  zones: [
    'Midtown Center',    'Times Sq/Theatre District', 'Upper East Side North',
    'JFK Airport',       'LaGuardia Airport',          'East Village',
    'West Village',      'Financial District',          'Williamsburg',
    'Astoria',           'Flushing',                    'Crown Heights',
    'Park Slope',        'Bushwick',                    'Fordham',
    'Co-op City',        'Hunts Point',                 'Concourse',
    'St. George',        'Tottenville',
  ],

  anomalyTypes: [
    'Abnormal Fare',
    'Duplicate Trip',
    'GPS Mismatch',
    'Zero Distance',
    'Negative Duration',
    'Excessive Tip',
  ],

  /* Trips over time (30 days) */
  tripsOverTime: (() => {
    const labels = [];
    const values = [];
    const base = new Date(2024, 0, 1);
    for (let i = 0; i < 30; i++) {
      const d = new Date(base);
      d.setDate(d.getDate() + i);
      labels.push(d.toLocaleDateString('en-US', { month: 'short', day: 'numeric' }));
      values.push(Math.round(68000 + Math.sin(i * 0.7) * 12000 + Math.random() * 8000));
    }
    return { labels, values };
  })(),

  /* Trips by borough */
  tripsByBorough: {
    'Manhattan':    482341,
    'Queens':       198762,
    'Brooklyn':     142903,
    'Bronx':         47211,
    'Staten Island':  9128,
  },

  /* Top pickup zones */
  topZones: [
    { zone: 'Midtown Center',              borough: 'Manhattan',     trips: 54832, revenue: 3.82, farePerMile: 4.21, avgTip: 18.4 },
    { zone: 'Times Sq/Theatre District',   borough: 'Manhattan',     trips: 47201, revenue: 3.71, farePerMile: 4.09, avgTip: 17.2 },
    { zone: 'JFK Airport',                 borough: 'Queens',        trips: 38940, revenue: 4.14, farePerMile: 3.88, avgTip: 15.6 },
    { zone: 'Upper East Side North',       borough: 'Manhattan',     trips: 36712, revenue: 3.55, farePerMile: 4.33, avgTip: 19.1 },
    { zone: 'LaGuardia Airport',           borough: 'Queens',        trips: 29801, revenue: 3.91, farePerMile: 3.97, avgTip: 14.8 },
    { zone: 'East Village',                borough: 'Manhattan',     trips: 24103, revenue: 3.42, farePerMile: 3.76, avgTip: 16.9 },
    { zone: 'West Village',                borough: 'Manhattan',     trips: 21876, revenue: 3.38, farePerMile: 3.82, avgTip: 20.3 },
    { zone: 'Financial District',          borough: 'Manhattan',     trips: 19542, revenue: 3.29, farePerMile: 3.65, avgTip: 15.1 },
    { zone: 'Williamsburg',                borough: 'Brooklyn',      trips: 16234, revenue: 3.01, farePerMile: 3.44, avgTip: 14.3 },
    { zone: 'Astoria',                     borough: 'Queens',        trips: 14109, revenue: 2.88, farePerMile: 3.31, avgTip: 13.7 },
  ],

  /* Revenue per minute by hour */
  revByHour: (() => {
    const hrs = Array.from({ length: 24 }, (_, i) => `${String(i).padStart(2,'0')}:00`);
    const vals = [1.8, 1.5, 1.3, 1.2, 1.4, 2.1, 3.0, 3.8, 4.1, 3.9, 3.7, 3.9,
                  4.2, 4.0, 3.8, 3.7, 3.9, 4.3, 4.6, 4.4, 4.1, 3.7, 3.2, 2.6];
    return { labels: hrs, values: vals };
  })(),

  /* Rev per minute by borough */
  revByBorough: {
    'Manhattan':    4.14,
    'Queens':       3.21,
    'Brooklyn':     2.97,
    'Bronx':        2.44,
    'Staten Island':2.01,
  },

  /* Tip % by borough */
  tipByBorough: {
    'Manhattan':    18.6,
    'Brooklyn':     14.8,
    'Queens':       13.2,
    'Bronx':        10.4,
    'Staten Island': 9.7,
  },

  /* Tip % by hour */
  tipByHour: (() => {
    const hrs = Array.from({ length: 24 }, (_, i) => `${String(i).padStart(2,'0')}:00`);
    const vals = [22.1, 24.3, 26.8, 25.4, 18.2, 13.1, 12.4, 14.2, 15.8, 16.2, 16.7, 17.1,
                  17.8, 17.4, 17.0, 16.9, 17.3, 18.4, 19.2, 20.1, 21.8, 22.9, 23.4, 22.8];
    return { labels: hrs, values: vals };
  })(),

  /* Card vs Cash tips */
  paymentTips: {
    boroughs: ['Manhattan', 'Brooklyn', 'Queens', 'Bronx', 'Staten Island'],
    card: [20.4, 16.1, 14.7, 11.8, 10.9],
    cash: [5.2,  3.8,  3.1,  2.4,  2.1],
  },

  /* Anomalies */
  anomalyBreakdown: {
    'Abnormal Fare':     1842,
    'Duplicate Trip':     634,
    'GPS Mismatch':      1127,
    'Zero Distance':      388,
    'Negative Duration':  209,
    'Excessive Tip':      743,
  },

  flaggedTrips: [
    { id: 'TXN-00482', zone: 'Times Sq/Theatre District', type: 'Abnormal Fare',    fare: 284.50, tip: 12.0,  severity: 'high',   note: 'Fare 8× median for route' },
    { id: 'TXN-01203', zone: 'JFK Airport',               type: 'GPS Mismatch',     fare: 52.00,  tip: 18.5,  severity: 'medium', note: 'Pickup/dropoff coords swapped' },
    { id: 'TXN-01881', zone: 'Midtown Center',            type: 'Duplicate Trip',   fare: 14.50,  tip: 3.0,   severity: 'high',   note: 'Exact duplicate at T+00:02' },
    { id: 'TXN-02914', zone: 'East Village',              type: 'Zero Distance',    fare: 8.00,   tip: 0.0,   severity: 'medium', note: 'Trip distance = 0.00 mi' },
    { id: 'TXN-03327', zone: 'Upper East Side North',     type: 'Excessive Tip',    fare: 11.00,  tip: 98.2,  severity: 'high',   note: 'Tip exceeds fare by 893%' },
    { id: 'TXN-04019', zone: 'LaGuardia Airport',         type: 'GPS Mismatch',     fare: 38.50,  tip: 7.5,   severity: 'medium', note: 'Route intersects water body' },
    { id: 'TXN-04522', zone: 'Williamsburg',              type: 'Negative Duration',fare: 9.50,   tip: 1.5,   severity: 'high',   note: 'End time precedes start time' },
    { id: 'TXN-05210', zone: 'Astoria',                   type: 'Abnormal Fare',    fare: 142.00, tip: 5.0,   severity: 'medium', note: 'Fare 5× median for route' },
    { id: 'TXN-05987', zone: 'Financial District',        type: 'Duplicate Trip',   fare: 22.00,  tip: 4.0,   severity: 'high',   note: 'Exact duplicate at T+00:01' },
    { id: 'TXN-06441', zone: 'Fordham',                   type: 'Abnormal Fare',    fare: 0.50,   tip: 0.0,   severity: 'low',    note: 'Fare below minimum threshold' },
    { id: 'TXN-07102', zone: 'Park Slope',                type: 'Zero Distance',    fare: 5.00,   tip: 0.0,   severity: 'low',    note: 'Trip distance = 0.00 mi' },
    { id: 'TXN-07893', zone: 'Crown Heights',             type: 'GPS Mismatch',     fare: 18.00,  tip: 3.5,   severity: 'low',    note: 'Drop-off outside NYC bounds' },
  ],

  /* KPI Summary */
  kpi: {
    totalTrips:        880345,
    avgFare:           18.42,
    avgDistance:        3.71,
    revenuePerMinute:   3.82,
    flaggedCount:       4943,
    flaggedPct:          0.56,
  },
};

/* Utility: format numbers */
const fmt = {
  num:  (n) => n.toLocaleString(),
  usd:  (n) => `$${n.toFixed(2)}`,
  pct:  (n) => `${n.toFixed(1)}%`,
  mi:   (n) => `${n.toFixed(2)} mi`,
  rpm:  (n) => `$${n.toFixed(2)}/min`,
};

/* Utility: custom sort */
function sortData(arr, key, dir = 'desc') {
  return [...arr].sort((a, b) => {
    const va = typeof a[key] === 'string' ? a[key].toLowerCase() : a[key];
    const vb = typeof b[key] === 'string' ? b[key].toLowerCase() : b[key];
    if (va < vb) return dir === 'asc' ? -1 : 1;
    if (va > vb) return dir === 'asc' ? 1 : -1;
    return 0;
  });
}

/* Utility: get canvas 2D context */
function getCtx(id) {
  const el = document.getElementById(id);
  if (!el) return null;
  return { el, ctx: el.getContext('2d') };
}

/* Utility: device pixel ratio scaling */
function setupCanvas(el, w, h) {
  const dpr = window.devicePixelRatio || 1;
  el.width  = w * dpr;
  el.height = h * dpr;
  el.style.width  = w + 'px';
  el.style.height = h + 'px';
  const ctx = el.getContext('2d');
  ctx.scale(dpr, dpr);
  return ctx;
}

/* Utility: get element width */
function elWidth(el) {
  return el.parentElement.clientWidth || 600;
}


/* 2. CHART RENDERING FUNCTIONS */

/**
 * LINE CHART
 * @param {string} canvasId
 * @param {string[]} labels
 * @param {Array<{values: number[], color: string, label: string}>} series
 * @param {object} opts
 */
function renderLineChart(canvasId, labels, series, opts = {}) {
  const container = document.getElementById(canvasId);
  if (!container) return;
  const W = elWidth(container);
  const H = opts.height || 220;
  const ctx = setupCanvas(container, W, H);
  const PAD = { top: 20, right: 20, bottom: 44, left: 56 };
  const innerW = W - PAD.left - PAD.right;
  const innerH = H - PAD.top  - PAD.bottom;

  const allVals = series.flatMap(s => s.values);
  const minV = opts.minY !== undefined ? opts.minY : Math.min(...allVals) * 0.9;
  const maxV = Math.max(...allVals) * 1.05;

  const xPos = (i) => PAD.left + (i / (labels.length - 1)) * innerW;
  const yPos = (v) => PAD.top  + innerH - ((v - minV) / (maxV - minV)) * innerH;

  // Grid
  ctx.strokeStyle = 'rgba(42,47,61,0.8)';
  ctx.lineWidth = 1;
  const ticks = 5;
  for (let t = 0; t <= ticks; t++) {
    const y = PAD.top + (t / ticks) * innerH;
    ctx.beginPath();
    ctx.moveTo(PAD.left, y);
    ctx.lineTo(PAD.left + innerW, y);
    ctx.stroke();
    const val = maxV - (t / ticks) * (maxV - minV);
    ctx.fillStyle = '#555b6e';
    ctx.font = '10px Share Tech Mono, monospace';
    ctx.textAlign = 'right';
    ctx.fillText(opts.yFmt ? opts.yFmt(val) : val.toFixed(0), PAD.left - 8, y + 4);
  }

  // X Labels
  const step = Math.max(1, Math.floor(labels.length / 8));
  ctx.fillStyle = '#555b6e';
  ctx.font = '9px Share Tech Mono, monospace';
  ctx.textAlign = 'center';
  labels.forEach((l, i) => {
    if (i % step === 0) ctx.fillText(l, xPos(i), H - 10);
  });

  // Series
  series.forEach((s) => {
    // Gradient fill
    const grad = ctx.createLinearGradient(0, PAD.top, 0, PAD.top + innerH);
    const hexToRgb = (hex) => {
      const r = parseInt(hex.slice(1,3),16);
      const g = parseInt(hex.slice(3,5),16);
      const b = parseInt(hex.slice(5,7),16);
      return `${r},${g},${b}`;
    };
    try {
      grad.addColorStop(0, `rgba(${hexToRgb(s.color)}, 0.25)`);
      grad.addColorStop(1, `rgba(${hexToRgb(s.color)}, 0.0)`);
    } catch { }

    ctx.beginPath();
    s.values.forEach((v, i) => {
      i === 0 ? ctx.moveTo(xPos(i), yPos(v)) : ctx.lineTo(xPos(i), yPos(v));
    });
    ctx.lineTo(xPos(s.values.length - 1), PAD.top + innerH);
    ctx.lineTo(xPos(0), PAD.top + innerH);
    ctx.closePath();
    ctx.fillStyle = grad;
    ctx.fill();

    // Line
    ctx.beginPath();
    s.values.forEach((v, i) => {
      i === 0 ? ctx.moveTo(xPos(i), yPos(v)) : ctx.lineTo(xPos(i), yPos(v));
    });
    ctx.strokeStyle = s.color;
    ctx.lineWidth = 2;
    ctx.lineJoin = 'round';
    ctx.stroke();
  });

  // Tooltip interaction
  setupLineTooltip(container, labels, series, xPos, yPos, opts.yFmt);
}

function setupLineTooltip(canvas, labels, series, xPos, yPos, yFmt) {
  const tooltip = document.getElementById('global-tooltip');
  if (!tooltip) return;
  canvas.addEventListener('mousemove', (e) => {
    const rect = canvas.getBoundingClientRect();
    const mx = e.clientX - rect.left;
    const dpr = window.devicePixelRatio || 1;
    // Find closest label index
    let best = 0, bestDist = Infinity;
    labels.forEach((_, i) => {
      const d = Math.abs(mx - xPos(i));
      if (d < bestDist) { bestDist = d; best = i; }
    });
    let html = `<div class="tooltip-label">${labels[best]}</div>`;
    series.forEach(s => {
      html += `<div style="color:${s.color};font-size:13px;">${s.label ? s.label + ': ' : ''}${yFmt ? yFmt(s.values[best]) : s.values[best].toLocaleString()}</div>`;
    });
    tooltip.innerHTML = html;
    tooltip.style.left = (e.clientX + 12) + 'px';
    tooltip.style.top  = (e.clientY - 20) + 'px';
    tooltip.classList.add('visible');
  });
  canvas.addEventListener('mouseleave', () => tooltip.classList.remove('visible'));
}

/**
 * BAR CHART
 * @param {string} canvasId
 * @param {string[]} labels
 * @param {number[]} values
 * @param {object} opts
 */
function renderBarChart(canvasId, labels, values, opts = {}) {
  const container = document.getElementById(canvasId);
  if (!container) return;
  const W = elWidth(container);
  const H = opts.height || 220;
  const ctx = setupCanvas(container, W, H);
  const PAD = { top: 20, right: 20, bottom: opts.bottomPad || 44, left: 56 };
  const innerW = W - PAD.left - PAD.right;
  const innerH = H - PAD.top  - PAD.bottom;

  const maxV = Math.max(...values) * 1.1;

  // Grid
  const ticks = 4;
  for (let t = 0; t <= ticks; t++) {
    const y = PAD.top + (t / ticks) * innerH;
    ctx.strokeStyle = 'rgba(42,47,61,0.8)';
    ctx.lineWidth = 1;
    ctx.beginPath();
    ctx.moveTo(PAD.left, y);
    ctx.lineTo(PAD.left + innerW, y);
    ctx.stroke();
    const val = maxV * (1 - t / ticks);
    ctx.fillStyle = '#555b6e';
    ctx.font = '10px Share Tech Mono, monospace';
    ctx.textAlign = 'right';
    ctx.fillText(opts.yFmt ? opts.yFmt(val) : Math.round(val).toLocaleString(), PAD.left - 8, y + 4);
  }

  const gap = opts.gap || 6;
  const barW = (innerW / labels.length) - gap;
  const colors = opts.colors || labels.map((_, i) => {
    const palette = ['#f5c518','#60a5fa','#3dd68c','#f97316','#a78bfa','#f05252'];
    return palette[i % palette.length];
  });

  values.forEach((v, i) => {
    const barH = (v / maxV) * innerH;
    const x = PAD.left + i * (barW + gap);
    const y = PAD.top + innerH - barH;
    const color = Array.isArray(colors) ? colors[i] : colors;

    // Shadow
    ctx.fillStyle = 'rgba(0,0,0,0.3)';
    ctx.fillRect(x + 2, y + 2, barW, barH);

    // Bar
    const grad = ctx.createLinearGradient(0, y, 0, y + barH);
    grad.addColorStop(0, color);
    grad.addColorStop(1, color + '88');
    ctx.fillStyle = grad;
    ctx.beginPath();
    ctx.roundRect(x, y, barW, barH, [3, 3, 0, 0]);
    ctx.fill();

    // Label
    ctx.fillStyle = '#555b6e';
    ctx.font = `${opts.labelFontSize || 10}px Share Tech Mono, monospace`;
    ctx.textAlign = 'center';
    const label = opts.truncate ? labels[i].split(' ')[0] : labels[i];
    ctx.fillText(label, x + barW / 2, H - 8);
  });

  setupBarTooltip(container, labels, values, barW, gap, PAD, opts.yFmt);
}

function setupBarTooltip(canvas, labels, values, barW, gap, PAD, yFmt) {
  const tooltip = document.getElementById('global-tooltip');
  if (!tooltip) return;
  canvas.addEventListener('mousemove', (e) => {
    const rect = canvas.getBoundingClientRect();
    const mx = e.clientX - rect.left;
    const i = Math.floor((mx - PAD.left) / (barW + gap));
    if (i >= 0 && i < labels.length) {
      tooltip.innerHTML = `
        <div class="tooltip-label">${labels[i]}</div>
        <div class="tooltip-value">${yFmt ? yFmt(values[i]) : values[i].toLocaleString()}</div>`;
      tooltip.style.left = (e.clientX + 12) + 'px';
      tooltip.style.top  = (e.clientY - 20) + 'px';
      tooltip.classList.add('visible');
    } else {
      tooltip.classList.remove('visible');
    }
  });
  canvas.addEventListener('mouseleave', () => tooltip.classList.remove('visible'));
}

/**
 * GROUPED BAR CHART (Card vs Cash)
 */
function renderGroupedBarChart(canvasId, labels, groupA, groupB, opts = {}) {
  const container = document.getElementById(canvasId);
  if (!container) return;
  const W = elWidth(container);
  const H = opts.height || 220;
  const ctx = setupCanvas(container, W, H);
  const PAD = { top: 20, right: 20, bottom: 44, left: 56 };
  const innerW = W - PAD.left - PAD.right;
  const innerH = H - PAD.top  - PAD.bottom;

  const maxV = Math.max(...groupA, ...groupB) * 1.15;
  const ticks = 4;
  for (let t = 0; t <= ticks; t++) {
    const y = PAD.top + (t / ticks) * innerH;
    ctx.strokeStyle = 'rgba(42,47,61,0.8)';
    ctx.lineWidth = 1;
    ctx.beginPath();
    ctx.moveTo(PAD.left, y);
    ctx.lineTo(PAD.left + innerW, y);
    ctx.stroke();
    ctx.fillStyle = '#555b6e';
    ctx.font = '10px Share Tech Mono, monospace';
    ctx.textAlign = 'right';
    ctx.fillText(fmt.pct(maxV * (1 - t / ticks)), PAD.left - 6, y + 4);
  }

  const groupW = innerW / labels.length;
  const barW   = (groupW - 12) / 2;
  const colorA = opts.colorA || '#f5c518';
  const colorB = opts.colorB || '#60a5fa';

  labels.forEach((label, i) => {
    const gx = PAD.left + i * groupW;

    [groupA[i], groupB[i]].forEach((v, j) => {
      const barH = (v / maxV) * innerH;
      const x    = gx + 4 + j * (barW + 4);
      const y    = PAD.top + innerH - barH;
      const col  = j === 0 ? colorA : colorB;
      ctx.fillStyle = col;
      ctx.beginPath();
      ctx.roundRect(x, y, barW, barH, [2,2,0,0]);
      ctx.fill();
    });

    ctx.fillStyle = '#555b6e';
    ctx.font = '9px Share Tech Mono, monospace';
    ctx.textAlign = 'center';
    ctx.fillText(label.split(' ')[0], gx + groupW / 2, H - 8);
  });
}


/* ================================================================
   3. PAGE INITIALIZERS
   ================================================================ */

/* ── Overview ── */
function initOverview() {
  // KPI
  const kpis = [
    { label: 'Total Trips',         value: fmt.num(DATA.kpi.totalTrips),       cls: '',       icon: '🚕', delta: '+4.2%', dir: 'up' },
    { label: 'Average Fare',        value: fmt.usd(DATA.kpi.avgFare),           cls: 'accent', icon: '💵', delta: '+1.8%', dir: 'up' },
    { label: 'Avg Trip Distance',   value: fmt.mi(DATA.kpi.avgDistance),        cls: '',       icon: '📍', delta: '-0.3%', dir: 'down' },
    { label: 'Revenue / Min',       value: fmt.rpm(DATA.kpi.revenuePerMinute),  cls: 'accent', icon: '⏱',  delta: '+2.1%', dir: 'up' },
    { label: 'Flagged Trips',       value: fmt.pct(DATA.kpi.flaggedPct),        cls: 'danger', icon: '⚠️', delta: fmt.num(DATA.kpi.flaggedCount), dir: 'down' },
  ];
  const grid = document.getElementById('kpi-grid');
  if (grid) {
    grid.innerHTML = kpis.map(k => `
      <div class="kpi-card animate-in">
        <div class="kpi-label">${k.label}</div>
        <div class="kpi-value ${k.cls}">${k.value}</div>
        <div class="kpi-delta ${k.dir}">
          ${k.dir === 'up' ? '▲' : '▼'} ${k.delta}
        </div>
        <div class="kpi-icon">${k.icon}</div>
      </div>`).join('');
  }

  // Trips over time
  renderLineChart('chart-trips-time', DATA.tripsOverTime.labels,
    [{ values: DATA.tripsOverTime.values, color: '#f5c518', label: 'Trips' }],
    { height: 220, yFmt: (v) => (v/1000).toFixed(0) + 'k' });

  // Trips by borough
  const bKeys = Object.keys(DATA.tripsByBorough);
  renderBarChart('chart-trips-borough', bKeys, bKeys.map(k => DATA.tripsByBorough[k]),
    { height: 220, yFmt: (v) => (v/1000).toFixed(0)+'k', colors: bKeys.map(k => DATA.boroughColors[k]) });

  // Top 5 zones table
  renderZonesTable('table-top-zones', DATA.topZones.slice(0, 5));
}

function renderZonesTable(id, zones) {
  const tbody = document.querySelector(`#${id} tbody`);
  if (!tbody) return;
  tbody.innerHTML = zones.map((z, i) => `
    <tr>
      <td><span class="rank-badge rank-${i < 3 ? i+1 : 'other'}">${i+1}</span></td>
      <td class="primary">${z.zone}</td>
      <td><span class="pill pill-${['yellow','blue','green','orange','purple'][['Manhattan','Queens','Brooklyn','Bronx','Staten Island'].indexOf(z.borough)] || 'blue'}">${z.borough}</span></td>
      <td class="mono">${fmt.num(z.trips)}</td>
    </tr>`).join('');
}


/* ── Profitability ── */
let profSortKey = 'revenue';
let profSortDir = 'desc';

function initProfitability() {
  renderProfTable(DATA.topZones, profSortKey, profSortDir);

  // Rev per min by borough
  const bKeys = Object.keys(DATA.revByBorough);
  renderBarChart('chart-rev-borough', bKeys, bKeys.map(k => DATA.revByBorough[k]),
    { height: 220, yFmt: (v) => '$'+v.toFixed(2), colors: bKeys.map(k => DATA.boroughColors[k]) });

  // Rev per min by hour
  renderLineChart('chart-rev-hour', DATA.revByHour.labels,
    [{ values: DATA.revByHour.values, color: '#f5c518', label: 'Rev/Min' }],
    { height: 220, yFmt: (v) => '$'+v.toFixed(2), minY: 0 });

  // Sort header listeners
  document.querySelectorAll('#prof-table th[data-sort]').forEach(th => {
    th.addEventListener('click', () => {
      const key = th.dataset.sort;
      if (profSortKey === key) profSortDir = profSortDir === 'desc' ? 'asc' : 'desc';
      else { profSortKey = key; profSortDir = 'desc'; }
      document.querySelectorAll('#prof-table th').forEach(t => t.classList.remove('sort-asc','sort-desc'));
      th.classList.add(`sort-${profSortDir}`);
      renderProfTable(DATA.topZones, profSortKey, profSortDir);
    });
  });
}

function renderProfTable(zones, key, dir) {
  const keyMap = { zone: 'zone', revenue: 'revenue', fare: 'farePerMile', tip: 'avgTip' };
  const sorted = sortData(zones, keyMap[key] || key, dir);
  const tbody = document.querySelector('#prof-table tbody');
  if (!tbody) return;
  tbody.innerHTML = sorted.map((z, i) => `
    <tr>
      <td><span class="rank-badge rank-${i < 3 ? i+1 : 'other'}">${i+1}</span></td>
      <td class="primary">${z.zone}</td>
      <td><span class="pill pill-${['yellow','blue','green','orange','purple'][['Manhattan','Queens','Brooklyn','Bronx','Staten Island'].indexOf(z.borough)] || 'blue'}">${z.borough}</span></td>
      <td class="mono accent" style="color:var(--yellow)">${fmt.rpm(z.revenue)}</td>
      <td class="mono">${fmt.usd(z.farePerMile)}</td>
      <td class="mono">${fmt.pct(z.avgTip)}</td>
    </tr>`).join('');
}


/* ── Tip Intelligence ── */
function initTips() {
  // Avg tip by borough
  const bKeys = Object.keys(DATA.tipByBorough);
  renderBarChart('chart-tip-borough', bKeys, bKeys.map(k => DATA.tipByBorough[k]),
    { height: 220, yFmt: (v) => v.toFixed(1)+'%', colors: bKeys.map(k => DATA.boroughColors[k]) });

  // Tip % by hour
  renderLineChart('chart-tip-hour', DATA.tipByHour.labels,
    [{ values: DATA.tipByHour.values, color: '#3dd68c', label: 'Tip %' }],
    { height: 220, yFmt: (v) => v.toFixed(1)+'%', minY: 0 });

  // Card vs Cash
  renderGroupedBarChart('chart-tip-payment',
    DATA.paymentTips.boroughs, DATA.paymentTips.card, DATA.paymentTips.cash,
    { height: 220, colorA: '#f5c518', colorB: '#60a5fa' });

  // Insight text
  const insightEl = document.getElementById('tip-insight');
  if (insightEl) {
    const topBorough = bKeys.reduce((a, b) => DATA.tipByBorough[a] > DATA.tipByBorough[b] ? a : b);
    const peakHour = DATA.tipByHour.labels[DATA.tipByHour.values.indexOf(Math.max(...DATA.tipByHour.values))];
    const cardAvg  = (DATA.paymentTips.card.reduce((a,b)=>a+b,0)/5).toFixed(1);
    const cashAvg  = (DATA.paymentTips.cash.reduce((a,b)=>a+b,0)/5).toFixed(1);
    insightEl.innerHTML = `
      <strong>${topBorough}</strong> leads all boroughs with an average tip of
      <strong>${fmt.pct(DATA.tipByBorough[topBorough])}</strong>. 
      Tip rates peak at <strong>${peakHour}</strong> — late-night trips show significantly higher generosity.
      Card payments average <strong>${cardAvg}%</strong> vs cash at <strong>${cashAvg}%</strong>,
      a <strong>${(cardAvg - cashAvg).toFixed(1)} percentage point</strong> premium.
      Drivers should prioritize card-accepting passengers in high-tip boroughs during late-night hours
      to maximize tip income per trip.`;
  }
}


/* ── Anomalies ── */
let anomSortKey = 'id';
let anomSortDir = 'asc';

function initAnomalies() {
  // KPI
  const mostCommon = Object.entries(DATA.anomalyBreakdown)
    .sort((a,b) => b[1]-a[1])[0][0];

  const kpis = [
    { label: 'Total Flagged Trips',  value: fmt.num(DATA.kpi.flaggedCount),       cls: 'danger', icon: '🚨' },
    { label: 'Pct of All Trips',     value: fmt.pct(DATA.kpi.flaggedPct),          cls: 'danger', icon: '📊' },
    { label: 'Most Common Anomaly',  value: mostCommon,                            cls: '',       icon: '🔍' },
  ];
  const grid = document.getElementById('anomaly-kpi-grid');
  if (grid) {
    grid.innerHTML = kpis.map(k => `
      <div class="kpi-card animate-in">
        <div class="kpi-label">${k.label}</div>
        <div class="kpi-value ${k.cls}" style="font-size:${k.cls==='' ? '18px' : '28px'}">${k.value}</div>
        <div class="kpi-icon">${k.icon}</div>
      </div>`).join('');
  }

  // Anomalies by type
  const aKeys = Object.keys(DATA.anomalyBreakdown);
  renderBarChart('chart-anomaly-type', aKeys, aKeys.map(k => DATA.anomalyBreakdown[k]),
    { height: 220, yFmt: fmt.num, bottomPad: 60, truncate: false,
      labelFontSize: 8,
      colors: ['#f05252','#f97316','#f5c518','#3dd68c','#60a5fa','#a78bfa'] });

  // Flagged trips table
  renderAnomalyTable(DATA.flaggedTrips, anomSortKey, anomSortDir);

  document.querySelectorAll('#anomaly-table th[data-sort]').forEach(th => {
    th.addEventListener('click', () => {
      const key = th.dataset.sort;
      if (anomSortKey === key) anomSortDir = anomSortDir === 'desc' ? 'asc' : 'desc';
      else { anomSortKey = key; anomSortDir = 'desc'; }
      document.querySelectorAll('#anomaly-table th').forEach(t => t.classList.remove('sort-asc','sort-desc'));
      th.classList.add(`sort-${anomSortDir}`);
      renderAnomalyTable(DATA.flaggedTrips, anomSortKey, anomSortDir);
    });
  });
}

function renderAnomalyTable(trips, key, dir) {
  const sorted = sortData(trips, key, dir);
  const tbody  = document.querySelector('#anomaly-table tbody');
  if (!tbody) return;
  const sevPill = { high: 'pill-red', medium: 'pill-yellow', low: 'pill-blue' };
  tbody.innerHTML = sorted.map(t => `
    <tr>
      <td class="mono primary">${t.id}</td>
      <td>${t.zone}</td>
      <td><span class="pill ${sevPill[t.severity] || 'pill-blue'}">${t.type}</span></td>
      <td class="mono">${fmt.usd(t.fare)}</td>
      <td class="mono">${fmt.pct(t.tip)}</td>
      <td><span class="pill ${sevPill[t.severity]}">${t.severity.toUpperCase()}</span></td>
      <td style="font-size:11px;color:var(--text-muted)">${t.note}</td>
    </tr>`).join('');
}


/* ================================================================
   4. EVENT LISTENERS & INIT
   ================================================================ */

function setActiveNav() {
  const page = window.location.pathname.split('/').pop() || 'index.html';
  document.querySelectorAll('.nav-link').forEach(link => {
    const href = link.getAttribute('href');
    if (href === page || (page === '' && href === 'index.html')) {
      link.classList.add('active');
    }
  });
}

function injectGlobalTooltip() {
  if (!document.getElementById('global-tooltip')) {
    const t = document.createElement('div');
    t.id = 'global-tooltip';
    t.className = 'chart-tooltip';
    document.body.appendChild(t);
  }
}

function handleResize() {
  const page = window.location.pathname.split('/').pop() || 'index.html';
  if      (page === 'index.html'         || page === '') initOverview();
  else if (page === 'profitability.html')               initProfitability();
  else if (page === 'tips.html')                        initTips();
  else if (page === 'anomalies.html')                   initAnomalies();
}

document.addEventListener('DOMContentLoaded', () => {
  injectGlobalTooltip();
  setActiveNav();

  const page = window.location.pathname.split('/').pop() || 'index.html';
  if      (page === 'index.html'         || page === '') initOverview();
  else if (page === 'profitability.html')               initProfitability();
  else if (page === 'tips.html')                        initTips();
  else if (page === 'anomalies.html')                   initAnomalies();

  let resizeTimer;
  window.addEventListener('resize', () => {
    clearTimeout(resizeTimer);
    resizeTimer = setTimeout(handleResize, 200);
  });
});
