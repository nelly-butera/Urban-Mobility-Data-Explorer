# Urban Mobility Data Explorer - Data Integration & Cleaning Report

## Scope
This report documents cleaning and integration for:
- `datasets/taxi_zone_lookup.csv`
- `datasets/taxi_zones/*` (metadata from `taxi_zones.dbf` + projection metadata)
- Trip `.parquet` files under `datasets/`

`yellow_tripdata_2019-01.csv` was intentionally excluded from re-analysis.

## Implemented Pipeline
Entrypoint: `src/run_data_job.js`

Pipeline outputs:
- PostgreSQL tables in your target DB (`DATABASE_URL`)
- `artifacts/pipeline_run_summary.json`

Built tables:
- `trips_cleaned`
- `zones`
- `boroughs`
- `flagged_trips`
- `quality_log`
- `trips_staging`

## Data Integration
1. Discover all `.parquet` files in `datasets/`.
2. Normalize core trip fields into a single staging table.
3. Load `taxi_zone_lookup.csv` as canonical zone dimension.
4. Parse `taxi_zones.dbf` metadata and reconcile with lookup IDs.
5. Attach pickup/dropoff zone and borough labels to cleaned trips.

## Data Integrity Work
### `taxi_zone_lookup.csv` - exactly what was cleaned
- Enforced `LocationID` numeric parsing.
- Trimmed text fields: `Borough`, `Zone`, `service_zone`.
- Enforced non-blank required fields.
- Enforced unique `LocationID` (duplicate IDs would be excluded; first retained).

Observed in current file:
- 265 rows read, 265 retained.
- No invalid `LocationID`.
- No blank required fields.
- No duplicate `LocationID`.
- Special IDs retained for transparency:
  - `264` (`Unknown` / `N/A`)
  - `265` (`N/A` / `Outside of NYC`)

### `datasets/taxi_zones/*` metadata - exactly what was cleaned
Source cleaned: `datasets/taxi_zones/taxi_zones.dbf`

- Trimmed DBF fixed-width padding on all records.
- Parsed and validated numeric `LocationID`.
- Resolved duplicate shape-metadata rows by keeping one record per `LocationID`:
  - `LocationID 56`: 2 rows -> removed 1 duplicate
  - `LocationID 103`: 3 rows -> removed 2 duplicates
  - Total duplicate metadata rows excluded: **3**
- Reconciled against lookup IDs and marked these as non-mappable (no DBF geometry metadata):
  - **57, 104, 105, 264, 265**

Result:
- 265 canonical zone rows retained in `zones`
- `has_geometry = true` for 260 IDs, `false` for 5 IDs above
- No zones silently dropped

## Trip Integrity Rules (Parquet)
Rows are excluded from `trips_cleaned` when any of these hold:
- Exact natural-key duplicate (`duplicate_rank > 1`)
- Missing critical keys/timestamps (`pickup/dropoff`, `PU/DO LocationID`)
- Non-positive duration (`dropoff <= pickup`)
- Negative `trip_distance`, `fare_amount`, or `total_amount`

Suspicious rows are retained in `flagged_trips` when:
- `trip_distance > 0.5 AND (avg_speed_mph > 80 OR avg_speed_mph < 1)`
- `trip_distance > 0 AND (fare_per_mile > 50 OR fare_per_mile < 1)`
- `trip_duration_min < 1 AND trip_distance > 2`
- `fare_amount > 0 AND tip_amount > 50% of fare_amount`

All exclusions/flags are logged in `quality_log`.

## Normalization
- Timestamps cast to SQL `TIMESTAMP`.
- Numeric money/distance fields cast to `DOUBLE`.
- ID fields cast to `INTEGER`.
- `store_and_fwd_flag` standardized to uppercase trimmed text.
- Zone identifiers normalized to integer `location_id` and referenced through `zones`.

## Feature Engineering
Derived fields in `trips_cleaned`:
1. `trip_duration_min = (dropoff_ts - pickup_ts) / 60`
2. `revenue_per_minute = total_amount / trip_duration_min`
3. `fare_per_mile = total_amount / trip_distance`
4. `avg_speed_mph = trip_distance / trip_duration_hours`
5. `tip_percentage = 100 * tip_amount / fare_amount`
6. `pickup_hour`, `pickup_date`

These directly support:
- real-time zone profitability ranking
- congestion heat map
- suspicious trip detector
- borough flow matrix
- tip/payment behavior analysis

## Database Structure for Backend Features
Schema file: `sql/schema.sql` (PostgreSQL)

Core model:
- `zones(location_id, borough, zone, service_zone, has_geometry, map_status, ...)`
- `boroughs(borough_id, borough, borough_group)`
- `trips_staging(... normalized raw parquet rows ...)`
- `trips_cleaned(... raw + derived metrics + pickup/dropoff labels ...)`
- `flagged_trips(... anomaly_type, severity ...)`
- `quality_log(... issue_type, action, details ...)`

How each feature maps:
1. Real-time profitability ranking:
- Query `trips_cleaned` grouped by `pu_location_id` / `pickup_zone`
- Sort by `revenue_per_minute`, `fare_per_mile`, `tip_percentage`

2. Congestion heat map:
- Aggregate `avg_speed_mph` by `pu_location_id`
- Join with `zones` where `has_geometry = true`

3. Suspicious trip detector:
- Read directly from `flagged_trips`
- Breakdown by `anomaly_type`, zone, borough

4. Borough flow matrix:
- Group `trips_cleaned` by `pickup_borough`, `dropoff_borough`

5. Tip/payment intelligence:
- Analyze `tip_percentage` with `payment_type`, `pickup_hour`, borough labels

## Transparency Deliverables
- Complete rule-driven exclusions and suspicious flags in `quality_log`
- Zone geometry coverage status in `zones.map_status`
- Non-mappable IDs explicitly retained and reportable

## Algorithmic Logic and Data Structure
Manual implementation used:
- `src/basic_ds/TinyTopHeap.js`
- Applied in `src/work_steps/TopZonePicker.js` for:
  - `/api/profitability/top-zones`
  - `/api/flow/top-routes`

Approach:
- Use a fixed-size min-heap (`k` = endpoint limit)
- Stream candidate rows once
- Keep only best `k` scores by replacing heap root when a better score appears

Pseudo-code:
```text
TOP_K(rows, k, score_fn):
  heap = empty min_heap
  for row in rows:
    score = score_fn(row)
    if heap.size < k:
      heap.push(row, score)
    else if score > heap.min().score:
      heap.replace_min(row, score)
  return heap_to_descending_array(heap)
```

Complexity:
- Time: `O(n log k)`
- Space: `O(k)`
