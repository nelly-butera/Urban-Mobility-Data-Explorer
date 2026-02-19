# Urban Mobility Data Explorer
### NYC Taxi Trip Analysis — January 2019

A full-stack data engineering and analytics project built on top of the NYC Taxi & Limousine Commission (TLC) public dataset. We built everything from scratch: a streaming ETL pipeline, a REST API server, a PostgreSQL database on Neon, and a four-page interactive dashboard — all without using any framework shortcuts (no Express, no ORM, no chart libraries).

---

## Table of Contents

1. [Project Overview](#project-overview)
2. [Dataset](#dataset)
3. [System Architecture](#system-architecture)
4. [Database Design](#database-design)
5. [Data Pipeline](#data-pipeline)
   - [Streaming Ingestion](#streaming-ingestion)
   - [Feature Engineering](#feature-engineering)
   - [Deduplication](#deduplication)
   - [Data Quality & Anomaly Detection](#data-quality--anomaly-detection)
6. [Custom Algorithms](#custom-algorithms)
   - [Merge Sort](#merge-sort)
   - [GroupBy & Aggregation](#groupby--aggregation)
   - [Deduplication Hash Table](#deduplication-hash-table)
7. [Backend API](#backend-api)
   - [Server](#server)
   - [Routing](#routing)
   - [Endpoints](#endpoints)
8. [Frontend Dashboard](#frontend-dashboard)
   - [Overview Page](#overview-page)
   - [Profitability Page](#profitability-page)
   - [Tips Page](#tips-page)
   - [Anomalies Page](#anomalies-page)
   - [Charts & Visualisations](#charts--visualisations)
9. [Setup Instructions](#setup-instructions)
10. [Project Structure](#project-structure)
11. [Key Findings](#key-findings)
12. [References & Sources](#references--sources)

---

## Project Overview

The goal was to take a real-world, messy dataset of 7.67 million taxi trips and turn it into something useful — clean data, a queryable API, and a dashboard someone could actually read. We wanted to answer questions like: which zones make drivers the most money per minute? Do people tip more at night? How bad is the data quality really?

We deliberately avoided using high-level abstractions. No Express.js, no Sequelize, no Chart.js, no lodash. All data structures — sorting, grouping, deduplication — are custom implementations. The reasoning was simple: if you use a library, you don't really learn what's happening underneath.

---

## Dataset

**Source:** NYC Taxi & Limousine Commission (TLC) Trip Record Data  
**URL:** https://www.nyc.gov/site/tlc/about/tlc-trip-record-data.page  
**File:** `yellow_tripdata_2019-01.csv`  
**Size:** ~670 MB, 7,667,792 rows  

**Zone Lookup:**  
The TLC also publishes a taxi zone lookup CSV that maps location IDs (1–265) to borough and neighbourhood names.  
**URL:** https://d37ci6vzurychx.cloudfront.net/misc/taxi_zone_lookup.csv  

**Zone Shapefiles:**  
For geographic data, the TLC provides shapefiles with polygon boundaries for each zone.  
**URL:** https://d37ci6vzurychx.cloudfront.net/misc/taxi_zones.zip  

Raw CSV columns we worked with:

| Column | Type | Description |
|---|---|---|
| `tpep_pickup_datetime` | timestamp | Pickup time |
| `tpep_dropoff_datetime` | timestamp | Dropoff time |
| `passenger_count` | int | Number of passengers |
| `trip_distance` | float | Distance in miles |
| `RatecodeID` | int | Rate code (1=Standard, 2=JFK, 3=Newark, etc.) |
| `store_and_fwd_flag` | char | Whether trip data was stored offline |
| `PULocationID` | int | Pickup zone ID |
| `DOLocationID` | int | Dropoff zone ID |
| `payment_type` | int | 1=Credit card, 2=Cash, 3–6=Other |
| `fare_amount` | float | Metered fare |
| `tip_amount` | float | Tip (only available for card payments) |
| `total_amount` | float | Total charged |
| `congestion_surcharge` | float | Added after 2019 — mostly null in Jan data |

---

## System Architecture

```
┌─────────────────────────────────────────────────────────────┐
│                      Raw CSV Data                           │
│              yellow_tripdata_2019-01.csv (670MB)            │
└────────────────────────────┬────────────────────────────────┘
                             │  Streaming parse (csv-parse)
                             ▼
┌─────────────────────────────────────────────────────────────┐
│                    ETL Pipeline (Node.js)                   │
│   normalise → deduplicate → feature engineer → flag/store   │
└────────────────────────────┬────────────────────────────────┘
                             │  Bulk INSERT (chunks of 500)
                             ▼
┌─────────────────────────────────────────────────────────────┐
│                PostgreSQL on Neon (cloud)                   │
│        zones · trips · error_log · zone_shapes             │
│         + 2 materialized views (hourly_stats, zone_stats)   │
└────────────────────────────┬────────────────────────────────┘
                             │  pg driver queries
                             ▼
┌─────────────────────────────────────────────────────────────┐
│           REST API Server (raw Node.js http module)         │
│   /api/overview  /api/profitability  /api/tips  /api/anomalies │
└────────────────────────────┬────────────────────────────────┘
                             │  fetch()
                             ▼
┌─────────────────────────────────────────────────────────────┐
│          Frontend Dashboard (vanilla HTML/CSS/JS)           │
│    4 pages · custom Canvas charts · no chart libraries      │
└─────────────────────────────────────────────────────────────┘
```

---

## Database Design

We used **Neon** (https://neon.tech) as our PostgreSQL host — it's serverless, free tier, and supports PostGIS for the shapefile geometry work.

### Tables

**`zones`** — TLC zone lookup (loaded first, ~265 rows)
```sql
CREATE TABLE zones (
    id           INTEGER      PRIMARY KEY,
    borough      VARCHAR(50),
    zone_name    VARCHAR(100),
    service_zone VARCHAR(50)
);
```

**`trips`** — Main fact table (~7.6M rows after cleaning)
```sql
CREATE TABLE trips (
    id           UUID         PRIMARY KEY DEFAULT uuid_generate_v4(),
    vendor       SMALLINT,
    pickup_time  TIMESTAMPTZ  NOT NULL,
    dropoff_time TIMESTAMPTZ  NOT NULL,
    passengers   SMALLINT,
    distance     NUMERIC(8,2),
    pickup_zone  INTEGER      REFERENCES zones(id),
    dropoff_zone INTEGER      REFERENCES zones(id),
    payment_type SMALLINT,
    fare         NUMERIC(8,2),
    tip          NUMERIC(8,2),
    total        NUMERIC(8,2),
    -- derived features computed at load time
    duration_min  NUMERIC(8,2),
    speed_mph     NUMERIC(8,2),
    money_per_min NUMERIC(10,4),
    tip_pct       NUMERIC(8,2),
    cost_per_mile NUMERIC(10,4),
    hour_of_day   SMALLINT,
    day_of_week   SMALLINT,
    is_peak       BOOLEAN
);
```

**`error_log`** — All quality flags and exclusions from the pipeline
```sql
CREATE TABLE error_log (
    err_id     UUID         PRIMARY KEY DEFAULT uuid_generate_v4(),
    row_num    BIGINT,
    err_type   VARCHAR(100) NOT NULL,
    details    JSONB,
    raw_data   JSONB        NOT NULL DEFAULT '{}',
    created_at TIMESTAMPTZ  NOT NULL DEFAULT NOW()
);
```

**`zone_shapes`** — PostGIS polygon geometry for each zone (optional, for mapping)

### Indexes

We added 10 indexes targeting the access patterns our API actually uses: `pickup_time`, `pickup_zone`, `hour_of_day`, `day_of_week`, `is_peak`, `payment_type`, `vendor`, and `money_per_min`. Query times dropped from several seconds to sub-100ms on the deployed Neon instance after adding these.

### Materialized Views

Two pre-aggregated views are refreshed after the bulk load:

- **`hourly_stats`** — trip count, avg fare, avg rev/min grouped by hour (744 rows for 31 days × 24 hours)
- **`zone_stats`** — aggregated metrics per pickup zone

These exist so the API endpoints don't have to full-scan 7.6M rows on every request. The tradeoff is that they go stale if new data is loaded — we refresh them manually with `SELECT update_stats()` after a load.

---

## Data Pipeline

All pipeline code lives in `data_processing/`. The entry point is `dataLoader.js`, which orchestrates the full sequence.

### Streaming Ingestion

Reading a 670 MB file into memory is a bad idea. We used `csv-parse` in streaming mode with a **backpressure pattern**: the parser emits a row, we immediately pause it, process the row synchronously, then resume it. This keeps memory usage flat regardless of file size.

```js
parser.on('data', async (raw) => {
    rowNum++;
    parser.pause();          // backpressure: stop reading
    // ... process row ...
    parser.resume();         // done, ask for next row
});
```

Processed rows accumulate in a `tripBatch` array. When the batch reaches 500 rows, we flush it to the database in a single parameterised bulk INSERT and empty the array. This gives us ~15,300 round-trips to the database for 7.6M rows — fast enough to complete in 20–40 minutes depending on Neon tier and network latency.

**Reference for streaming CSV patterns:**  
Node.js streams documentation — https://nodejs.org/api/stream.html  
csv-parse streaming API — https://csv.js.org/parse/api/stream/

### Feature Engineering

Raw CSV rows don't have duration, speed, or revenue-per-minute — we compute those on the fly in `featureEngineering.js` before inserting each row. Every field is computed in a single pass through the row object:

| Derived Feature | Formula | Stored As |
|---|---|---|
| `duration_min` | `(dropoff − pickup) / 60000` | `NUMERIC(8,2)` |
| `speed_mph` | `distance / (duration_min / 60)` | `NUMERIC(8,2)` |
| `money_per_min` | `total / duration_min` | `NUMERIC(10,4)` |
| `tip_pct` | `(tip / fare) × 100` | `NUMERIC(8,2)` |
| `cost_per_mile` | `total / distance` | `NUMERIC(10,4)` |
| `hour_of_day` | `pickup.getHours()` | `SMALLINT` |
| `day_of_week` | `pickup.getDay()` | `SMALLINT` |
| `is_peak` | hour in {7,8,9,16,17,18,19} | `BOOLEAN` |

All derived fields are `NULL` when the underlying data is missing or invalid — for example, `speed_mph` is `NULL` when `duration_min` is zero, rather than producing `Infinity`. This is important for keeping aggregations honest.

**Reference for feature engineering in data pipelines:**  
Kleppmann, M. (2017). *Designing Data-Intensive Applications*, Chapter 10. O'Reilly Media.

### Deduplication

The TLC dataset occasionally contains duplicate records — the same trip appearing twice with identical vendor, timestamps, locations, and total amount. We deduplicate using a plain object as a hash table in `deduplication.js`, deliberately avoiding JavaScript's built-in `Set`:

```js
const seen = Object.create(null);  // no prototype chain pollution

function buildTripKey(trip) {
    return [
        trip.vendor_id,
        trip.pickup_datetime,
        trip.dropoff_datetime,
        trip.pu_location_id,
        trip.do_location_id,
        trip.total_amount
    ].join('|');
}
```

On first encounter the key is stored; subsequent encounters are discarded. This is `O(n)` time and `O(n)` space — optimal for a single-pass stream.

### Data Quality & Anomaly Detection

We separated quality issues into two categories:

**Hard exclusions** — rows that are fundamentally unusable and are NOT inserted into `trips`:

| Code | Condition |
|---|---|
| `BAD_DATETIME` | Pickup or dropoff timestamp is unparseable |
| `DROPOFF_BEFORE_PICKUP` | Dropoff time ≤ pickup time |

**Soft flags** — rows that are kept in `trips` but marked in `error_log` for transparency:

| Code | Condition | Rationale for keeping |
|---|---|---|
| `ZERO_PASS` | passenger_count ≤ 0 | Fare data still valid |
| `HIGH_PASS` | passenger_count > 8 | Likely data entry error |
| `ZERO_DIST` | trip_distance ≤ 0 | Could be stationary fare |
| `LARGE_DIST` | trip_distance > 100 mi | Could be legit long-haul |
| `NEG_FARE` | fare_amount < 0 | Possibly a refund/void |
| `NEG_TOTAL` | total_amount < 0 | Same as above |
| `NEG_TIP` | tip_amount < 0 | Rare, kept for completeness |
| `BAD_RATE_CODE` | RatecodeID not in 1–6 | Non-standard but has a fare |
| `HIGH_SPEED` | computed speed > 80 mph | Almost certainly GPS error |
| `HIGH_TIP_PCT` | tip > 100% of fare | Happens with small fares |
| `ZERO_DIST_POS_FARE` | distance = 0 but fare > $0 | Could be waiting-time fare |

A single trip can trigger multiple flags. The `error_log` table records each flag as a separate row. We use `COUNT(DISTINCT row_num)` — not `COUNT(*)` — when reporting the number of flagged trips, because counting all log rows would double-count trips with multiple flags.

The `unique_flagged_rows` shown in the dashboard is the count of distinct CSV row numbers in `error_log` where `err_type NOT IN ('BAD_DATETIME', 'DROPOFF_BEFORE_PICKUP')` — meaning: trips that are actually in the `trips` table and carry at least one quality flag. The two excluded types are filtered out because those rows were never inserted.

**Reference for data quality frameworks:**  
Rahm, E., & Do, H. H. (2000). Data cleaning: Problems and current approaches. *IEEE Data Engineering Bulletin, 23*(4), 3–13.  
https://www.researchgate.net/publication/228566264

---

## Custom Algorithms

A key requirement for this project was implementing core data processing algorithms from scratch, without relying on built-in JavaScript methods like `Array.prototype.sort()`, `Array.prototype.reduce()`, or `Set`.

### Merge Sort

**File:** `utils/mergeSort.js`

We implemented a standard recursive merge sort. The choice over other `O(n log n)` algorithms (quicksort, heapsort) came down to stability — merge sort preserves the relative order of equal elements, which matters when sorting trip records by multiple criteria.

```
Time:  O(n log n) — all cases
Space: O(n) — auxiliary arrays at each merge step
```

The implementation uses a `compareFn` parameter identical in signature to what `Array.prototype.sort` expects, so it's a drop-in replacement. We deliberately avoided `Array.prototype.sort()` because the assignment required a custom implementation.

**Reference for merge sort:**  
Cormen, T. H., Leiserson, C. E., Rivest, R. L., & Stein, C. (2009). *Introduction to Algorithms* (3rd ed.), Chapter 2.3. MIT Press.  
Visualisation: https://visualgo.net/en/sorting

### GroupBy & Aggregation

**File:** `utils/groupBy.js`

`groupBy()` groups an array by a key function using a plain object as a hash map:

```
Time:  O(n) — single forward pass
Space: O(n) — each element stored once
```

`aggregateGroups()` then computes `{ count, sum, min, max, avg }` for a numeric field across each group, also in `O(n)` total. We explicitly avoided `Array.prototype.reduce()` as required, using manual `for` loops instead.

A guard was added after discovering a silent bug: if `keyFn` returns `null` or `undefined`, `String(null)` silently creates a group named `"null"`, which contaminates aggregations. The guard throws early with a clear message instead.

**Reference for hash map grouping:**  
Skiena, S. S. (2008). *The Algorithm Design Manual* (2nd ed.), Section 3.2. Springer.

### Deduplication Hash Table

**File:** `data_processing/deduplication.js`

Uses a plain object (`Object.create(null)`) as a hash table. The `buildTripKey()` function joins six fields with a `|` delimiter to create a composite key. `Object.create(null)` is used rather than `{}` to avoid any prototype chain collisions (e.g., a key named `constructor` or `toString`).

```
Time:  O(n) — single pass, O(1) average lookup/insert
Space: O(n) — at most n keys
```

**Why not `Set`?** The assignment explicitly prohibited built-in data structures beyond plain arrays and objects.

---

## Backend API

### Server

**File:** `server.js`

Built with Node.js's raw `http` module — no Express, no Fastify. The server validates the database connection before accepting traffic, then delegates all requests to the central router. A graceful shutdown handler closes the database pool on `SIGTERM` and `SIGINT`.

### Routing

**File:** `routes/index.js`

A flat route table maps URL prefixes to handler modules. Subpath matching is handled by `matchPath()` in `utils/httpHelpers.js`, which supports named path segments (`:id`-style). CORS headers are applied to every response, and `OPTIONS` preflight requests are short-circuited with a `204` before reaching any route handler — important for the browser-to-API communication in the dashboard.

All responses follow a consistent envelope:
```json
{ "success": true, "data": [...], "meta": { "count": 42 } }
```

### Endpoints

| Method | Path | Description |
|---|---|---|
| `GET` | `/health` | Server health check |
| `GET` | `/api/overview/kpis` | Total trips, avg fare, avg speed, rev/min, flagged count |
| `GET` | `/api/overview/trips-over-time` | Daily/hourly trip volume series |
| `GET` | `/api/overview/top-zones` | Top zones by trip count (with avg fare, tip %) |
| `GET` | `/api/profitability/top-zones` | Top zones ranked by revenue per minute |
| `GET` | `/api/profitability/by-borough` | Avg rev/min per borough |
| `GET` | `/api/profitability/by-hour` | Avg rev/min by hour of day |
| `GET` | `/api/tips/by-borough` | Avg tip % per borough |
| `GET` | `/api/tips/by-hour` | Avg tip % by hour of day |
| `GET` | `/api/tips/payment-comparison` | Tip % for card (type 1) vs cash (type 2) |
| `GET` | `/api/anomalies/summary` | Flag counts by type, rate vs total trips |
| `GET` | `/api/anomalies/list` | Paginated list of flagged records |

All zone-based endpoints exclude zone IDs 264 and 265 ("Unknown" / "Outside NYC") — these are valid FK references in the TLC data but produce meaningless aggregations on the dashboard.

---

## Frontend Dashboard

Four static HTML pages, one shared CSS file, and one JavaScript file. No React, no Vue, no bundler. Everything runs in the browser as-is.

### Overview Page (`index.html`)

**KPI cards:** Total Trips, Avg Fare, Revenue/Min, Flagged Trips %, Avg Speed — populated from `/api/overview/kpis`.

**Trips Over Time:** Line chart showing daily trip volume across all of January 2019. Data from `/api/overview/trips-over-time?granularity=day`. Useful for spotting demand patterns — weekends dip noticeably compared to Monday–Thursday peaks.

**Trips by Borough:** Bar chart aggregated client-side from the top-zones endpoint, grouped by borough with consistent colour coding used across all four pages: Manhattan = amber, Brooklyn = blue, Queens = green, Bronx = orange, Staten Island = purple.

**Top Pickup Zones table:** Ranked list with borough pills, trip count, avg fare, avg tip %.

### Profitability Page (`profitability.html`)

The core analytical question for this page: which zones are actually worth driving to? Trip count isn't the right metric — a zone with 10,000 short trips might earn less than one with 2,000 airport runs. We used **revenue per minute** (`money_per_min`) as the primary metric, which accounts for both fare amount and how long the trip took.

**Rev/Min by Borough:** Bar chart from `/api/profitability/by-borough`. Manhattan consistently tops this chart — high demand, relatively short distances, and frequent card payments that include preset tips.

**Rev/Min by Hour:** Line chart from `/api/profitability/by-hour`. Shows the two peak earning windows: 7–9am and 4–7pm, with a noticeable late-night floor around 2–5am.

**Zone Ranking Table:** Sortable by Revenue/Min, Avg Fare, Avg Tip %, or Zone Name. Sort is client-side using our custom bubble sort (retained from the original implementation to demonstrate the algorithm). Clicking a column header alternates between ascending and descending. Data from `/api/profitability/top-zones?limit=20`.

### Tips Page (`tips.html`)

**Tip % by Borough:** Bar chart from `/api/tips/by-borough`. Note that `tip_pct` is `NULL` for cash transactions — the TLC doesn't record cash tip amounts, so this chart effectively shows card-payment tip behaviour by borough. Manhattan tips highest because it has the highest proportion of card payments.

**Tip % by Hour:** Line chart from `/api/tips/by-hour`. Late-night hours (11pm–2am) consistently show elevated tip percentages — likely a combination of fewer trips (selection effect) and more generous late-night passengers.

**Card vs Cash Grouped Bar Chart:** Payment type 1 = Credit Card, Payment type 2 = Cash. The API returns overall card/cash averages from `/api/tips/payment-comparison`; these are then scaled proportionally to per-borough averages for the grouped chart. The card premium is substantial — typically 15–18 percentage points — driven by the preset tip buttons (15%, 20%, 25%) on the in-cab payment terminal, which effectively nudges card users toward tipping.

**Insight Box:** Auto-generated from real API data — picks out the top-tipping borough, peak hour, card/cash premium, and frames a recommendation for drivers.

### Anomalies Page (`anomalies.html`)

**KPI Cards:** Flagged Trips count, % of total, most common flag type. All three filter out `BAD_DATETIME` and `DROPOFF_BEFORE_PICKUP` — those rows were excluded from `trips` entirely, so they shouldn't count toward "trips with quality flags."

**Flags by Type Bar Chart:** One bar per distinct `err_type` in `error_log`, coloured by a fixed palette. Below the chart, a **Flag Reference** section explains what each code means, whether the trip was retained or excluded, and how many records it affects.

**Flagged Trip Sample Table:** The 50 most recent entries from `error_log` (excluding the two hard-exclusion types), showing row number, flag type, fare amount (from the `details` JSONB column), and a human-readable description of the flag.

Note on the anomaly count mismatch: `SELECT COUNT(*) FROM error_log` returns ~127,000 — this counts every log entry including hard-exclusion rows and multiple flags per trip. `unique_flagged_rows` shown on the dashboard is `COUNT(DISTINCT row_num) WHERE err_type NOT IN ('BAD_DATETIME', 'DROPOFF_BEFORE_PICKUP')` — the honest count of trips in the dataset that have at least one quality flag.

### Charts & Visualisations

All charts are drawn on `<canvas>` elements using the HTML5 Canvas 2D API. No Chart.js, no D3, no Plotly.

**Three chart types implemented:**

**1. Line Chart** (`renderLineChart`)  
Gradient area fill under the line, DPR-aware canvas scaling for sharp rendering on retina displays, x-axis label thinning (every Nth label to avoid overlap), y-axis gridlines, hover tooltip showing nearest data point.

**2. Bar Chart** (`renderBarChart`)  
Gradient fill (lighter at bottom), rounded top corners via `ctx.roundRect()` with a `ctx.rect()` fallback for older browsers, hover tooltip showing exact value.

**3. Grouped Bar Chart** (`renderGroupedBarChart`)  
Two bars per group (card/cash), shared x-axis labels. Used only on the Tips page.

**References for Canvas chart techniques:**  
MDN Web Docs — Canvas API: https://developer.mozilla.org/en-US/docs/Web/API/Canvas_API/Tutorial  
MDN — Drawing shapes: https://developer.mozilla.org/en-US/docs/Web/API/Canvas_API/Tutorial/Drawing_shapes  
MDN — `roundRect()`: https://developer.mozilla.org/en-US/docs/Web/API/CanvasRenderingContext2D/roundRect  
Device pixel ratio / HiDPI canvases: https://developer.mozilla.org/en-US/docs/Web/API/Window/devicePixelRatio  
Observable — How to make a bar chart (conceptual reference): https://observablehq.com/@d3/bar-chart  
Observable — Line chart with area: https://observablehq.com/@d3/area-chart  

**Typography:**  
Figtree (body) + DM Mono (numbers/code) — Google Fonts: https://fonts.google.com  
Figtree: https://fonts.google.com/specimen/Figtree  
DM Mono: https://fonts.google.com/specimen/DM+Mono  

**Icon set:**  
All navigation and KPI icons are inline SVG, sourced from Lucide Icons (MIT license): https://lucide.dev  

---

## Setup Instructions

### Prerequisites

- Node.js ≥ 18.0.0
- A PostgreSQL database with the PostGIS extension (we used Neon — free tier works)
- The dataset files (see [Dataset](#dataset) section above)

### Step 1 — Clone and install

```bash
git clone https://github.com/your-username/Urban-Mobility-Data-Explorer.git
cd Urban-Mobility-Data-Explorer/backend
npm install
```

### Step 2 — Environment variables

Create a `.env` file in the `backend/` directory:

```env
DATABASE_URL=postgresql://user:password@your-neon-host/neondb?sslmode=verify-full
PORT=3000
HOST=localhost
CHUNK_SIZE=500
MAX_SPEED_MPH=80
MAX_TIP_PERCENTAGE=100
DATA_CSV_PATH=../data/yellow_tripdata_2019-01.csv
ZONES_CSV_PATH=../data/taxi_zone_lookup.csv
SHAPEFILE_PATH=../data/taxi_zones/taxi_zones.shp
```

Replace `DATABASE_URL` with your actual Neon connection string (found in your Neon project dashboard under "Connection Details").

### Step 3 — Prepare the database

Open the Neon SQL Editor (or any Postgres client) and run:

```sql
-- Required for UUID generation
CREATE EXTENSION IF NOT EXISTS "uuid-ossp";

-- Required for shapefile geometry (optional, only needed for zone_shapes)
CREATE EXTENSION IF NOT EXISTS postgis;
```

Then apply the schema:

```bash
# Copy the contents of schema.sql and run it in the Neon SQL Editor
# Or if you have psql installed:
psql $DATABASE_URL -f schema.sql
```

### Step 4 — Load the data

**Download the dataset** from the TLC website and place the files in a `data/` folder at the project root.

```bash
# Load zone lookup first (required — trips reference zone IDs)
# This runs automatically at the start of the main data load.

# Run the full ETL pipeline (takes 20–40 minutes for 7.6M rows)
node -e "
  require('dotenv').config();
  const { loadData } = require('./data_processing/dataLoader');
  loadData()
    .then(s => { console.log('Done:', s); process.exit(0); })
    .catch(e => { console.error('Failed:', e.message); process.exit(1); });
"
```

You'll see progress logs every ~100,000 rows. Don't close the terminal.

**Optional — load zone shapefiles** (for geographic data):
```bash
node scripts/loadShapefile.js
```

### Step 5 — Refresh materialized views

After the data load completes, run this in the Neon SQL Editor:

```sql
SELECT update_stats();

-- Verify:
SELECT COUNT(*) FROM hourly_stats;   -- should be ~744
SELECT COUNT(*) FROM zone_stats;     -- should be 265
```

### Step 6 — Start the API server

```bash
node server.js
# Server starts at http://localhost:3000

# Smoke test:
curl http://localhost:3000/health
curl http://localhost:3000/api/overview/kpis
```

### Step 7 — Open the dashboard

The frontend is plain static HTML — no build step needed.

```bash
# From the frontend directory:
cd ../frontend
python3 -m http.server 8080
# Then open http://localhost:8080 in your browser
```

Or just open `index.html` directly in your browser. The JS fetches from `http://localhost:3000/api`, so the backend must be running.

### Verify everything is working

```bash
curl http://localhost:3000/api/overview/kpis
# Should return total_trips ~7.6M, avg_fare ~$14

curl http://localhost:3000/api/anomalies/summary
# Should return unique_flagged_rows ~40,000

curl "http://localhost:3000/api/overview/trips-over-time?granularity=day"
# Should return 31 rows (one per day in January 2019)
```

---

## Project Structure

```
Urban-Mobility-Data-Explorer/
├── backend/
│   ├── server.js                       # HTTP server entry point (raw http module)
│   ├── config.js                       # Centralised config (env vars, thresholds)
│   ├── database.js                     # pg Pool wrapper with query helper
│   ├── schema.sql                      # Full DDL: tables, indexes, materialized views
│   ├── package.json
│   │
│   ├── data_processing/
│   │   ├── dataLoader.js               # ETL orchestrator (streaming CSV → DB)
│   │   ├── featureEngineering.js       # Derives duration, speed, rev/min, tip%
│   │   ├── deduplication.js            # Hash table dedup (no Set)
│   │   └── anomalyDetection.js         # Flag checkers (speed, tip%, distance)
│   │
│   ├── routes/
│   │   ├── index.js                    # Central router + CORS + OPTIONS handler
│   │   ├── overview.js                 # /api/overview/* endpoints
│   │   ├── profitability.js            # /api/profitability/* endpoints
│   │   ├── tips.js                     # /api/tips/* endpoints
│   │   └── anomalies.js               # /api/anomalies/* endpoints
│   │
│   ├── utils/
│   │   ├── mergeSort.js                # Custom O(n log n) merge sort
│   │   ├── groupBy.js                  # Custom O(n) groupBy + aggregateGroups
│   │   └── httpHelpers.js              # sendJson, ok, error, parseQuery, CORS
│   │
│   └── scripts/
│       └── loadShapefile.js            # Loads TLC zone shapefiles into zone_shapes
│
└── frontend/
    ├── index.html                      # Overview page
    ├── profitability.html              # Profitability page
    ├── tips.html                       # Tip Intelligence page
    ├── anomalies.html                  # Anomalies page
    ├── css/
    │   └── styles.css                  # Design system, layout, components
    └── js/
        └── main.js                     # API integration + Canvas charts + routing
```

---

## Key Findings

After cleaning and analysing 7.67M January 2019 NYC taxi trips:

**Volume & Geography**
- The vast majority of pickups originate in Manhattan (~65% of all trips)
- JFK Airport and LaGuardia drive disproportionate revenue per minute despite lower trip volume
- Weekend trip volume drops ~20–25% vs weekday peaks

**Profitability**
- Revenue per minute peaks between 7–9am and 4–7pm (rush hour), as expected
- Airport zones (JFK, Newark) generate significantly higher rev/min than inner-city zones despite longer distances, because the fares are larger and there's less traffic uncertainty on highway legs
- Staten Island consistently shows the lowest rev/min — long distances, low demand

**Tipping**
- Card payments average ~15–18% tip vs effectively 0% for cash (cash tips aren't recorded)
- The preset tip buttons on TLC terminals (15/20/25%) have a clear behavioural nudge effect — the majority of card tips cluster at exactly 20% and 25%
- Tips peak late at night (11pm–2am), likely due to the combination of longer trips and more generous late-night passengers

**Data Quality**
- ~40,250 trips in the dataset (out of 7.67M, ~0.5%) carry at least one quality flag
- `ZERO_PASS` (zero passengers) is the most common flag — likely drivers forgetting to reset the meter between fares
- `ZERO_DIST_POS_FARE` is the most analytically interesting flag — trips with zero recorded distance but a positive fare charge, suggesting either GPS failures or stationary fares (e.g., extended waits)
- A small number of rows had `DROPOFF_BEFORE_PICKUP` times — these were excluded entirely as no derived features can be computed meaningfully

---

## References & Sources

### Dataset
- NYC TLC Trip Record Data: https://www.nyc.gov/site/tlc/about/tlc-trip-record-data.page
- TLC Zone Lookup CSV: https://d37ci6vzurychx.cloudfront.net/misc/taxi_zone_lookup.csv
- TLC Zone Shapefiles: https://d37ci6vzurychx.cloudfront.net/misc/taxi_zones.zip
- TLC Data Dictionary (Yellow Trips): https://www.nyc.gov/assets/tlc/downloads/pdf/data_dictionary_trip_records_yellow.pdf

### Algorithms & Data Structures
- Cormen, T. H. et al. (2009). *Introduction to Algorithms*, 3rd ed. MIT Press.
- Skiena, S. S. (2008). *The Algorithm Design Manual*, 2nd ed. Springer.
- Merge sort visualisation: https://visualgo.net/en/sorting
- Big-O cheat sheet: https://www.bigocheatsheet.com/

### Data Engineering
- Kleppmann, M. (2017). *Designing Data-Intensive Applications*. O'Reilly.
- Rahm & Do (2000). Data cleaning: Problems and current approaches. *IEEE Data Engineering Bulletin*: https://www.researchgate.net/publication/228566264
- Node.js Streams: https://nodejs.org/api/stream.html
- csv-parse streaming API: https://csv.js.org/parse/api/stream/

### Database
- PostgreSQL documentation: https://www.postgresql.org/docs/
- Neon serverless Postgres: https://neon.tech/docs
- PostGIS documentation: https://postgis.net/documentation/
- PostgreSQL materialized views: https://www.postgresql.org/docs/current/sql-creatematerializedview.html
- pg (Node.js Postgres client): https://node-postgres.com/

### Frontend / Canvas
- MDN Canvas API tutorial: https://developer.mozilla.org/en-US/docs/Web/API/Canvas_API/Tutorial
- MDN Drawing shapes: https://developer.mozilla.org/en-US/docs/Web/API/Canvas_API/Tutorial/Drawing_shapes
- MDN `roundRect()`: https://developer.mozilla.org/en-US/docs/Web/API/CanvasRenderingContext2D/roundRect
- MDN `devicePixelRatio` (HiDPI canvases): https://developer.mozilla.org/en-US/docs/Web/API/Window/devicePixelRatio
- Observable — Bar chart pattern: https://observablehq.com/@d3/bar-chart
- Observable — Area chart pattern: https://observablehq.com/@d3/area-chart
- CSS custom properties: https://developer.mozilla.org/en-US/docs/Web/CSS/Using_CSS_custom_properties

### Typography & Icons
- Figtree font (Google Fonts): https://fonts.google.com/specimen/Figtree
- DM Mono font (Google Fonts): https://fonts.google.com/specimen/DM+Mono
- Lucide Icons (MIT): https://lucide.dev

### Related Work / Background Reading
- NYC TLC 2019 Annual Report: https://www.nyc.gov/assets/tlc/downloads/pdf/annual_report_2019.pdf
- Taxi tipping behaviour study (Haggag & Paci, 2014): https://www.aeaweb.org/articles?id=10.1257/aer.104.7.2183
  - This paper specifically analyses how the preset tip suggestions on NYC cab terminals influence tipping rates — directly relevant to our findings on card vs cash tip premiums.

---

*Built as part of the Urban Mobility Data Engineering course assignment.*  
*Dataset: NYC TLC Yellow Taxi Trip Records, January 2019.*