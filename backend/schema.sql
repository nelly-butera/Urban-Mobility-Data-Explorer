-- schema.sql
-- Group project: NYC Taxi Trip Analysis
-- Need postgis and uuid extensions for this to work

CREATE EXTENSION IF NOT EXISTS "uuid-ossp";
CREATE EXTENSION IF NOT EXISTS "postgis";

-- lookup table for the zones (from the csv)
CREATE TABLE zones (
    id            INTEGER PRIMARY KEY,
    borough       VARCHAR(50),
    zone_name     VARCHAR(100),
    service_zone  VARCHAR(50)
);

-- this holds the map shapes for the dashboard
CREATE TABLE zone_shapes (
    id           SERIAL PRIMARY KEY,
    location_id  INTEGER,
    area         NUMERIC,
    len          NUMERIC,
    geom         GEOMETRY(MultiPolygon, 2263), -- NY state plane
    geom_web     GEOMETRY(MultiPolygon, 4326), -- WGS84 for the map
    mappable     BOOLEAN DEFAULT TRUE,
    notes        TEXT
);

-- simple indexes for map speed
CREATE INDEX shape_id_idx ON zone_shapes(location_id);
CREATE INDEX spatial_idx ON zone_shapes USING GIST(geom_web);

-- the big table for all the trips (7M+ rows)
CREATE TABLE trips (
    id                UUID PRIMARY KEY DEFAULT uuid_generate_v4(),
    vendor            SMALLINT,
    pickup_time       TIMESTAMPTZ NOT NULL,
    dropoff_time      TIMESTAMPTZ NOT NULL,
    passengers        SMALLINT,
    distance          NUMERIC(8, 2) DEFAULT 0,
    rate_id           SMALLINT,
    store_fwd         CHAR(1),
    
    -- join these to the zones table
    pickup_zone       INTEGER REFERENCES zones(id) DEFERRABLE INITIALLY DEFERRED,
    dropoff_zone      INTEGER REFERENCES zones(id) DEFERRABLE INITIALLY DEFERRED,

    payment_type      SMALLINT,
    fare              NUMERIC(10, 2),
    extra             NUMERIC(8, 2),
    tax               NUMERIC(8, 2),
    tip               NUMERIC(10, 2),
    tolls             NUMERIC(8, 2),
    surcharge         NUMERIC(8, 2),
    total             NUMERIC(10, 2),
    congestion        NUMERIC(8, 2),

    -- our calculated columns (feature engineering)
    duration_min      NUMERIC(8, 2),
    speed_mph         NUMERIC(8, 2),
    money_per_min     NUMERIC(10, 4),
    tip_pct           NUMERIC(8, 2),
    cost_per_mile     NUMERIC(10, 4),

    -- extra columns for faster charts
    hour_of_day       SMALLINT,
    day_of_week       SMALLINT, -- 0-6
    is_peak           BOOLEAN,
    created_at        TIMESTAMPTZ DEFAULT NOW()
);

-- Indexes for the dashboard filters
CREATE INDEX pickup_time_idx ON trips(pickup_time);
CREATE INDEX pickup_zone_idx ON trips(pickup_zone);
CREATE INDEX dropoff_zone_idx ON trips(dropoff_zone);

-- Table for bad data we found during cleaning
CREATE TABLE error_log (
    err_id      UUID PRIMARY KEY DEFAULT uuid_generate_v4(),
    row_num     BIGINT,
    err_type    VARCHAR(100),
    details     JSONB,
    raw_data    JSONB,
    created_at  TIMESTAMPTZ DEFAULT NOW()
);

-- Summary table for the graphs (Materialized view so it loads fast)
CREATE MATERIALIZED VIEW hourly_stats AS
SELECT
    DATE_TRUNC('hour', pickup_time) AS hour_block,
    hour_of_day,
    COUNT(*) AS total_trips,
    AVG(total) AS avg_price,
    AVG(tip) AS avg_tip,
    AVG(tip_pct) AS avg_tip_pct,
    AVG(duration_min) AS avg_duration,
    AVG(speed_mph) AS avg_speed,
    SUM(total) AS revenue,
    AVG(money_per_min) AS earnings_per_min
FROM trips
GROUP BY 1, 2;

CREATE UNIQUE INDEX hourly_stats_idx ON hourly_stats(hour_block);

-- Summary for the map
CREATE MATERIALIZED VIEW zone_stats AS
SELECT
    z.id AS location_id,
    z.borough,
    z.zone_name,
    COUNT(t.id) AS trip_count,
    AVG(t.total) AS avg_fare,
    SUM(t.total) AS total_money,
    AVG(t.tip_pct) AS avg_tip_pct,
    AVG(t.money_per_min) AS avg_money_min,
    -- check if we actually have a shape to draw
    EXISTS (SELECT 1 FROM zone_shapes s WHERE s.location_id = z.id AND s.mappable = TRUE) AS has_shape
FROM zones z
LEFT JOIN trips t ON t.pickup_zone = z.id
GROUP BY z.id, z.borough, z.zone_name;

CREATE UNIQUE INDEX zone_stats_idx ON zone_stats(location_id);

-- Run this to update the graphs after importing data
CREATE OR REPLACE FUNCTION update_stats()
RETURNS VOID AS $$
BEGIN
    REFRESH MATERIALIZED VIEW CONCURRENTLY hourly_stats;
    REFRESH MATERIALIZED VIEW CONCURRENTLY zone_stats;
END;
$$ LANGUAGE plpgsql;