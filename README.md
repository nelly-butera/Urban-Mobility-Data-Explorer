# Urban-Mobility-Data-Explorer
NYC taxi analytics backend for UrbanPulse NYC.

## Quick start
1. Install packages:
```powershell
npm.cmd install
```
2. Create `.env` from `.env.example`.
3. Put Neon/Postgres URL:
```env
DATABASE_URL='postgresql://neondb_owner:...@...neon.tech/neondb?sslmode=require&channel_binding=require'
PORT=3001
BATCH_SIZE=1000
```
4. Run ingest:
```powershell
npm.cmd run ingest
```
5. Start API:
```powershell
npm.cmd run api
```

Optional DB test:
```powershell
npm.cmd run db:check
```

## API response format
Every endpoint returns:
```json
{
  "data": "...",
  "meta": {
    "total": 0,
    "filtered": 0,
    "generated_at": "ISO_DATE"
  }
}
```

## Shared query filters
- `date_range`: `7d | 30d | quarter | ytd`
- `borough`: `manhattan | brooklyn | queens | bronx | staten_island | all`
- `payment_type`: `credit_card | cash | no_charge | all`
- `time_of_day`: `all | peak | off_peak | morning_rush | evening_rush`

Base URL: `http://localhost:3001`

## Main endpoint groups
- `/api/overview/*`
- `/api/profitability/*`
- `/api/congestion/*`
- `/api/flow/*`
- `/api/anomalies/*`
- `/api/tips/*`

## Data tables
Main tables:
- `trips_staging`
- `trips_cleaned`
- `flagged_trips`
- `zones`
- `boroughs`
- `quality_log`

Summary tables (for fast API):
- `summary_overview_daily`
- `summary_zone_daily`
- `summary_hourly`
- `summary_flow_daily`
- `summary_route_daily`
- `summary_anomaly_daily`

Schema file: `sql/schema.sql`

## Manual algorithm requirement
Custom data structure is used:
- `src/basic_ds/TinyTopHeap.js`
- Used by `src/work_steps/TopZonePicker.js`
- Used in endpoints:
  - `/api/profitability/top-zones`
  - `/api/flow/top-routes`

Algorithm explanation is in `docs/algorithm.md`.

## Security notes
- Helmet security headers.
- Rate limit (`express-rate-limit`).
- CORS enabled for static frontend.
- Filter values are validated before SQL.
- SQL uses parameter placeholders (safe against SQL injection).
- Pagination values have max limits.
- JSON body size limit (`100kb`).
- API is read-only (no update/delete routes).
- `.env` ignored by git.

## Beginner-style code structure
```text
src/
  setup_files/
    ReadSetup.js               # read cli/env setup values
  db_files/
    DbTasks.js                 # all SQL write + summary build tasks
  small_models/
    DataIssueNote.js           # simple issue note object
  read_files/
    ReadZoneLookupCsv.js       # read taxi_zone_lookup.csv
    ReadTaxiDbf.js             # read taxi_zones.dbf
    ReadTripParquet.js         # find and stream parquet files
  work_steps/
    CleanTripLine.js           # normalize raw trip row
    CleanZoneInfo.js           # clean zone lookup + dbf info
    RunPipelineStep.js         # full ingest flow
    TopZonePicker.js           # top-k ranking using custom heap
  basic_ds/
    TinyTopHeap.js             # manual min heap data structure
  api_helpers/
    ReadApiFilters.js          # validate filters + build SQL where
    ReadAnalyticsData.js       # read summary table data for API
    MakeApiReply.js            # standard response envelope
  small_tools/
    CheckNeonServer.js         # tiny db connection checker
  run_data_job.js              # pipeline command entry
  start_api.js                 # api server entry

scripts/
  run_ingest_job.js            # assignment ingest script
```

## Notes
- `yellow_tripdata_2019-01.csv` is not re-analyzed.
- Zone cleanup details are in `report.md`.
