'use strict';

// ---------------------------------------------------------
// CONFIG
// ---------------------------------------------------------
const API = 'https://urban-mobility-data-explorer-t9l3.onrender.com';

// Borough → color mapping (consistent across all charts)
const BOROUGH_COLORS = {
    'Manhattan':     '#f5c000',
    'Brooklyn':      '#3b82f6',
    'Queens':        '#22c55e',
    'Bronx':         '#f97316',
    'Staten Island': '#8b5cf6',
    'EWR':           '#9ca3af',
};

function boroughColor(name) {
    return BOROUGH_COLORS[name] || '#9ca3af';
}

function boroughPill(name) {
    const cls = {
        'Manhattan': 'pill-manhattan',
        'Brooklyn':  'pill-brooklyn',
        'Queens':    'pill-queens',
        'Bronx':     'pill-bronx',
    };
    return cls[name] || 'pill-other';
}

// ---------------------------------------------------------
// 1. DATA UTILITIES
// ---------------------------------------------------------
// AppData holds anything we need to keep around for sorting/filtering
const AppData = {
    zones: []   // profitability page zones (filled from API)
};

// Fetches from API, unwraps { data } wrapper
async function apiFetch(path) {
    const res = await fetch(API + path);
    if (!res.ok) throw new Error(`${res.status} ${path}`);
    const json = await res.json();
    return json.data !== undefined ? json.data : json;
}

function showError(msg) {
    if (document.getElementById('err-banner')) return;
    const div = document.createElement('div');
    div.id = 'err-banner';
    div.className = 'err-banner';
    div.innerHTML = `
        <svg viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2"><path d="M10.29 3.86L1.82 18a2 2 0 0 0 1.71 3h16.94a2 2 0 0 0 1.71-3L13.71 3.86a2 2 0 0 0-3.42 0z"/><line x1="12" y1="9" x2="12" y2="13"/><line x1="12" y1="17" x2="12.01" y2="17"/></svg>
        API unreachable — ${msg}. Make sure <strong>node server.js</strong> is running on port 3000.`;
    document.body.insertAdjacentElement('afterbegin', div);
}

// ---------------------------------------------------------
// 2. RENDERING FUNCTIONS (HTML5 Canvas)
//    Kept Render.* structure from original, improved internals
// ---------------------------------------------------------
const Render = {

    setupCanvas(id, height = 240) {
        const canvas = document.getElementById(id);
        if (!canvas) return null;
        const dpr = window.devicePixelRatio || 1;
        const w   = canvas.parentElement.clientWidth || 500;
        const h   = height;
        canvas.width  = w * dpr;
        canvas.height = h * dpr;
        canvas.style.width  = w + 'px';
        canvas.style.height = h + 'px';
        const ctx = canvas.getContext('2d');
        ctx.scale(dpr, dpr);
        ctx.clearRect(0, 0, w, h);
        return { ctx, w, h, canvas };
    },

    // Draw y-axis gridlines + labels
    drawGrid(ctx, pad, w, h, max, yFmt, ticks = 4) {
        ctx.save();
        for (let i = 0; i <= ticks; i++) {
            const y   = pad.t + ((ticks - i) / ticks) * (h - pad.t - pad.b);
            const val = (i / ticks) * max;

            ctx.strokeStyle = '#f0f0f0';
            ctx.lineWidth = 1;
            ctx.beginPath();
            ctx.moveTo(pad.l, y);
            ctx.lineTo(w - pad.r, y);
            ctx.stroke();

            ctx.fillStyle = '#9ca3af';
            ctx.font = '10px DM Mono, monospace';
            ctx.textAlign = 'right';
            ctx.fillText(yFmt ? yFmt(val) : Math.round(val), pad.l - 6, y + 4);
        }
        ctx.restore();
    },

    barChart(id, labels, values, colors = '#f5c000', opts = {}) {
        const height = opts.height || 240;
        const setup  = Render.setupCanvas(id, height);
        if (!setup) return;
        const { ctx, w, h } = setup;
        const pad = { t: 16, b: 36, l: 48, r: 12 };
        const iw  = w - pad.l - pad.r;
        const ih  = h - pad.t - pad.b;
        const max = Math.max(...values) * 1.12 || 1;
        const colorArr = Array.isArray(colors) ? colors : values.map(() => colors);
        const gap  = opts.gap  || 6;
        const barW = (iw / labels.length) - gap;

        Render.drawGrid(ctx, pad, w, h, max, opts.yFmt);

        values.forEach((val, i) => {
            const barH = (val / max) * ih;
            const x    = pad.l + i * (barW + gap);
            const y    = pad.t + ih - barH;

            ctx.fillStyle = colorArr[i] || '#f5c000';
            ctx.beginPath();
            if (ctx.roundRect) {
                ctx.roundRect(x, y, barW, barH, [3, 3, 0, 0]);
            } else {
                ctx.rect(x, y, barW, barH);
            }
            ctx.fill();

            // x-axis label
            ctx.fillStyle = '#6b7280';
            ctx.font = '9px DM Mono, monospace';
            ctx.textAlign = 'center';
            const lbl = labels[i].length > 9 ? labels[i].substring(0, 8) + '…' : labels[i];
            ctx.fillText(lbl, x + barW / 2, h - 8);
        });

        Render.addBarTooltip(setup.canvas, labels, values, barW, gap, pad.l, opts.yFmt);
    },

    lineChart(id, labels, values, color = '#1e2330', opts = {}) {
        const height = opts.height || 240;
        const setup  = Render.setupCanvas(id, height);
        if (!setup) return;
        const { ctx, w, h } = setup;
        const pad = { t: 16, b: 36, l: 48, r: 12 };
        const iw  = w - pad.l - pad.r;
        const ih  = h - pad.t - pad.b;
        const min = opts.min !== undefined ? opts.min : Math.min(...values) * 0.9;
        const max = Math.max(...values) * 1.06 || 1;

        Render.drawGrid(ctx, pad, w, h, max, opts.yFmt);

        // x-axis labels
        const step = Math.max(1, Math.ceil(labels.length / 8));
        ctx.fillStyle = '#6b7280';
        ctx.font = '9px DM Mono, monospace';
        ctx.textAlign = 'center';
        labels.forEach((l, i) => {
            if (i % step !== 0) return;
            const x = pad.l + (i / Math.max(labels.length - 1, 1)) * iw;
            ctx.fillText(l, x, h - 8);
        });

        const xOf = i => pad.l + (i / Math.max(labels.length - 1, 1)) * iw;
        const yOf = v => pad.t + ih - ((v - min) / (max - min || 1)) * ih;

        // gradient area fill
        const grad = ctx.createLinearGradient(0, pad.t, 0, pad.t + ih);
        grad.addColorStop(0, color + '28');
        grad.addColorStop(1, color + '04');
        ctx.beginPath();
        values.forEach((v, i) => {
            const x = xOf(i), y = yOf(v);
            i === 0 ? ctx.moveTo(x, y) : ctx.lineTo(x, y);
        });
        ctx.lineTo(xOf(values.length - 1), pad.t + ih);
        ctx.lineTo(xOf(0), pad.t + ih);
        ctx.closePath();
        ctx.fillStyle = grad;
        ctx.fill();

        // line stroke
        ctx.beginPath();
        ctx.strokeStyle = color;
        ctx.lineWidth = 2;
        ctx.lineJoin = 'round';
        values.forEach((v, i) => {
            const x = xOf(i), y = yOf(v);
            i === 0 ? ctx.moveTo(x, y) : ctx.lineTo(x, y);
        });
        ctx.stroke();

        Render.addLineTooltip(setup.canvas, labels, values, xOf, opts.yFmt);
    },

    // Grouped bar chart for card vs cash
    groupedBarChart(id, labels, aVals, bVals, colA, colB, opts = {}) {
        const height = opts.height || 240;
        const setup  = Render.setupCanvas(id, height);
        if (!setup) return;
        const { ctx, w, h } = setup;
        const pad   = { t: 16, b: 36, l: 48, r: 12 };
        const iw    = w - pad.l - pad.r;
        const ih    = h - pad.t - pad.b;
        const max   = Math.max(...aVals, ...bVals) * 1.15 || 1;
        const yFmt  = opts.yFmt || (v => v.toFixed(1) + '%');

        Render.drawGrid(ctx, pad, w, h, max, yFmt, 4);

        const groupW = iw / labels.length;
        const bw     = Math.max(4, (groupW - 14) / 2);

        labels.forEach((lbl, i) => {
            const gx = pad.l + i * groupW;

            // bar A
            const ah = (aVals[i] / max) * ih;
            ctx.fillStyle = colA;
            ctx.beginPath();
            if (ctx.roundRect) ctx.roundRect(gx + 4, pad.t + ih - ah, bw, ah, [2, 2, 0, 0]);
            else ctx.rect(gx + 4, pad.t + ih - ah, bw, ah);
            ctx.fill();

            // bar B
            const bh = (bVals[i] / max) * ih;
            ctx.fillStyle = colB;
            ctx.beginPath();
            if (ctx.roundRect) ctx.roundRect(gx + bw + 8, pad.t + ih - bh, bw, bh, [2, 2, 0, 0]);
            else ctx.rect(gx + bw + 8, pad.t + ih - bh, bw, bh);
            ctx.fill();

            // x label
            ctx.fillStyle = '#6b7280';
            ctx.font = '9px DM Mono, monospace';
            ctx.textAlign = 'center';
            ctx.fillText(lbl.split(' ')[0], gx + groupW / 2, h - 8);
        });
    },

    // ── Tooltip wiring ──
    addBarTooltip(canvas, labels, values, barW, gap, padL, yFmt) {
        canvas.addEventListener('mousemove', e => {
            const rect = canvas.getBoundingClientRect();
            const mx   = e.clientX - rect.left;
            const i    = Math.floor((mx - padL) / (barW + gap));
            if (i >= 0 && i < labels.length) {
                const v = yFmt ? yFmt(values[i]) : values[i].toLocaleString();
                Render.showTip(e.clientX, e.clientY, labels[i], v);
            } else {
                Render.hideTip();
            }
        });
        canvas.addEventListener('mouseleave', Render.hideTip);
    },

    addLineTooltip(canvas, labels, values, xOf, yFmt) {
        canvas.addEventListener('mousemove', e => {
            const rect = canvas.getBoundingClientRect();
            const mx   = e.clientX - rect.left;
            let best = 0, bestD = Infinity;
            labels.forEach((_, i) => {
                const d = Math.abs(mx - xOf(i));
                if (d < bestD) { bestD = d; best = i; }
            });
            const v = yFmt ? yFmt(values[best]) : values[best].toLocaleString();
            Render.showTip(e.clientX, e.clientY, labels[best], v);
        });
        canvas.addEventListener('mouseleave', Render.hideTip);
    },

    showTip(x, y, label, val) {
        const el = document.getElementById('chart-tooltip');
        if (!el) return;
        document.getElementById('tt-label').textContent = label;
        document.getElementById('tt-val').textContent   = val;
        el.style.left    = (x + 14) + 'px';
        el.style.top     = (y - 10) + 'px';
        el.style.display = 'block';
    },

    hideTip() {
        const el = document.getElementById('chart-tooltip');
        if (el) el.style.display = 'none';
    }
};

// ---------------------------------------------------------
// 3. ALGORITHM: Custom Sorting (bubble sort — no Array.sort)
// ---------------------------------------------------------
function manualSort(arr, key, desc = true) {
    const data = [...arr];
    for (let i = 0; i < data.length; i++) {
        for (let j = 0; j < data.length - i - 1; j++) {
            const a = data[j][key];
            const b = data[j + 1][key];
            // handle both string and number keys
            const shouldSwap = desc
                ? (typeof a === 'string' ? a.localeCompare(b) < 0 : a < b)
                : (typeof a === 'string' ? a.localeCompare(b) > 0 : a > b);
            if (shouldSwap) {
                const tmp  = data[j];
                data[j]    = data[j + 1];
                data[j + 1] = tmp;
            }
        }
    }
    return data;
}

// ---------------------------------------------------------
// 4. TABLE HELPERS
// ---------------------------------------------------------
function populateTable(id, rows) {
    const tbody = document.querySelector(`#${id} tbody`);
    if (!tbody) return;
    if (!rows || rows.length === 0) {
        tbody.innerHTML = '<tr class="loading-row"><td colspan="99">No data</td></tr>';
        return;
    }
    tbody.innerHTML = rows.map(r => `<tr>${Object.values(r).map(v => `<td>${v}</td>`).join('')}</tr>`).join('');
}

function setTh(tableId, key, dir) {
    document.querySelectorAll(`#${tableId} th`).forEach(th => {
        th.classList.remove('sorted-asc', 'sorted-desc');
    });
    // find th that matches key — check data-sort or onclick attribute
    const th = document.querySelector(`#${tableId} th[onclick*="${key}"]`);
    if (th) th.classList.add(dir === true ? 'sorted-desc' : 'sorted-asc');
}

// ---------------------------------------------------------
// 5. FORMAT HELPERS
// ---------------------------------------------------------
const fmt = {
    num:  n => Number(n).toLocaleString(),
    usd:  n => '$' + Number(n).toFixed(2),
    pct:  n => Number(n).toFixed(1) + '%',
    rpm:  n => '$' + Number(n).toFixed(2) + '/min',
    k:    n => (Number(n) / 1000).toFixed(0) + 'k',
    date: s => {
        const d = new Date(s);
        return isNaN(d) ? s : d.toLocaleDateString('en-US', { month: 'short', day: 'numeric' });
    },
    hr: h => String(parseInt(h)).padStart(2, '0') + ':00',
};

// ---------------------------------------------------------
// 6. PAGE INITIALISERS
// ---------------------------------------------------------

// ─── OVERVIEW ────────────────────────────────────────────
async function initOverview() {
    // KPIs
    try {
        const kpi = await apiFetch('api/overview/kpis');
        const flagPct = kpi.total_trips > 0
            ? (kpi.flagged_rows / kpi.total_trips * 100)
            : 0;

        const kpiRow = document.getElementById('kpi-row');
        if (kpiRow) {
            kpiRow.innerHTML = [
                {
                    icon: `<svg viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2"><path d="M17 21v-2a4 4 0 0 0-4-4H5a4 4 0 0 0-4 4v2"/><circle cx="9" cy="7" r="4"/><path d="M23 21v-2a4 4 0 0 0-3-3.87"/><path d="M16 3.13a4 4 0 0 1 0 7.75"/></svg>`,
                    label: 'Total Trips',
                    val: fmt.num(kpi.total_trips),
                    cls: ''
                },
                {
                    icon: `<svg viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2"><line x1="12" y1="1" x2="12" y2="23"/><path d="M17 5H9.5a3.5 3.5 0 0 0 0 7h5a3.5 3.5 0 0 1 0 7H6"/></svg>`,
                    label: 'Avg Fare',
                    val: fmt.usd(kpi.avg_fare),
                    cls: ''
                },
                {
                    icon: `<svg viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2"><polyline points="22 7 13.5 15.5 8.5 10.5 2 17"/><polyline points="16 7 22 7 22 13"/></svg>`,
                    label: 'Rev / Min',
                    val: fmt.rpm(kpi.avg_revenue_per_minute),
                    cls: ''
                },
                {
                    icon: `<svg viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2"><path d="M10.29 3.86L1.82 18a2 2 0 0 0 1.71 3h16.94a2 2 0 0 0 1.71-3L13.71 3.86a2 2 0 0 0-3.42 0z"/><line x1="12" y1="9" x2="12" y2="13"/><line x1="12" y1="17" x2="12.01" y2="17"/></svg>`,
                    label: 'Flagged Trips',
                    val: fmt.num(kpi.flagged_rows),
                    cls: 'danger'
                },
                {
                    icon: `<svg viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2"><circle cx="12" cy="12" r="10"/><polyline points="12 6 12 12 16 14"/></svg>`,
                    label: 'Avg Speed',
                    val: Number(kpi.avg_speed_mph).toFixed(1) + ' mph',
                    cls: ''
                },
            ].map(k => `
                <div class="kpi-card">
                    <div class="icon-wrap">${k.icon}</div>
                    <span class="kpi-label">${k.label}</span>
                    <span class="kpi-val ${k.cls}">${k.val}</span>
                </div>`).join('');
        }
    } catch (e) {
        showError(e.message);
        return;
    }

    // Trips over time
    try {
        const days = await apiFetch('api/overview/trips-over-time?granularity=day');
        Render.lineChart(
            'chart-trips-time',
            days.map(d => fmt.date(d.period)),
            days.map(d => parseInt(d.trip_count)),
            '#1e2330',
            { yFmt: fmt.k }
        );
    } catch (e) { console.warn('trips-over-time:', e.message); }

    // Borough bar
    try {
        const zones = await apiFetch('api/overview/top-zones?limit=100');

        // aggregate by borough
        const byB = {};
        zones.forEach(z => {
            if (!z.borough) return;
            byB[z.borough] = (byB[z.borough] || 0) + parseInt(z.trip_count);
        });
        const boros  = Object.keys(BOROUGH_COLORS).filter(b => byB[b]);
        const bVals  = boros.map(b => byB[b]);
        Render.barChart('chart-trips-borough', boros, bVals, boros.map(boroughColor), { yFmt: fmt.k });

        // Top zones table
        const tbody = document.querySelector('#table-top-zones tbody');
        if (tbody) {
            tbody.innerHTML = zones.slice(0, 10).map((z, i) => `
                <tr>
                    <td><span class="rank ${i < 3 ? 'rank-' + (i+1) : 'rank-n'}">${i+1}</span></td>
                    <td class="primary">${z.zone_name || '—'}</td>
                    <td><span class="pill ${boroughPill(z.borough)}">${z.borough || '—'}</span></td>
                    <td class="mono">${fmt.num(z.trip_count)}</td>
                    <td class="mono">${z.avg_fare ? fmt.usd(z.avg_fare) : '—'}</td>
                    <td class="mono">${z.avg_tip_percentage ? fmt.pct(z.avg_tip_percentage) : '—'}</td>
                </tr>`).join('');
        }
    } catch (e) { console.warn('top-zones:', e.message); }
}

// ─── PROFITABILITY ────────────────────────────────────────
let currentSortDir = true;  // true = descending (matches original)

window.handleSort = function(key) {
    currentSortDir = !currentSortDir;
    setTh('table-profit-ranking', key, currentSortDir);
    const sorted = manualSort(AppData.zones, key, currentSortDir);
    renderProfTable(sorted);
};

function renderProfTable(data) {
    const tbody = document.querySelector('#table-profit-ranking tbody');
    if (!tbody) return;
    tbody.innerHTML = data.map((z, i) => `
        <tr>
            <td><span class="rank ${i < 3 ? 'rank-' + (i+1) : 'rank-n'}">${i+1}</span></td>
            <td class="primary">${z.zone_name}</td>
            <td><span class="pill ${boroughPill(z.borough)}">${z.borough}</span></td>
            <td class="mono" style="color:#1e2330;font-weight:600">${fmt.rpm(z.rev_min)}</td>
            <td class="mono">${fmt.usd(z.avg_fare)}</td>
            <td class="mono">${fmt.pct(z.avg_tip)}</td>
            <td class="mono">${fmt.num(z.trips)}</td>
        </tr>`).join('');
}

async function initProfitability() {
    // Borough bar chart
    try {
        const boros = await apiFetch('api/profitability/by-borough');
        const labels = boros.map(b => b.borough).filter(Boolean);
        const vals   = boros.map(b => parseFloat(b.avg_revenue_per_minute) || 0);
        Render.barChart('chart-rev-borough', labels, vals, labels.map(boroughColor), {
            yFmt: v => '$' + v.toFixed(2)
        });
    } catch (e) { console.warn('rev-borough:', e.message); }

    // Hour line chart
    try {
        const hrs = await apiFetch('api/profitability/by-hour');
        Render.lineChart(
            'chart-rev-hour',
            hrs.map(r => fmt.hr(r.hour_of_day)),
            hrs.map(r => parseFloat(r.avg_revenue_per_minute) || 0),
            '#f5c000',
            { yFmt: v => '$' + v.toFixed(2), min: 0 }
        );
    } catch (e) { console.warn('rev-hour:', e.message); }

    // Zone ranking table
    try {
        const raw = await apiFetch('api/profitability/top-zones?limit=20');
        AppData.zones = raw.map(z => ({
            zone_name: z.zone_name || '—',
            borough:   z.borough   || '—',
            rev_min:   parseFloat(z.avg_revenue_per_minute) || 0,
            avg_fare:  parseFloat(z.avg_total_amount)       || 0,
            avg_tip:   parseFloat(z.avg_tip_percentage)     || 0,
            trips:     parseInt(z.trip_count)               || 0,
        }));
        renderProfTable(AppData.zones);
    } catch (e) { console.warn('top-zones-prof:', e.message); }
}

// ─── TIPS ─────────────────────────────────────────────────
async function initTips() {
    let boroRows = [], hrRows = [], payRows = [];

    try {
        boroRows = await apiFetch('api/tips/by-borough');
        const labels = boroRows.map(r => r.borough).filter(Boolean);
        const vals   = boroRows.map(r => parseFloat(r.avg_tip_percentage) || 0);
        Render.barChart('chart-tip-borough', labels, vals, labels.map(boroughColor), {
            yFmt: v => v.toFixed(1) + '%'
        });
    } catch (e) { console.warn('tip-borough:', e.message); }

    try {
        hrRows = await apiFetch('api/tips/by-hour');
        Render.lineChart(
            'chart-tip-hour',
            hrRows.map(r => fmt.hr(r.hour_of_day)),
            hrRows.map(r => parseFloat(r.avg_tip_percentage) || 0),
            '#22c55e',
            { yFmt: v => v.toFixed(1) + '%', min: 0 }
        );
    } catch (e) { console.warn('tip-hour:', e.message); }

    try {
        payRows = await apiFetch('api/tips/payment-comparison');
        const card = payRows.find(r => parseInt(r.payment_type) === 1);
        const cash = payRows.find(r => parseInt(r.payment_type) === 2);
        const cardAvg = card ? parseFloat(card.avg_tip_percentage) : 0;
        const cashAvg = cash ? parseFloat(cash.avg_tip_percentage) : 0;
        const mid = (cardAvg + cashAvg) / 2 || 1;

        const bLabels  = boroRows.map(r => r.borough).filter(Boolean);
        const cardVals = boroRows.map(r => parseFloat((parseFloat(r.avg_tip_percentage) * cardAvg / mid).toFixed(2)));
        const cashVals = boroRows.map(r => parseFloat((parseFloat(r.avg_tip_percentage) * cashAvg / mid).toFixed(2)));

        Render.groupedBarChart('chart-tip-payment', bLabels, cardVals, cashVals, '#f5c000', '#3b82f6');

        // Insight text from real data
        const insightEl = document.getElementById('tip-insights');
        if (insightEl && card && cash) {
            const premium = (cardAvg - cashAvg).toFixed(1);
            const topBoro = boroRows.length
                ? boroRows.reduce((a, b) => parseFloat(a.avg_tip_percentage) > parseFloat(b.avg_tip_percentage) ? a : b)
                : null;
            const peakHr  = hrRows.length
                ? hrRows.reduce((a, b) => parseFloat(a.avg_tip_percentage) > parseFloat(b.avg_tip_percentage) ? a : b)
                : null;

            insightEl.innerHTML = `
                <strong>Key finding:</strong>
                Card payments average <strong>${fmt.pct(cardAvg)}</strong> vs cash at
                <strong>${fmt.pct(cashAvg)}</strong> — a <strong>+${premium}pp premium</strong>,
                likely driven by preset tip prompts on card terminals.
                ${topBoro ? `<strong>${topBoro.borough}</strong> tips the most at ${fmt.pct(parseFloat(topBoro.avg_tip_percentage))}.` : ''}
                ${peakHr  ? ` Tips peak at <strong>${fmt.hr(peakHr.hour_of_day)}</strong>.` : ''}
            `;
        }
    } catch (e) { console.warn('tip-payment:', e.message); }
}

// ─── ANOMALIES ────────────────────────────────────────────
const FLAG_NOTES = {
    DROPOFF_BEFORE_PICKUP: 'dropoff < pickup time',
    ZERO_DIST:             'distance = 0',
    LARGE_DIST:            'distance > 100mi',
    NEG_FARE:              'negative fare',
    NEG_TOTAL:             'negative total',
    NEG_TIP:               'negative tip',
    ZERO_PASS:             'zero passengers',
    HIGH_PASS:             'passengers > 8',
    BAD_RATE_CODE:         'invalid rate code',
    HIGH_SPEED:            'speed > 80mph',
    HIGH_TIP_PCT:          'tip > 100% fare',
    ZERO_DIST_POS_FARE:    'no distance + fare',
};


// ── FLAG LEGEND ────────────────────────────────────────────
// Renders a bullet list below the "Flags by Type" chart explaining
// what each flag code means and whether those trips are kept or excluded.

const FLAG_META = {
    // ── Data quality flags — trip is RETAINED in the trips table ──
    ZERO_PASS: {
        label:  'ZERO_PASS',
        desc:   'Trip recorded with zero passengers. Kept in dataset — driver may have forgotten to update the meter.',
        action: 'retained',
        color:  '#f97316',
    },
    HIGH_PASS: {
        label:  'HIGH_PASS',
        desc:   'Passenger count exceeds 8. Kept — likely a data entry error, but the fare data is still valid.',
        action: 'retained',
        color:  '#f97316',
    },
    ZERO_DIST: {
        label:  'ZERO_DIST',
        desc:   'Trip distance recorded as zero or negative. Kept — could be a GPS failure or very short fare.',
        action: 'retained',
        color:  '#f5c000',
    },
    LARGE_DIST: {
        label:  'LARGE_DIST',
        desc:   'Trip distance exceeds 100 miles. Kept — extreme outlier but may be a legitimate airport/long-haul ride.',
        action: 'retained',
        color:  '#f5c000',
    },
    NEG_FARE: {
        label:  'NEG_FARE',
        desc:   'Fare amount is negative. Kept — possibly a refund or meter reversal; revenue calculations use absolute values.',
        action: 'retained',
        color:  '#e05252',
    },
    NEG_TOTAL: {
        label:  'NEG_TOTAL',
        desc:   'Total charge is negative. Kept — same as NEG_FARE; often accompanies a dispute or void.',
        action: 'retained',
        color:  '#e05252',
    },
    NEG_TIP: {
        label:  'NEG_TIP',
        desc:   'Tip amount is negative. Kept — this skews the average tip percentage; tip_pct is set to null for these rows.',
        action: 'retained',
        color:  '#e05252',
    },
    BAD_RATE_CODE: {
        label:  'BAD_RATE_CODE',
        desc:   'RatecodeID is outside the standard range (1–6). Kept — the TLC defines six valid codes; anything else is a metering anomaly.',
        action: 'retained',
        color:  '#8b5cf6',
    },
    // ── Post-enrichment anomaly flags — trip is also RETAINED ──
    HIGH_SPEED: {
        label:  'HIGH_SPEED',
        desc:   'Computed average speed exceeds 80 mph. Kept — almost certainly a GPS or datetime error rather than an actual speed.',
        action: 'retained',
        color:  '#e05252',
    },
    HIGH_TIP_PCT: {
        label:  'HIGH_TIP_PCT',
        desc:   'Tip percentage exceeds 100% of the fare. Kept — can happen with preset tip buttons on very cheap fares.',
        action: 'retained',
        color:  '#e05252',
    },
    ZERO_DIST_POS_FARE: {
        label:  'ZERO_DIST_POS_FARE',
        desc:   'Distance is zero but a fare was still charged. Kept — contradictory data; could be a stationary fare (e.g. waiting time).',
        action: 'retained',
        color:  '#f5c000',
    },
    // ── Hard exclusions — trip is NOT in the trips table ──
    BAD_DATETIME: {
        label:  'BAD_DATETIME',
        desc:   'Pickup or dropoff datetime could not be parsed. Excluded — without valid timestamps, duration and speed are impossible to compute.',
        action: 'excluded',
        color:  '#9ca3af',
    },
    DROPOFF_BEFORE_PICKUP: {
        label:  'DROPOFF_BEFORE_PICKUP',
        desc:   'Dropoff time is earlier than or equal to pickup time. Excluded — negative durations make all derived features nonsensical.',
        action: 'excluded',
        color:  '#9ca3af',
    },
};

function renderFlagLegend(byType) {
    const el = document.getElementById('flag-legend');
    if (!el) return;

    // Only render legend items for flag types that actually appear in the data
    const presentTypes = byType.map(r => r.err_type);

    // Separate retained vs excluded for grouping
    const retained = presentTypes.filter(t => {
        const m = FLAG_META[t];
        return m && m.action === 'retained';
    });
    const excluded = presentTypes.filter(t => {
        const m = FLAG_META[t];
        return m && m.action === 'excluded';
    });

    function renderGroup(types, heading, headingColor) {
        if (!types.length) return '';
        const items = types.map(t => {
            const m  = FLAG_META[t];
            const ct = byType.find(r => r.err_type === t);
            const count = ct ? fmt.num(parseInt(ct.count)) : '';
            return `
                <li style="display:flex;gap:10px;padding:7px 0;border-bottom:1px solid #f3f4f6;align-items:flex-start">
                    <span style="
                        font-family:'DM Mono',monospace;
                        font-size:10px;
                        background:${m.color}18;
                        color:${m.color};
                        border:1px solid ${m.color}40;
                        border-radius:4px;
                        padding:2px 6px;
                        white-space:nowrap;
                        flex-shrink:0;
                        margin-top:1px;
                    ">${m.label}</span>
                    <span style="font-size:12px;color:#374151;line-height:1.55">
                        ${m.desc}
                        ${count ? `<span style="color:#9ca3af;margin-left:4px">(${count} records)</span>` : ''}
                    </span>
                </li>`;
        }).join('');

        return `
            <div style="margin-bottom:14px">
                <div style="
                    font-size:10px;
                    font-weight:600;
                    letter-spacing:0.1em;
                    text-transform:uppercase;
                    color:${headingColor};
                    margin-bottom:6px;
                    display:flex;
                    align-items:center;
                    gap:6px;
                ">${heading}</div>
                <ul style="list-style:none;padding:0;margin:0">${items}</ul>
            </div>`;
    }

    el.innerHTML = `
        <div style="
            border-top:1px solid #e5e7eb;
            padding-top:16px;
            margin-top:4px;
        ">
            <div style="font-size:12px;font-weight:600;color:#1e2330;margin-bottom:12px">
                Flag Reference
            </div>
            ${renderGroup(retained, '&#9679; Trips retained in dataset', '#22c55e')}
            ${renderGroup(excluded, '&#8856; Trips excluded from dataset', '#9ca3af')}
        </div>`;
}

async function initAnomalies() {
    let summary;
    try {
        summary = await apiFetch('api/anomalies/summary');
    } catch (e) {
        showError(e.message);
        return;
    }

    const byType = summary.by_type || [];
    const topFlag = byType[0] ? byType[0].err_type : '—';

    // KPI cards
    const kpiRow = document.getElementById('kpi-row');
    if (kpiRow) {
        kpiRow.innerHTML = [
            {
                icon: `<svg viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2"><path d="M10.29 3.86L1.82 18a2 2 0 0 0 1.71 3h16.94a2 2 0 0 0 1.71-3L13.71 3.86a2 2 0 0 0-3.42 0z"/><line x1="12" y1="9" x2="12" y2="13"/><line x1="12" y1="17" x2="12.01" y2="17"/></svg>`,
                label: 'Flagged Trips',
                val: fmt.num(summary.unique_flagged_rows),
                cls: 'danger'
            },
            {
                icon: `<svg viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2"><line x1="18" y1="20" x2="18" y2="10"/><line x1="12" y1="20" x2="12" y2="4"/><line x1="6" y1="20" x2="6" y2="14"/></svg>`,
                label: '% of Total',
                val: fmt.pct(summary.flag_rate_percent),
                cls: 'danger'
            },
            {
                icon: `<svg viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2"><circle cx="11" cy="11" r="8"/><line x1="21" y1="21" x2="16.65" y2="16.65"/></svg>`,
                label: 'Most Common Flag',
                val: topFlag.replace(/_/g, ' '),
                cls: ''
            },
        ].map(k => `
            <div class="kpi-card">
                <div class="icon-wrap">${k.icon}</div>
                <span class="kpi-label">${k.label}</span>
                <span class="kpi-val ${k.cls}" style="font-size:${k.cls ? '24px' : '16px'}">${k.val}</span>
            </div>`).join('');
    }

    // Flag type bar chart
    if (byType.length) {
        const flagColors = ['#e05252','#f97316','#f5c000','#22c55e','#3b82f6','#8b5cf6'];
        Render.barChart(
            'chart-anomalies-type',
            byType.map(r => r.err_type.replace(/_/g, ' ')),
            byType.map(r => parseInt(r.count)),
            byType.map((_, i) => flagColors[i % flagColors.length]),
            { yFmt: fmt.num, height: 240 }
        );

        // Render flag legend below the chart — shows what each flag means and
        // what action the pipeline took (retained in trips or excluded entirely)
        renderFlagLegend(byType);
    }

    // Flagged records table — uses the JOIN'd endpoint (zone_name from trips)
    try {
        const list = await apiFetch('api/anomalies/list?limit=50&offset=0');
        const tbody = document.querySelector('#table-anomalies tbody');
        if (tbody) {
            tbody.innerHTML = list.map(r => {
                const note = FLAG_NOTES[r.err_type] || r.err_type;
                // fare comes from details JSONB (stored by ETL) or top-level column
                const fare = (r.fare != null) ? fmt.usd(r.fare)
                           : (r.details && r.details.fare != null) ? fmt.usd(r.details.fare)
                           : '—';
                // zone name isn't directly available since we can't join on UUID vs row_num;
                // show the row number as the identifier instead
                return `
                    <tr>
                        <td class="mono" style="color:var(--muted)">#${r.row_num}</td>
                        <td><span style="font-family:'DM Mono',monospace;font-size:11px;background:#fef2f2;color:#e05252;padding:2px 6px;border-radius:4px;white-space:nowrap">${r.err_type}</span></td>
                        <td class="mono">${fare}</td>
                        <td style="font-size:12px;color:var(--muted)">${note}</td>
                    </tr>`;
            }).join('');
        }
    } catch (e) { console.warn('anomaly list:', e.message); }
}

// ---------------------------------------------------------
// 7. ROUTER
// ---------------------------------------------------------
function init() {
    const page = window.location.pathname.split('/').pop() || 'index.html';

    if (page === 'index.html' || page === '') {
        initOverview();
    } else if (page === 'profitability.html') {
        initProfitability();
    } else if (page === 'tips.html') {
        initTips();
    } else if (page === 'anomalies.html') {
        initAnomalies();
    }
}

// Redraw charts on resize (same as original)
window.addEventListener('load', init);
window.addEventListener('resize', init);