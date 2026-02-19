# Urban Mobility Data Explorer - Simple Report Draft

## 1. What this assignment is asking us to do

In this project, we use real NYC taxi data.
Our job is to turn messy raw data into a useful app.

We need to do 4 things:121566569

1. Clean the data.
2. Put clean data in a database.
3. Build a backend (API) so data can be requested fast.
4. Build a frontend dashboard so people can explore patterns.

Basically a full project from data cleaning to a working app.

## 2. The 3 datasets we must use

### 2.1 `yellow_tripdata_2019-01.csv` (main trip table)

This is the biggest and most important file.
Each row is one taxi trip.

#### Yellow trip columns in simple words

| Column | What it stores | Why it helps us |
| --- | --- | --- |
| `VendorID` | Which taxi system recorded the trip | We can compare data patterns by vendor |
| `tpep_pickup_datetime` | Pickup date and time | Shows when rides start (busy hours, busy days) |
| `tpep_dropoff_datetime` | Dropoff date and time | Lets us find trip duration |
| `passenger_count` | Number of passengers | Shows ride size and bad values (like 0) |
| `trip_distance` | Trip distance in miles | Core movement value |
| `RatecodeID` | Fare type code | Separates normal rides vs special fare types |
| `store_and_fwd_flag` | If trip data was saved first and sent later (`Y/N`) | Helps with data quality checks |
| `PULocationID` | Pickup zone ID | Tells where rides start |
| `DOLocationID` | Dropoff zone ID | Tells where rides end |
| `payment_type` | How rider paid (card, cash, etc.) | Helps compare tipping and payment behavior |
| `fare_amount` | Base fare | Main fare before extra fees |
| `extra` | Extra fee | Shows added charges |
| `mta_tax` | MTA tax fee | Part of fare breakdown |
| `tip_amount` | Tip paid | Useful for tip behavior analysis |
| `tolls_amount` | Toll cost | Shows route-related extra cost |
| `improvement_surcharge` | TLC surcharge | Part of total fare breakdown |
| `total_amount` | Final total paid | Main money outcome per trip |
| `congestion_surcharge` | Congestion fee | Useful for policy impact and missing-value checks |

Quick idea:
- Time columns tell us **when**.
- Location IDs tell us **where**.
- Distance + duration tell us **how trips move**.
- Fare columns tell us **how much trips cost**.

### 2.2 `taxi_zone_lookup.csv` (zone name table)

This file translates zone IDs into readable names.

Main columns:

- `LocationID`
- `Borough`
- `Zone`
- `service_zone`

Why it matters:
Without this file, location IDs are just numbers.
With this file, we can say things like "Midtown" or "Queens".

### 2.3 `datasets/taxi_zones/` (map boundary files)

This folder has shapefile parts (`.shp`, `.dbf`, `.shx`, `.prj`).
It gives zone boundary shapes for maps.

Projection listed in `.prj`:
`NAD_1983_StatePlane_New_York_Long_Island_FIPS_3104_Feet`.

Why it matters:
It lets us draw maps and color each zone by trip activity.

## 3. How the 3 datasets work together

1. Use yellow trip file as the main data.
2. Join PU/DO IDs to `taxi_zone_lookup` so IDs become real zone names.
3. Join zone-level results to taxi zone shapes for maps.
4. Keep a quality log for bad or suspicious rows.

Simple model:
- Facts = trips
- Labels = lookup table
- Map shapes = taxi_zones files

## 4. What we found in the data (real profiling results)

### 4.1 Basic size and coverage

- Total trip rows: **7,667,792**
- Lookup rows: **265**
- Unique pickup IDs used: **263**
- Unique dropoff IDs used: **261**
- Invalid pickup/dropoff IDs vs lookup: **0**

### 4.2 Missing values

- `congestion_surcharge` missing: **4,855,978 (63.3295%)**
- Other main columns missing: **0**

### 4.3 Time and logic problems

- Dropoff before pickup: **4**
- Zero-duration trips: **6,290**
- Trips longer than 6 hours: **20,534**

### 4.4 Number outliers and strange values

- `trip_distance <= 0`: **54,770**
- `trip_distance > 100`: **32**
- `fare_amount < 0`: **7,131**
- `total_amount < 0`: **7,131**
- `tip_amount < 0`: **105**
- `passenger_count <= 0`: **117,381**
- `passenger_count > 8`: **9**
- Non-standard `RatecodeID`: **252**

Ranges seen:

- `trip_distance`: min **0.0**, max **831.8**
- `fare_amount`: min **-362.0**, max **623259.86**
- `total_amount`: min **-362.8**, max **623261.66**
- `passenger_count`: min **0**, max **9**

### 4.5 Fast insights from distributions

- Busiest pickup hour: **18:00**
- Trips at 18:00: **514,036** (**6.70%** of all trips)

Pickup borough share:

- Manhattan: **90.45%**
- Queens: **6.08%**
- Unknown: **2.08%**
- Brooklyn: **1.12%**
- Bronx: **0.20%**
- N/A: **0.05%**

Common pickup zones include:

- `237` Upper East Side South
- `236` Upper East Side North
- `161` Midtown Center
- `162` Midtown East
- `230` Times Sq/Theatre District

### 4.6 Important map join problem

The lookup IDs and map shape IDs do not match perfectly.

- Shapefile records: **263**
- Unique nonblank shape `LocationID`: **260**
- Lookup IDs not cleanly represented in shape IDs: **57, 104, 105, 264, 265**
- Duplicate shape IDs: `56` appears 2 times, `103` appears 3 times

High-usage IDs with map issues:

- `264` (Unknown): PU **159,760**, DO **149,094**
- `265` (Outside of NYC): PU **3,871**, DO **16,817**

What this means:
Our app must support a "not mappable" bucket.
We should not silently drop these trips.

### 4.7 Duplicate check (sample)

Checked first 1,000,000 rows for exact duplicate rows:

- Exact duplicates found: **0**

This is only a sample, but duplicates seem less serious than other data problems.

## 5. Our cleaning plan (simple version)

### 5.1 Data loading

1. Read trip file in chunks.
2. Load lookup table.
3. Load map metadata.

### 5.2 Data quality rules

1. Parse datetime values.
2. Flag rows where dropoff is before pickup.
3. Keep suspicious rows, but mark them with quality flags.
4. Keep `congestion_surcharge` as nullable (many rows missing).
5. Validate category codes and outliers.

### 5.3 Normalization

1. Use one datetime format.
2. Convert numbers to stable numeric types.
3. Keep IDs consistent for joins.

### 5.4 Features we can create

At least 3 derived features:

1. `trip_duration_min = dropoff - pickup`
2. `speed_mph = trip_distance / (trip_duration_min / 60)` when duration > 0
3. `fare_per_mile = total_amount / trip_distance` when distance > 0
4. Optional: `pickup_hour`, `pickup_weekday`, `is_peak_period`

### 5.5 Quality log for transparency

For suspicious rows, store:

- Row ID
- Flag code (`NEG_FARE`, `ZERO_DISTANCE`, etc.)
- Action taken (`retained`, `excluded`, `set_null`, `imputed`)
- Short reason

This helps us explain our decisions in the final report.

## 6. One unexpected thing that changed our design

Big surprise:
Trip IDs and lookup IDs mostly match, but map shape IDs are messy (missing and duplicate IDs).

Because of this, we must design both:

1. Map views for mappable zones
2. Non-map views for IDs that cannot be mapped cleanly

## 7. Why this report helps our next steps

This report gives us a strong base for the next parts:

1. Better database design
2. Better backend endpoints
3. Better frontend behavior with safe map fallback
4. Stronger final documentation with real evidence
