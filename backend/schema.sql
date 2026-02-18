-- =============================================================================
-- schema.sql
-- NYC Taxi Mobility Analytics Platform – PostgreSQL Schema
-- =============================================================================

-- ---------------------------------------------------------------------------
-- Extensions
-- ---------------------------------------------------------------------------
CREATE EXTENSION IF NOT EXISTS "uuid-ossp";

-- ---------------------------------------------------------------------------
-- Taxi Zone Lookup
-- ---------------------------------------------------------------------------
CREATE TABLE IF NOT EXISTS taxi_zones (
    location_id   INTEGER       PRIMARY KEY,
    borough       VARCHAR(50)   NOT NULL,
    zone          VARCHAR(100)  NOT NULL,
    service_zone  VARCHAR(50)
);

-- ---------------------------------------------------------------------------
-- Processed Taxi Trips (cleaned, feature-enriched)
-- ---------------------------------------------------------------------------
CREATE TABLE IF NOT EXISTS taxi_trips (
    trip_id                UUID          PRIMARY KEY DEFAULT uuid_generate_v4(),

    -- Raw fields
    vendor_id              SMALLINT,
    pickup_datetime        TIMESTAMPTZ   NOT NULL,
    dropoff_datetime       TIMESTAMPTZ   NOT NULL,
    passenger_count        SMALLINT,
    trip_distance          NUMERIC(8, 2),
    rate_code_id           SMALLINT,
    store_and_fwd_flag     CHAR(1),
    pu_location_id         INTEGER       REFERENCES taxi_zones(location_id),
    do_location_id         INTEGER       REFERENCES taxi_zones(location_id),
    payment_type           SMALLINT,
    fare_amount            NUMERIC(10, 2),
    extra                  NUMERIC(8, 2),
    mta_tax                NUMERIC(8, 2),
    tip_amount             NUMERIC(10, 2),
    tolls_amount           NUMERIC(8, 2),
    improvement_surcharge  NUMERIC(8, 2),
    total_amount           NUMERIC(10, 2),
    congestion_surcharge   NUMERIC(8, 2),

    -- Derived features (computed during data processing)
    trip_duration_minutes  NUMERIC(8, 2),
    average_speed_mph      NUMERIC(8, 2),
    revenue_per_minute     NUMERIC(10, 4),
    tip_percentage         NUMERIC(8, 2),

    -- Audit
    created_at             TIMESTAMPTZ   NOT NULL DEFAULT NOW()
);

-- ---------------------------------------------------------------------------
-- Anomalous Trips (flagged during processing)
-- ---------------------------------------------------------------------------
CREATE TABLE IF NOT EXISTS anomalous_trips (
    anomaly_id     UUID         PRIMARY KEY DEFAULT uuid_generate_v4(),
    trip_id        UUID         NOT NULL,   -- original trip identifier (may not exist in taxi_trips)
    anomaly_type   VARCHAR(80)  NOT NULL,   -- e.g. 'zero_distance_positive_fare'
    anomaly_detail JSONB,                   -- arbitrary context about the anomaly
    raw_record     JSONB        NOT NULL,   -- full original row for forensics
    detected_at    TIMESTAMPTZ  NOT NULL DEFAULT NOW()
);

CREATE INDEX IF NOT EXISTS idx_anomalous_trips_type ON anomalous_trips(anomaly_type);
CREATE INDEX IF NOT EXISTS idx_anomalous_trips_trip  ON anomalous_trips(trip_id);

-- ---------------------------------------------------------------------------
-- Indexes on taxi_trips for common query patterns
-- ---------------------------------------------------------------------------
CREATE INDEX IF NOT EXISTS idx_trips_pickup_dt      ON taxi_trips(pickup_datetime);
CREATE INDEX IF NOT EXISTS idx_trips_pu_location    ON taxi_trips(pu_location_id);
CREATE INDEX IF NOT EXISTS idx_trips_do_location    ON taxi_trips(do_location_id);
CREATE INDEX IF NOT EXISTS idx_trips_payment_type   ON taxi_trips(payment_type);
CREATE INDEX IF NOT EXISTS idx_trips_vendor_id      ON taxi_trips(vendor_id);
-- Partial index for high-revenue analysis
CREATE INDEX IF NOT EXISTS idx_trips_high_revenue
    ON taxi_trips(revenue_per_minute)
    WHERE revenue_per_minute IS NOT NULL;

-- ---------------------------------------------------------------------------
-- Materialised view: hourly aggregates (refresh after bulk load)
-- ---------------------------------------------------------------------------
CREATE MATERIALIZED VIEW IF NOT EXISTS mv_hourly_stats AS
SELECT
    DATE_TRUNC('hour', pickup_datetime)            AS hour_bucket,
    EXTRACT(HOUR FROM pickup_datetime)::INT        AS hour_of_day,
    COUNT(*)                                       AS trip_count,
    AVG(total_amount)                              AS avg_total_amount,
    AVG(tip_amount)                                AS avg_tip_amount,
    AVG(tip_percentage)                            AS avg_tip_percentage,
    AVG(trip_duration_minutes)                     AS avg_duration_minutes,
    AVG(average_speed_mph)                         AS avg_speed_mph,
    SUM(total_amount)                              AS total_revenue,
    AVG(revenue_per_minute)                        AS avg_revenue_per_minute
FROM taxi_trips
GROUP BY 1, 2;

CREATE UNIQUE INDEX IF NOT EXISTS idx_mv_hourly_stats_bucket ON mv_hourly_stats(hour_bucket);

-- ---------------------------------------------------------------------------
-- Materialised view: zone-level aggregates
-- ---------------------------------------------------------------------------
CREATE MATERIALIZED VIEW IF NOT EXISTS mv_zone_stats AS
SELECT
    z.location_id,
    z.borough,
    z.zone,
    z.service_zone,
    COUNT(t.trip_id)                               AS trip_count,
    AVG(t.total_amount)                            AS avg_fare,
    SUM(t.total_amount)                            AS total_revenue,
    AVG(t.tip_percentage)                          AS avg_tip_pct,
    AVG(t.revenue_per_minute)                      AS avg_revenue_per_minute,
    AVG(t.average_speed_mph)                       AS avg_speed
FROM taxi_zones z
LEFT JOIN taxi_trips t ON t.pu_location_id = z.location_id
GROUP BY z.location_id, z.borough, z.zone, z.service_zone;

CREATE UNIQUE INDEX IF NOT EXISTS idx_mv_zone_stats_loc ON mv_zone_stats(location_id);

-- ---------------------------------------------------------------------------
-- Helper function: refresh all materialised views
-- ---------------------------------------------------------------------------
CREATE OR REPLACE FUNCTION refresh_analytics_views()
RETURNS VOID LANGUAGE plpgsql AS $$
BEGIN
    REFRESH MATERIALIZED VIEW CONCURRENTLY mv_hourly_stats;
    REFRESH MATERIALIZED VIEW CONCURRENTLY mv_zone_stats;
END;
$$;
