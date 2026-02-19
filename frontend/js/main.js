'use strict';

// ---------------------------------------------------------
// 1. DATA UTILITIES (Mock Data for local testing)
// ---------------------------------------------------------
const AppData = {
    boroughs: ['Manhattan', 'Brooklyn', 'Queens', 'Bronx', 'Staten Island'],
    anomalies: ['High Speed', 'Negative Fare', 'Zero Distance', 'Long Duration'],
    
    // Custom Ranking Data for Profitability
    zones: [
        { zone_name: 'Upper East Side South', rev_min: 1.45, fare_mile: 4.20, avg_tip: 18.2 },
        { zone_name: 'JFK Airport', rev_min: 2.10, fare_mile: 3.50, avg_tip: 15.5 },
        { zone_name: 'Financial District North', rev_min: 1.65, fare_mile: 5.10, avg_tip: 19.1 },
        { zone_name: 'Midtown Center', rev_min: 1.88, fare_mile: 6.30, avg_tip: 17.8 },
        { zone_name: 'Astoria', rev_min: 0.95, fare_mile: 2.80, avg_tip: 12.4 }
    ]
};

// ---------------------------------------------------------
// 2. RENDERING FUNCTIONS (HTML5 Canvas)
// ---------------------------------------------------------
const Render = {
    // Shared styling for Canvas
    setupCanvas: (id) => {
        const canvas = document.getElementById(id);
        if (!canvas) return null;
        const ctx = canvas.getContext('2d');
        const dpr = window.devicePixelRatio || 1;
        canvas.width = canvas.parentElement.clientWidth * dpr;
        canvas.height = 300 * dpr;
        ctx.scale(dpr, dpr);
        return { ctx, w: canvas.parentElement.clientWidth, h: 300 };
    },

    barChart: (id, labels, values, color = '#fbc531') => {
        const setup = Render.setupCanvas(id);
        if (!setup) return;
        const { ctx, w, h } = setup;
        
        const padding = 40;
        const chartW = w - (padding * 2);
        const chartH = h - (padding * 2);
        const barW = (chartW / labels.length) - 10;
        const maxVal = Math.max(...values) * 1.1;

        ctx.clearRect(0,0,w,h);
        values.forEach((val, i) => {
            const barH = (val / maxVal) * chartH;
            const x = padding + (i * (barW + 10));
            const y = h - padding - barH;

            ctx.fillStyle = color;
            ctx.fillRect(x, y, barW, barH);
            
            // Labels
            ctx.fillStyle = '#353b48';
            ctx.font = '10px Arial';
            ctx.fillText(labels[i].substring(0, 8), x, h - padding + 15);
        });
    },

    lineChart: (id, labels, values) => {
        const setup = Render.setupCanvas(id);
        if (!setup) return;
        const { ctx, w, h } = setup;
        const padding = 40;
        const chartW = w - (padding * 2);
        const chartH = h - (padding * 2);
        const maxVal = Math.max(...values) * 1.1;

        ctx.beginPath();
        ctx.strokeStyle = '#2f3640';
        ctx.lineWidth = 2;

        values.forEach((val, i) => {
            const x = padding + (i * (chartW / (values.length - 1)));
            const y = h - padding - ((val / maxVal) * chartH);
            if (i === 0) ctx.moveTo(x, y); else ctx.lineTo(x, y);
        });
        ctx.stroke();
    }
};

// ---------------------------------------------------------
// 3. ALGORITHM: Custom Sorting (No .sort() library usage)
// ---------------------------------------------------------
function manualSort(arr, key, desc = true) {
    const data = [...arr];
    for (let i = 0; i < data.length; i++) {
        for (let j = 0; j < data.length - i - 1; j++) {
            let condition = desc 
                ? data[j][key] < data[j + 1][key] 
                : data[j][key] > data[j + 1][key];
            if (condition) {
                let temp = data[j];
                data[j] = data[j+1];
                data[j+1] = temp;
            }
        }
    }
    return data;
}

// ---------------------------------------------------------
// 4. EVENT LISTENERS & INITIALIZATION
// ---------------------------------------------------------
let currentSortDir = true;

window.handleSort = (key) => {
    currentSortDir = !currentSortDir;
    const sorted = manualSort(AppData.zones, key, currentSortDir);
    populateTable('table-profit-ranking', sorted);
};

function populateTable(id, data) {
    const tableBody = document.querySelector(`#${id} tbody`);
    if (!tableBody) return;
    tableBody.innerHTML = data.map(row => `
        <tr>
            ${Object.values(row).map(val => `<td>${val}</td>`).join('')}
        </tr>
    `).join('');
}

function init() {
    // Determine which page we are on
    const page = window.location.pathname.split("/").pop();

    if (page === "index.html" || page === "") {
        Render.barChart('chart-trips-borough', AppData.boroughs, [65, 20, 15, 8, 2]);
        Render.lineChart('chart-trips-time', ['8am', '12pm', '4pm', '8pm', '12am'], [20, 50, 80, 100, 40]);
        const overviewData = AppData.zones.slice(0, 5).map(z => ({n: z.zone_name, b: 'Manhattan', c: 15000}));
        populateTable('table-overview-zones', overviewData);
    }

    if (page === "profitability.html") {
        Render.barChart('chart-rev-borough', AppData.boroughs, [1.45, 1.10, 0.95, 0.80, 0.70]);
        Render.lineChart('chart-rev-hour', ['0', '4', '8', '12', '16', '20'], [0.8, 0.6, 1.2, 1.5, 1.8, 1.1]);
        populateTable('table-profit-ranking', AppData.zones);
    }

    if (page === "tips.html") {
        Render.barChart('chart-tip-borough', AppData.boroughs, [18, 14, 13, 11, 10]);
        Render.barChart('chart-tip-payment', ['Card', 'Cash'], [18.5, 1.2], '#3498db');
        Render.lineChart('chart-tip-hour', ['0', '6', '12', '18'], [12, 15, 14, 17]);
    }

    if (page === "anomalies.html") {
        Render.barChart('chart-anomalies-type', AppData.anomalies, [450, 120, 300, 80], '#e74c3c');
        const errs = [{r: 102, t: 'High Speed', d: '85mph'}, {r: 504, t: 'Neg Fare', d: '-$15.00'}];
        populateTable('table-anomalies', errs);
    }
}

window.addEventListener('load', init);
window.addEventListener('resize', init);