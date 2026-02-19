# NYC Taxi Mobility Analytics Platform

A full-stack data pipeline and analytics API built on Node.js (raw `http` module) and PostgreSQL (Neon-compatible).  
Processes the real **yellow_tripdata_2019-01.csv** (7.67M rows), **taxi_zone_lookup.csv**, and **taxi zone shapefiles** stored in your `datasets/` folder.

---

## Project Structure

```
your-project-root/
│
├── datasets/                          ← YOUR existing folder (do not move)
│   ├── yellow_tripdata_2019-01.csv    ← 7.67M trip rows
│   ├── taxi_zone_lookup.csv           ← 265 zone name rows
│   └── taxi_zones/                    ← shapefile folder
│       ├── taxi_zones.shp
│       ├── taxi_zones.dbf
│       ├── taxi_zones.shx
│       └── taxi_zones.prj
│
├── server.js                          ← HTTP server entry point (no Express)
├── config.js                          ← All env vars and path config
├── database.js                        ← pg pool (supports Neon connection string)
├── schema.sql                         ← Full PostgreSQL schema
├── package.json
│
├── data_processing/
│   ├── dataLoader.js                  ← Streaming CSV ETL pipeline (main script)
│   ├── featureEngineering.js          ← Derived feature computation
│   ├── deduplication.js               ← Hash-table dedup (no Set)
│   └── anomalyDetection.js            ← Quality rule checks
│
├── scripts/
│   └── loadShapefile.js               ← Loads .shp into taxi_zone_geometry
│
├── routes/
│   ├── index.js                       ← Central router dispatcher
│   ├── overview.js                    ← /api/overview/*
│   ├── profitability.js               ← /api/profitability/*
│   ├── tips.js                        ← /api/tips/*
│   └── anomalies.js                   ← /api/anomalies/*
│
└── utils/
    ├── mergeSort.js                   ← Custom O(n log n) merge sort
    ├── groupBy.js                     ← Custom O(n) groupBy (no reduce/lodash)
    └── httpHelpers.js                 ← JSON responses, CORS, URL helpers
```

---

## Database Tables

| Table | Source | Rows (approx.) | Purpose |
|---|---|---|---|
| `taxi_zones` | `taxi_zone_lookup.csv` | 265 | Zone ID → name/borough lookup |
| `taxi_zone_geometry` | `taxi_zones/*.shp` | 263 shapes | Zone boundary geometry for maps |
| `taxi_trips` | `yellow_tripdata_2019-01.csv` | ~7.4M (after cleaning) | Clean + enriched trip records |
| `anomalous_trips` | pipeline output | varies | Trips that failed quality rules |
| `quality_log` | pipeline output | varies | One row per flag per trip |

Two **materialised views** are refreshed after loading:

| View | Description |
|---|---|
| `mv_hourly_stats` | Aggregated metrics grouped by hour |
| `mv_zone_stats` | Aggregated metrics grouped by zone (includes `is_mappable` flag) |

---

## Setup Instructions

### Step 1 — Prerequisites

Make sure you have installed:

- **Node.js** version 18 or higher — check with `node --version`
- **npm** — check with `npm --version`
- A **Neon** account with a PostgreSQL database created (or a local PostgreSQL 14+ install)
- **PostGIS** extension available on your database  
  *(Neon supports PostGIS — enable it in Step 4)*

---

### Step 2 — Install npm dependencies

Open your terminal in the project root (the folder containing `server.js`) and run:

```bash
npm install
```

This installs four packages:

| Package | Why we need it |
|---|---|
| `pg` | PostgreSQL client for Node.js |
| `csv-parse` | Streaming CSV parser (handles 7.6M rows without loading into RAM) |
| `shapefile` | Reads `.shp` + `.dbf` files from your `datasets/taxi_zones/` folder |
| `proj4` | Reprojects shapefile coordinates from EPSG:2263 (feet) to WGS84 (degrees) |

---

### Step 3 — Set your environment variables

Create a file named `.env` in the project root, or export these variables in your terminal session.

#### Using Neon (recommended)

Copy your Neon connection string from the Neon dashboard.  
It looks like: `postgres://user:password@ep-xxx.us-east-2.aws.neon.tech/neondb?sslmode=require`

```bash
# .env file  (or paste these into your terminal)
DATABASE_URL=postgres://your-user:your-password@your-neon-host/your-db?sslmode=require
PORT=3000
```

That is all you need for Neon. The `database.js` file automatically detects `DATABASE_URL` and enables SSL.

#### Using local PostgreSQL instead

```bash
PG_HOST=localhost
PG_PORT=5432
PG_DATABASE=nyc_taxi
PG_USER=postgres
PG_PASSWORD=your_password
PORT=3000
```

> **Tip:** If you are using a `.env` file, install `dotenv` and add `require('dotenv').config()` at the very top of `server.js`. Or simply paste the export commands into your terminal before running any scripts.

---

### Step 4 — Apply the database schema

The `schema.sql` file creates all tables, indexes, and materialised views.  
Run it once against your database.

#### With Neon

Go to the **SQL Editor** in the Neon dashboard, open `schema.sql`, paste the entire contents, and click **Run**.  
*Or* use the Neon CLI / `psql` if you have it:

```bash
psql "$DATABASE_URL" -f schema.sql
```

#### With local PostgreSQL

```bash
psql -U postgres -d nyc_taxi -f schema.sql
```

> **What this creates:**
> - `uuid-ossp` and `postgis` extensions
> - Tables: `taxi_zones`, `taxi_zone_geometry`, `taxi_trips`, `anomalous_trips`, `quality_log`
> - All indexes
> - Materialised views `mv_hourly_stats` and `mv_zone_stats`
> - Helper function `refresh_analytics_views()`

---

### Step 5 — Load the shapefile

This script reads `datasets/taxi_zones/taxi_zones.shp`, reprojects the geometries, and inserts them into `taxi_zone_geometry`.  
It handles the known data quality issues automatically:

- Shape ID 56 appears **twice** → second occurrence is marked `is_mappable = false`
- Shape ID 103 appears **three times** → only the first is mappable
- IDs 264 and 265 have no shape → they remain in `taxi_zones` but not in `taxi_zone_geometry`

```bash
node scripts/loadShapefile.js
```

Expected output:
```
[Shapefile] Reading: .../datasets/taxi_zones/taxi_zones.shp
[Shapefile] Done. Processed=263 | Inserted=263 | Skipped=0
[Shapefile] Duplicate location IDs found:
  ID 56 appeared 2 times
  ID 103 appeared 3 times
```

---

### Step 6 — Run the data pipeline

This is the main ETL step. It streams the CSV in chunks of 500 rows so it never loads the full 7.6M rows into RAM.

**What it does per row:**
1. Parses all fields from the CSV
2. Joins pickup and dropoff IDs to the zone lookup (in-memory hash map)
3. Computes: `trip_duration_minutes`, `average_speed_mph`, `revenue_per_minute`, `tip_percentage`, `fare_per_mile`
4. Checks quality rules and writes to `quality_log`
5. Deduplicates using a hash table (no `Set`)
6. Separates anomalous from clean trips
7. Bulk-inserts into `taxi_trips` and `anomalous_trips`

Run it:

```bash
# Run the pipeline then start the server
LOAD_DATA=true node server.js
```

Or run the pipeline separately (useful for testing):

```bash
node -e "
  require('dotenv').config();
  const { loadData } = require('./data_processing/dataLoader');
  loadData().then(s => { console.log(s); process.exit(0); }).catch(console.error);
"
```

**Expected progress output:**
```
[Loader] Reading zone lookup: .../datasets/taxi_zone_lookup.csv
[Loader] Inserted 265 zones into taxi_zones
[Loader] Streaming trips from: .../datasets/yellow_tripdata_2019-01.csv
[Loader] Progress: 100,000 rows processed | clean=91,432 | anomalous=6,218 | excluded=2 | dupes=0
[Loader] Progress: 200,000 rows processed | ...
... (this runs for 15-30 minutes on a standard machine)
[Loader] Pipeline complete:
{
  "total_raw_rows": 7667792,
  "excluded": ~10,
  "duplicates": 0,
  "anomalous": ~200000,
  "clean": ~7400000,
  "inserted": ~7600000,
  "quality_log_rows": ~300000
}
```

> **Note on runtime:** Processing 7.6M rows with DB inserts takes time. Expect 15–40 minutes depending on your machine and network latency to Neon. The pipeline logs progress every 100,000 rows.

---

### Step 7 — Start the API server

```bash
node server.js
```

Output:
```
[Server] Database connection verified
[Server] NYC Taxi Analytics API listening on http://0.0.0.0:3000
[Server] Available endpoints:
  GET /health
  GET /api/overview/kpis
  GET /api/overview/trips-over-time
  GET /api/overview/top-zones
  GET /api/profitability/top-zones
  GET /api/profitability/by-borough
  GET /api/profitability/by-hour
  GET /api/tips/by-borough
  GET /api/tips/by-hour
  GET /api/tips/payment-comparison
  GET /api/anomalies/summary
  GET /api/anomalies/list
```

Test it:
```bash
curl http://localhost:3000/health
curl http://localhost:3000/api/overview/kpis
curl "http://localhost:3000/api/anomalies/list?type=HIGH_SPEED&limit=5"
```

---

## API Reference

All responses use this envelope:
```json
{
  "success": true,
  "data": <payload>,
  "meta": { "count": 42 }
}
```

Error responses:
```json
{
  "success": false,
  "error": { "message": "Route not found", "details": "..." }
}
```

### Overview endpoints

| Endpoint | Query params | Description |
|---|---|---|
| `GET /api/overview/kpis` | — | Total trips, revenue, avg fare, avg speed, anomaly count |
| `GET /api/overview/trips-over-time` | `granularity=day\|hour` | Trip counts and revenue by time period |
| `GET /api/overview/top-zones` | `limit=20` | Top pickup zones by volume |

### Profitability endpoints

| Endpoint | Query params | Description |
|---|---|---|
| `GET /api/profitability/top-zones` | `limit=20` | Zones ranked by avg revenue/minute |
| `GET /api/profitability/by-borough` | — | Revenue metrics per borough |
| `GET /api/profitability/by-hour` | — | Revenue metrics per hour of day |

### Tips endpoints

| Endpoint | Query params | Description |
|---|---|---|
| `GET /api/tips/by-borough` | — | Tip percentages per pickup borough |
| `GET /api/tips/by-hour` | — | Tip amounts per hour of day |
| `GET /api/tips/payment-comparison` | — | Tip behaviour by payment type (credit vs cash etc.) |

### Anomaly endpoints

| Endpoint | Query params | Description |
|---|---|---|
| `GET /api/anomalies/summary` | — | Count per anomaly type + overall anomaly rate |
| `GET /api/anomalies/list` | `type=`, `limit=50`, `offset=0` | Paginated anomalous trip records |

---

## Data Cleaning Decisions

### What gets excluded (rows dropped entirely)

| Condition | Count (from profiling) | Reason |
|---|---|---|
| Unparseable datetime | ~0 | Cannot compute any time features |
| Dropoff before or equal to pickup | 4 | Logically impossible; no features computable |

### What gets retained with quality flags

| Flag code | Condition | Count (approx.) |
|---|---|---|
| `ZERO_PASS` | `passenger_count ≤ 0` | 117,381 |
| `HIGH_PASS` | `passenger_count > 8` | 9 |
| `ZERO_DIST` | `trip_distance ≤ 0` | 54,770 |
| `LARGE_DIST` | `trip_distance > 100 miles` | 32 |
| `NEG_FARE` | `fare_amount < 0` | 7,131 |
| `NEG_TOTAL` | `total_amount < 0` | 7,131 |
| `NEG_TIP` | `tip_amount < 0` | 105 |
| `BAD_RATE_CODE` | `RatecodeID` not in 1–6 | 252 |
| `HIGH_SPEED` | `average_speed_mph > 80` | varies |
| `HIGH_TIP_PCT` | `tip_percentage > 100%` | varies |
| `ZERO_DIST_POS_FARE` | distance=0 but fare>0 | varies |

### `congestion_surcharge` is stored as NULL

63.3% of rows (4,855,978) are missing `congestion_surcharge`. The column is defined as `NULLABLE` in the schema — we do **not** impute zeros. Queries that use this field use `COALESCE` or `WHERE congestion_surcharge IS NOT NULL`.

### The unmappable zone problem

Zone IDs 264 ("Unknown") and 265 ("Outside of NYC") are used by 159,760 + 3,871 pickup trips respectively but have no shapefile geometry. The pipeline:

1. Inserts them into `taxi_zones` (so FK constraints hold)
2. Does **not** create rows in `taxi_zone_geometry` for them
3. Sets `is_mappable = false` in `mv_zone_stats` for these IDs
4. Frontend map code should check `is_mappable` before rendering a zone polygon

---

## Derived Features

| Feature | Formula | Stored in |
|---|---|---|
| `trip_duration_minutes` | `(dropoff - pickup)` in minutes | `taxi_trips` |
| `average_speed_mph` | `trip_distance / (duration_min / 60)` | `taxi_trips` |
| `revenue_per_minute` | `total_amount / trip_duration_minutes` | `taxi_trips` |
| `tip_percentage` | `(tip_amount / fare_amount) × 100` | `taxi_trips` |
| `fare_per_mile` | `total_amount / trip_distance` | `taxi_trips` |
| `pickup_hour` | `EXTRACT(HOUR FROM pickup_datetime)` | `taxi_trips` |
| `pickup_weekday` | `0=Sun … 6=Sat` | `taxi_trips` |
| `is_peak_hour` | hour in {7,8,9,16,17,18,19} | `taxi_trips` |

---

## Custom Algorithms (no Array.sort / reduce / lodash)

| File | Algorithm | Complexity |
|---|---|---|
| `utils/mergeSort.js` | Recursive merge sort | O(n log n) time, O(n) space |
| `utils/groupBy.js` | Plain object hash map grouping + aggregation | O(n) time, O(n) space |
| `data_processing/deduplication.js` | Hash table using `Object.create(null)` | O(n) time, O(n) space |

---

## Troubleshooting

**Pipeline runs but inserts 0 rows**  
Check that `DATABASE_URL` is correctly set and the schema was applied. Run `SELECT COUNT(*) FROM taxi_zones;` in Neon — it should be 265 after Step 5.

**PostGIS extension error on schema apply**  
In Neon, go to **Settings → Extensions** and enable PostGIS first, or run `CREATE EXTENSION postgis;` in the SQL editor before running schema.sql.

**Shapefile loader: "Cannot find module 'shapefile'"**  
Run `npm install` again — make sure you are in the project root folder.

**Pipeline is very slow**  
This is normal for 7.6M rows over a network connection to Neon. The `CHUNK_SIZE` in `dataLoader.js` is 500 rows per round-trip; you can increase it to 1000 to reduce round-trips (watch the PG 65,535 parameter limit though — with 26 columns × 1000 rows = 26,000 params, still safe).

**csv-parse version mismatch**  
The pipeline uses the `parse` named export from `csv-parse` v5. If you see `TypeError: parse is not a function`, make sure `csv-parse` is version 5+: `npm install csv-parse@5`.
