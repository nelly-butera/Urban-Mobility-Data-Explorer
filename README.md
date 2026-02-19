# Urban Mobility Data Explorer
### NYC Taxi Trip Analysis — January 2019

A full-stack data engineering and analytics project built on top of the NYC Taxi & Limousine Commission (TLC) public dataset. We built everything from scratch: a streaming ETL pipeline, a REST API server, a PostgreSQL database on Neon, and a four-page interactive dashboard all without using any framework shortcuts (no Express, no ORM, no chart libraries).


## Project Overview

The goal was to take a real-world, messy dataset of 7.67 million taxi trips and turn it into something useful clean data, a queryable API, and a dashboard that could the user useful insights. We wanted to answer questions like: which zones make drivers the most money per minute? Do people tip more at night? How bad is the data quality really?

We avoided using high-level abstractions. No Express.js, no Sequelize, no Chart.js, no lodash. All data structures sorting, grouping, deduplication are custom implementations.


## Dataset

**Source:** NYC Taxi & Limousine Commission (TLC) Trip Record Data  
**File:** `yellow_tripdata_2019-01.csv`  
**Size:** ~670 MB, 7,667,792 rows.  But we used a sample size of 1M rows because free tier dbs don't allow data over 500MB.

**Zone Lookup:**  
The TLC also publishes a taxi zone lookup CSV that maps location IDs (1–265) to borough and neighbourhood names.  

**Zone Shapefiles:**  
For geographic data, the TLC provides shapefiles with polygon boundaries for each zone.  


## Database Design

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

**`trips`** — Main fact table (~7.6M rows big table), so we used a sample of 1M records
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
 
- You can find more db design in our schema.sql file

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
Processed rows accumulate in a `tripBatch` array. When the batch reaches 2000 rows, we flush it to the database in a single parameterised bulk INSERT and empty the array. This gives us ~1000 round-trips to the database for 1M rows — fast enough to complete in 10-15 minutes depending on Neon tier and network latency.


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


### GroupBy & Aggregation

**File:** `utils/groupBy.js`

`groupBy()` groups an array by a key function using a plain object as a hash map:

```
Time:  O(n) — single forward pass
Space: O(n) — each element stored once
```

`aggregateGroups()` then computes `{ count, sum, min, max, avg }` for a numeric field across each group, also in `O(n)` total. We explicitly avoided `Array.prototype.reduce()` as required, using manual `for` loops instead.

A guard was added after discovering a silent bug: if `keyFn` returns `null` or `undefined`, `String(null)` silently creates a group named `"null"`, which contaminates aggregations. The guard throws early with a clear message instead.


### Deduplication Hash Table

**File:** `data_processing/deduplication.js`

Uses a plain object (`Object.create(null)`) as a hash table. The `buildTripKey()` function joins six fields with a `|` delimiter to create a composite key. `Object.create(null)` is used rather than `{}` to avoid any prototype chain collisions (e.g., a key named `constructor` or `toString`).

```
Time:  O(n) — single pass, O(1) average lookup/insert
Space: O(n) — at most n keys
```

**Why not `Set`?** The assignment explicitly prohibited built-in data structures beyond plain arrays and objects.

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

## Setup Instructions

### Prerequisites

- Node.js ≥ 18.0.0
- A PostgreSQL database with the PostGIS extension (we used Neon — free tier works)
- The dataset files (see [Dataset](#dataset) section above)

### Step 1 — Clone and install

```bash
git clone https://github.com/nelly-butera/Urban-Mobility-Data-Explorer.git
cd Urban-Mobility-Data-Explorer/backend
npm install
```

### Step 2 — Environment variables

Create a `.env` file in the `backend/` directory:

```env
# lending you my connection string 
DATABASE_URL=DATABASE_URL='postgresql://neondb_owner:npg_bSp7KyU2XxIQ@ep-twilight-smoke-aizcorrp-pooler.c-4.us-east-1.aws.neon.tech/neondb?sslmode=require&channel_binding=require'
PORT=3000
HOST=0.0.0.0
TRIPS_CSV_PATH=./datasets/yellow_tripdata_2019-01.csv
ZONES_CSV_PATH=./datasets/taxi_zone_lookup.csv
SHAPEFILE_PATH=./datasets/taxi_zones/taxi_zones.shp

```

Replace `DATABASE_URL` with your own Neon connection string and reupload the data urself if u want and if u decide to do that, the following steps explain the proper setup.

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

**Download the dataset** from the TLC website and place the files in a `dataset/` folder at the project root.

```bash
# Run the full ETL pipeline (takes 20–40 minutes for 7.6M rows and 10-12 minutes for 1M rows)
node -e "
  require('dotenv').config();
  const { loadData } = require('./data_processing/dataLoader');
  loadData()
    .then(s => { console.log('Done:', s); process.exit(0); })
    .catch(e => { console.error('Failed:', e.message); process.exit(1); });
"
```

You'll see progress logs every ~100,000 rows. Don't close the terminal.

**Load zone shapefiles** (for geographic data):
```bash
node scripts/loadShapefile.js
```

### Step 5 — Refresh materialized views

After the data load completes, run this in the Neon SQL Editor:

```sql
SELECT update_stats();

-- Verify:
SELECT COUNT(*) FROM hourly_stats;   -- should be ~148
SELECT COUNT(*) FROM zone_stats;     -- should be 265
```

### Step 6 — Start the API server

```bash
node server.js
# Server starts at http://localhost:3000

# Smoke test:
curl http://localhost:3000/api/overview/kpis
```

### Step 7 — Open the dashboard

The frontend is plain static HTML — no build step needed.

```bash
# From the frontend directory:
cd ../frontend
- And just open `index.html` directly in your browser. The JS fetches from `http://localhost:3000/api`, so the backend must be running.

### Verify everything is working

```bash
curl http://localhost:3000/api/overview/kpis
# Should return total_trips around 1M records because all 7M couldn't uploaded to a free tier db, avg_fare ~$14

curl http://localhost:3000/api/anomalies/summary
# Should return unique_flagged_rows ~40,000

```

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

## References & Sources

### Frontend / Canvas
- MDN Canvas API tutorial: https://developer.mozilla.org/en-US/docs/Web/API/Canvas_API/Tutorial
- MDN Drawing shapes: https://developer.mozilla.org/en-US/docs/Web/API/Canvas_API/Tutorial/Drawing_shapes
- MDN `roundRect()`: https://developer.mozilla.org/en-US/docs/Web/API/CanvasRenderingContext2D/roundRect
- MDN `devicePixelRatio` (HiDPI canvases): https://developer.mozilla.org/en-US/docs/Web/API/Window/devicePixelRatio
- Observable — Bar chart pattern: https://observablehq.com/@d3/bar-chart
- Observable — Area chart pattern: https://observablehq.com/@d3/area-chart
- CSS custom properties: https://developer.mozilla.org/en-US/docs/Web/CSS/Using_CSS_custom_properties


### Icons
- Lucide Icons (MIT): https://lucide.dev

### Related Work / Background Reading
- NYC TLC 2019 Annual Report: https://www.nyc.gov/assets/tlc/downloads/pdf/annual_report_2019.pdf
- Taxi tipping behaviour study (Haggag & Paci, 2014): https://www.aeaweb.org/articles?id=10.1257/aer.104.7.2183
  - This paper specifically analyses how the preset tip suggestions on NYC cab terminals influence tipping rates — directly relevant to our findings on card vs cash tip premiums.
