# NYC Taxi Mobility Analytics Platform

Enterprise-level analytics backend for NYC taxi trip data, built with Node.js (raw `http` module) and PostgreSQL.

---

## Architecture

```
nyc-taxi-platform/
├── server.js                     # HTTP server entry point (no Express)
├── config.js                     # Centralised environment configuration
├── database.js                   # pg connection pool wrapper
├── schema.sql                    # PostgreSQL schema, indexes, materialised views
├── package.json
│
├── data_processing/
│   ├── dataLoader.js             # Full ETL pipeline orchestrator
│   ├── featureEngineering.js     # Derived feature computation
│   ├── deduplication.js          # Hash-table deduplication (no Set)
│   └── anomalyDetection.js       # Anomaly detection & partitioning
│
├── routes/
│   ├── index.js                  # Central router / dispatcher
│   ├── overview.js               # /api/overview/*
│   ├── profitability.js          # /api/profitability/*
│   ├── tips.js                   # /api/tips/*
│   └── anomalies.js              # /api/anomalies/*
│
└── utils/
    ├── mergeSort.js              # Custom O(n log n) merge sort
    ├── groupBy.js                # Custom O(n) groupBy + aggregation
    └── httpHelpers.js            # JSON responses, CORS, URL parsing
```

---

## Setup

### Prerequisites
- Node.js >= 18
- PostgreSQL >= 14

### 1. Install dependencies
```bash
npm install
```

### 2. Configure environment
```bash
export PG_HOST=localhost
export PG_PORT=5432
export PG_DATABASE=nyc_taxi
export PG_USER=postgres
export PG_PASSWORD=your_password

# Data file paths (pre-converted from Parquet to JSON)
export TRIPS_JSON_PATH=./data/taxi_trips.json
export ZONES_JSON_PATH=./data/taxi_zone_lookup.json
```

### 3. Create the database schema
```bash
psql -U postgres -d nyc_taxi -f schema.sql
```

### 4. Start the server
```bash
# Server only (data already loaded)
npm start

# Server + run ETL pipeline on startup
LOAD_DATA=true npm start
```

---

## API Reference

### Health
| Method | Path | Description |
|--------|------|-------------|
| GET | `/health` | Server health check |

### Overview
| Method | Path | Description |
|--------|------|-------------|
| GET | `/api/overview/kpis` | Top-level KPIs across all trips |
| GET | `/api/overview/trips-over-time` | Daily/hourly trip counts (`?granularity=day\|hour`) |
| GET | `/api/overview/top-zones` | Top pickup zones by volume (`?limit=20`) |

### Profitability
| Method | Path | Description |
|--------|------|-------------|
| GET | `/api/profitability/top-zones` | Zones ranked by revenue/minute (`?limit=20`) |
| GET | `/api/profitability/by-borough` | Revenue metrics grouped by borough |
| GET | `/api/profitability/by-hour` | Revenue metrics grouped by hour of day |

### Tips
| Method | Path | Description |
|--------|------|-------------|
| GET | `/api/tips/by-borough` | Tip metrics by pickup borough |
| GET | `/api/tips/by-hour` | Tip metrics by hour of day |
| GET | `/api/tips/payment-comparison` | Tip behaviour by payment type |

### Anomalies
| Method | Path | Description |
|--------|------|-------------|
| GET | `/api/anomalies/summary` | Count and rate of anomalies by type |
| GET | `/api/anomalies/list` | Paginated list (`?type=&limit=50&offset=0`) |

---

## Data Processing Pipeline

```
Raw JSON (trips + zones)
        │
        ▼
   Zone Join               O(n) — hash map lookup
        │
        ▼
Feature Engineering        O(n) — duration, speed, revenue/min, tip%
        │
        ▼
Deduplication              O(n) — plain object hash table (no Set)
        │
        ▼
Anomaly Detection          O(n) — 4 rule checks per trip
        │
   ┌────┴────┐
   ▼         ▼
 Clean     Anomalous
 Trips      Trips
   │         │
   ▼         ▼
taxi_trips  anomalous_trips  (PostgreSQL bulk insert, 500 rows/batch)
        │
        ▼
Refresh materialised views (mv_hourly_stats, mv_zone_stats)
```

### Anomaly Types
| Type | Condition |
|------|-----------|
| `zero_distance_positive_fare` | `trip_distance == 0` and `fare_amount > 0` |
| `excessive_speed` | `average_speed_mph > 80` |
| `invalid_duration` | `trip_duration_minutes <= 0` or null |
| `excessive_tip_percentage` | `tip_percentage > 100%` |

### Custom Algorithms
- **Merge Sort** (`utils/mergeSort.js`) — O(n log n), no `Array.sort()`
- **groupBy** (`utils/groupBy.js`) — O(n) single pass, no `reduce()` or lodash
- **Deduplication** (`data_processing/deduplication.js`) — O(n) hash table, no `Set`

---

## Response Envelope

All endpoints return:
```json
{
  "success": true,
  "data": <payload>,
  "meta": { "count": 42 }
}
```

Errors:
```json
{
  "success": false,
  "error": {
    "message": "Route not found",
    "details": "..."
  }
}
```
