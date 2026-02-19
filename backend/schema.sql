-- schema.sql
-- Sets up the full database for the NYC taxi analytics project.
-- Run this once before loading any data.
-- Make sure postgis and uuid-ossp are available on your postgres instance first.


CREATE EXTENSION IF NOT EXISTS "uuid-ossp";
CREATE EXTENSION IF NOT EXISTS "postgis";


-- ============================================================
-- TAXI ZONES
-- This is the small lookup table from taxi_zone_lookup.csv.
-- Has to be created before taxi_trips because trips reference it.
-- IDs 264 and 265 (Unknown / Outside NYC) are included even though
-- they don't have shapefile geometry — we still need them here
-- so the foreign key on taxi_trips doesn't break.
-- ============================================================

CREATE TABLE IF NOT EXISTS taxi_zones (
    location_id   INTEGER      PRIMARY KEY,
    borough       VARCHAR(50),
    zone          VARCHAR(100),
    service_zone  VARCHAR(50)
);


-- ============================================================
-- ZONE GEOMETRY
-- Stores the actual boundary shapes from the .shp file.
-- Kept separate from taxi_zones because not every location_id
-- has a clean shape (264/265 have none, and 56/103 are duplicated
-- in the shapefile). We flag those with is_mappable = false.
--
-- The shapefile comes in EPSG:2263 (NY state plane, feet) so we
-- store that plus a WGS84 version that the frontend can actually use.
-- ============================================================

CREATE TABLE IF NOT EXISTS taxi_zone_geometry (
    geo_id       SERIAL    PRIMARY KEY,
    location_id  INTEGER,
    shape_area   NUMERIC(20, 4),
    shape_len    NUMERIC(20, 4),
    geom         GEOMETRY(MultiPolygon, 2263),
    geom_wgs84   GEOMETRY(MultiPolygon, 4326),
    is_mappable  BOOLEAN   NOT NULL DEFAULT TRUE,
    notes        TEXT
);

CREATE INDEX IF NOT EXISTS idx_zone_geom_loc
    ON taxi_zone_geometry(location_id);

CREATE INDEX IF NOT EXISTS idx_zone_geom_spatial
    ON taxi_zone_geometry USING GIST(geom_wgs84);


-- ============================================================
-- TAXI TRIPS
-- Main fact table. Sourced from yellow_tripdata_2019-01.csv.
-- Around 7.67 million rows after the full month loads in.
--
-- A few notes on decisions made here:
--   - congestion_surcharge is nullable on purpose. 63% of rows
--     are missing it so treating blanks as 0 would be misleading.
--   - The FK references to taxi_zones are deferrable so the bulk
--     insert script can work in batches without blowing up.
--   - Derived columns (duration, speed, etc.) get computed by the
--     Node pipeline and written in alongside the raw values.
--   - pickup_hour and pickup_weekday are stored as plain integers
--     so we can GROUP BY them cheaply without calling EXTRACT
--     on every single query.
-- ============================================================

CREATE TABLE IF NOT EXISTS taxi_trips (
    trip_id                UUID         PRIMARY KEY DEFAULT uuid_generate_v4(),

    vendor_id              SMALLINT,
    pickup_datetime        TIMESTAMPTZ  NOT NULL,
    dropoff_datetime       TIMESTAMPTZ  NOT NULL,
    passenger_count        SMALLINT,
    trip_distance          NUMERIC(8, 2)  NOT NULL DEFAULT 0,
    rate_code_id           SMALLINT,
    store_and_fwd_flag     CHAR(1),

    pu_location_id         INTEGER
        REFERENCES taxi_zones(location_id)
        DEFERRABLE INITIALLY DEFERRED,

    do_location_id         INTEGER
        REFERENCES taxi_zones(location_id)
        DEFERRABLE INITIALLY DEFERRED,

    payment_type           SMALLINT,
    fare_amount            NUMERIC(10, 2),
    extra                  NUMERIC(8, 2),
    mta_tax                NUMERIC(8, 2),
    tip_amount             NUMERIC(10, 2),
    tolls_amount           NUMERIC(8, 2),
    improvement_surcharge  NUMERIC(8, 2),
    total_amount           NUMERIC(10, 2),
    congestion_surcharge   NUMERIC(8, 2),  -- nullable, 63% of rows missing this

    -- computed by the ETL pipeline
    trip_duration_minutes  NUMERIC(8, 2),
    average_speed_mph      NUMERIC(8, 2),
    revenue_per_minute     NUMERIC(10, 4),
    tip_percentage         NUMERIC(8, 2),
    fare_per_mile          NUMERIC(10, 4),

    -- pulled out of pickup_datetime for faster grouping
    pickup_hour            SMALLINT,
    pickup_weekday         SMALLINT,  -- 0 = Sunday, 6 = Saturday
    is_peak_hour           BOOLEAN,   -- true if hour is 7-9 or 16-19

    created_at             TIMESTAMPTZ  NOT NULL DEFAULT NOW()
);

CREATE INDEX IF NOT EXISTS idx_trips_pickup_dt
    ON taxi_trips(pickup_datetime);

CREATE INDEX IF NOT EXISTS idx_trips_pickup_hour
    ON taxi_trips(pickup_hour);

CREATE INDEX IF NOT EXISTS idx_trips_pickup_weekday
    ON taxi_trips(pickup_weekday);

CREATE INDEX IF NOT EXISTS idx_trips_is_peak
    ON taxi_trips(is_peak_hour);

CREATE INDEX IF NOT EXISTS idx_trips_pu_location
    ON taxi_trips(pu_location_id);

CREATE INDEX IF NOT EXISTS idx_trips_do_location
    ON taxi_trips(do_location_id);

CREATE INDEX IF NOT EXISTS idx_trips_payment_type
    ON taxi_trips(payment_type);

CREATE INDEX IF NOT EXISTS idx_trips_vendor_id
    ON taxi_trips(vendor_id);

-- only index rows where revenue_per_minute was actually computable
CREATE INDEX IF NOT EXISTS idx_trips_revenue
    ON taxi_trips(revenue_per_minute)
    WHERE revenue_per_minute IS NOT NULL;


-- ============================================================
-- ANOMALOUS TRIPS
-- Rows that failed one or more of our quality checks end up here.
-- A trip can appear multiple times if it triggered multiple rules.
-- row_number matches the line in the original CSV so we can trace
-- back to the raw file if needed.
-- raw_record keeps the original values as JSON for reference.
-- ============================================================

CREATE TABLE IF NOT EXISTS anomalous_trips (
    anomaly_id     UUID         PRIMARY KEY DEFAULT uuid_generate_v4(),
    row_number     BIGINT,
    anomaly_type   VARCHAR(80)  NOT NULL,
    anomaly_detail JSONB,
    raw_record     JSONB        NOT NULL,
    detected_at    TIMESTAMPTZ  NOT NULL DEFAULT NOW()
);

CREATE INDEX IF NOT EXISTS idx_anomalous_type
    ON anomalous_trips(anomaly_type);

CREATE INDEX IF NOT EXISTS idx_anomalous_row
    ON anomalous_trips(row_number);


-- ============================================================
-- QUALITY LOG
-- One row per flag per trip. Tracks what was wrong, what column
-- triggered it, the original bad value, and what we did about it.
--
-- action_taken is one of: excluded / retained / set_null / imputed
--
-- Flag codes the pipeline uses:
--   DROPOFF_BEFORE_PICKUP, ZERO_DIST, LARGE_DIST, NEG_FARE,
--   NEG_TOTAL, NEG_TIP, ZERO_PASS, HIGH_PASS, BAD_RATE_CODE,
--   HIGH_SPEED, HIGH_TIP_PCT, ZERO_DIST_POS_FARE
-- ============================================================

CREATE TABLE IF NOT EXISTS quality_log (
    log_id         UUID         PRIMARY KEY DEFAULT uuid_generate_v4(),
    row_number     BIGINT       NOT NULL,
    flag_code      VARCHAR(40)  NOT NULL,
    action_taken   VARCHAR(20)  NOT NULL,
    reason         TEXT         NOT NULL,
    field_name     VARCHAR(50),
    original_value TEXT,
    logged_at      TIMESTAMPTZ  NOT NULL DEFAULT NOW()
);

CREATE INDEX IF NOT EXISTS idx_quality_flag
    ON quality_log(flag_code);

CREATE INDEX IF NOT EXISTS idx_quality_row
    ON quality_log(row_number);

CREATE INDEX IF NOT EXISTS idx_quality_action
    ON quality_log(action_taken);


-- ============================================================
-- MATERIALISED VIEW: hourly stats
-- Pre-aggregated so the /api/overview and /api/profitability
-- endpoints don't have to scan the full trips table every call.
-- Refresh this after the bulk load finishes.
-- ============================================================

CREATE MATERIALIZED VIEW IF NOT EXISTS mv_hourly_stats AS
SELECT
    DATE_TRUNC('hour', pickup_datetime)     AS hour_bucket,
    EXTRACT(HOUR FROM pickup_datetime)::INT AS hour_of_day,
    COUNT(*)                                AS trip_count,
    AVG(total_amount)                       AS avg_total_amount,
    AVG(tip_amount)                         AS avg_tip_amount,
    AVG(tip_percentage)                     AS avg_tip_percentage,
    AVG(trip_duration_minutes)              AS avg_duration_minutes,
    AVG(average_speed_mph)                  AS avg_speed_mph,
    SUM(total_amount)                       AS total_revenue,
    AVG(revenue_per_minute)                 AS avg_revenue_per_minute
FROM taxi_trips
GROUP BY 1, 2;

CREATE UNIQUE INDEX IF NOT EXISTS idx_mv_hourly_bucket
    ON mv_hourly_stats(hour_bucket);


-- ============================================================
-- MATERIALISED VIEW: zone stats
-- Zone-level roll-up used by the map and profitability endpoints.
-- is_mappable comes from taxi_zone_geometry — any zone that has
-- no clean shape (264, 265, duplicate IDs) gets false here so
-- the frontend knows not to try rendering a polygon for it.
-- ============================================================

CREATE MATERIALIZED VIEW IF NOT EXISTS mv_zone_stats AS
SELECT
    z.location_id,
    z.borough,
    z.zone,
    z.service_zone,
    COUNT(t.trip_id)           AS trip_count,
    AVG(t.total_amount)        AS avg_fare,
    SUM(t.total_amount)        AS total_revenue,
    AVG(t.tip_percentage)      AS avg_tip_pct,
    AVG(t.revenue_per_minute)  AS avg_revenue_per_minute,
    AVG(t.average_speed_mph)   AS avg_speed,
    EXISTS (
        SELECT 1
        FROM taxi_zone_geometry g
        WHERE g.location_id = z.location_id
          AND g.is_mappable = TRUE
    ) AS is_mappable
FROM taxi_zones z
LEFT JOIN taxi_trips t ON t.pu_location_id = z.location_id
GROUP BY z.location_id, z.borough, z.zone, z.service_zone;

CREATE UNIQUE INDEX IF NOT EXISTS idx_mv_zone_stats_loc
    ON mv_zone_stats(location_id);


-- ============================================================
-- HELPER FUNCTION
-- Call this after the bulk load completes to bring both
-- materialised views up to date.
--   SELECT refresh_analytics_views();
-- ============================================================

CREATE OR REPLACE FUNCTION refresh_analytics_views()
RETURNS VOID
LANGUAGE plpgsql AS $$
BEGIN
    REFRESH MATERIALIZED VIEW CONCURRENTLY mv_hourly_stats;
    REFRESH MATERIALIZED VIEW CONCURRENTLY mv_zone_stats;
END;
$$;