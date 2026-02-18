
CREATE TABLE IF NOT EXISTS boroughs (
  borough_id BIGSERIAL PRIMARY KEY,
  borough TEXT NOT NULL UNIQUE,
  borough_group TEXT NOT NULL
);

CREATE TABLE IF NOT EXISTS zones (
  location_id INTEGER PRIMARY KEY,
  borough TEXT NOT NULL,
  zone TEXT NOT NULL,
  service_zone TEXT NOT NULL,
  has_geometry BOOLEAN NOT NULL,
  geometry_record_count INTEGER NOT NULL,
  map_status TEXT NOT NULL,
  centroid_lat DOUBLE PRECISION,
  centroid_lng DOUBLE PRECISION
);

CREATE TABLE IF NOT EXISTS quality_log (
  quality_id BIGSERIAL PRIMARY KEY,
  event_ts TIMESTAMP NOT NULL,
  dataset TEXT NOT NULL,
  record_key TEXT NOT NULL,
  issue_type TEXT NOT NULL,
  action TEXT NOT NULL,
  details TEXT NOT NULL
);

CREATE TABLE IF NOT EXISTS trips_staging (
  source_file TEXT NOT NULL,
  source_row_num BIGINT NOT NULL,
  vendor_id INTEGER,
  pickup_ts TIMESTAMP,
  dropoff_ts TIMESTAMP,
  passenger_count INTEGER,
  trip_distance DOUBLE PRECISION,
  ratecode_id INTEGER,
  store_and_fwd_flag TEXT,
  pu_location_id INTEGER,
  do_location_id INTEGER,
  payment_type INTEGER,
  fare_amount DOUBLE PRECISION,
  extra DOUBLE PRECISION,
  mta_tax DOUBLE PRECISION,
  tip_amount DOUBLE PRECISION,
  tolls_amount DOUBLE PRECISION,
  improvement_surcharge DOUBLE PRECISION,
  total_amount DOUBLE PRECISION,
  congestion_surcharge DOUBLE PRECISION
);

CREATE TABLE IF NOT EXISTS trips_cleaned (
  trip_id BIGSERIAL PRIMARY KEY,
  source_file TEXT NOT NULL,
  source_row_num BIGINT NOT NULL,
  vendor_id INTEGER,
  pickup_ts TIMESTAMP NOT NULL,
  dropoff_ts TIMESTAMP NOT NULL,
  passenger_count INTEGER,
  trip_distance DOUBLE PRECISION NOT NULL,
  ratecode_id INTEGER,
  store_and_fwd_flag TEXT,
  pu_location_id INTEGER NOT NULL,
  do_location_id INTEGER NOT NULL,
  payment_type INTEGER,
  payment_type_group TEXT NOT NULL,
  fare_amount DOUBLE PRECISION NOT NULL,
  extra DOUBLE PRECISION,
  mta_tax DOUBLE PRECISION,
  tip_amount DOUBLE PRECISION,
  tolls_amount DOUBLE PRECISION,
  improvement_surcharge DOUBLE PRECISION,
  total_amount DOUBLE PRECISION NOT NULL,
  congestion_surcharge DOUBLE PRECISION,
  trip_duration_min DOUBLE PRECISION NOT NULL,
  revenue_per_minute DOUBLE PRECISION,
  fare_per_mile DOUBLE PRECISION,
  avg_speed_mph DOUBLE PRECISION,
  tip_percentage DOUBLE PRECISION,
  pickup_hour INTEGER,
  pickup_date DATE,
  time_bucket TEXT NOT NULL,
  pickup_borough TEXT,
  pickup_zone TEXT,
  pickup_service_zone TEXT,
  dropoff_borough TEXT,
  dropoff_zone TEXT,
  dropoff_service_zone TEXT
);

CREATE TABLE IF NOT EXISTS flagged_trips (
  flagged_id BIGSERIAL PRIMARY KEY,
  source_file TEXT NOT NULL,
  source_row_num BIGINT NOT NULL,
  pickup_ts TIMESTAMP,
  pickup_date DATE,
  pickup_hour INTEGER,
  payment_type_group TEXT,
  time_bucket TEXT,
  pickup_borough TEXT,
  pickup_zone TEXT,
  dropoff_borough TEXT,
  dropoff_zone TEXT,
  pu_location_id INTEGER,
  do_location_id INTEGER,
  trip_distance DOUBLE PRECISION,
  fare_amount DOUBLE PRECISION,
  tip_amount DOUBLE PRECISION,
  total_amount DOUBLE PRECISION,
  trip_duration_min DOUBLE PRECISION,
  avg_speed_mph DOUBLE PRECISION,
  fare_per_mile DOUBLE PRECISION,
  anomaly_type TEXT NOT NULL,
  severity TEXT NOT NULL
);

-- Summary tables for low-latency dashboard endpoints.
CREATE TABLE IF NOT EXISTS summary_overview_daily (
  pickup_date DATE NOT NULL,
  borough TEXT NOT NULL,
  payment_type_group TEXT NOT NULL,
  time_bucket TEXT NOT NULL,
  trip_count BIGINT NOT NULL,
  total_amount_sum DOUBLE PRECISION NOT NULL,
  fare_amount_sum DOUBLE PRECISION NOT NULL,
  tip_amount_sum DOUBLE PRECISION NOT NULL,
  tip_pct_sum DOUBLE PRECISION NOT NULL,
  tip_pct_count BIGINT NOT NULL,
  duration_min_sum DOUBLE PRECISION NOT NULL,
  speed_sum DOUBLE PRECISION NOT NULL,
  speed_count BIGINT NOT NULL,
  revenue_per_minute_sum DOUBLE PRECISION NOT NULL,
  revenue_per_minute_count BIGINT NOT NULL,
  flagged_trip_count BIGINT NOT NULL,
  PRIMARY KEY (pickup_date, borough, payment_type_group, time_bucket)
);

CREATE TABLE IF NOT EXISTS summary_zone_daily (
  pickup_date DATE NOT NULL,
  zone_id INTEGER NOT NULL,
  zone_name TEXT NOT NULL,
  borough TEXT NOT NULL,
  payment_type_group TEXT NOT NULL,
  time_bucket TEXT NOT NULL,
  lat DOUBLE PRECISION,
  lng DOUBLE PRECISION,
  trip_count BIGINT NOT NULL,
  revenue_per_minute_sum DOUBLE PRECISION NOT NULL,
  revenue_per_minute_count BIGINT NOT NULL,
  fare_per_mile_sum DOUBLE PRECISION NOT NULL,
  fare_per_mile_count BIGINT NOT NULL,
  tip_pct_sum DOUBLE PRECISION NOT NULL,
  tip_pct_count BIGINT NOT NULL,
  avg_speed_sum DOUBLE PRECISION NOT NULL,
  avg_speed_count BIGINT NOT NULL,
  total_amount_sum DOUBLE PRECISION NOT NULL,
  PRIMARY KEY (pickup_date, zone_id, payment_type_group, time_bucket)
);

CREATE TABLE IF NOT EXISTS summary_hourly (
  pickup_date DATE NOT NULL,
  pickup_hour INTEGER NOT NULL,
  borough TEXT NOT NULL,
  payment_type_group TEXT NOT NULL,
  time_bucket TEXT NOT NULL,
  trip_count BIGINT NOT NULL,
  revenue_per_minute_sum DOUBLE PRECISION NOT NULL,
  revenue_per_minute_count BIGINT NOT NULL,
  avg_speed_sum DOUBLE PRECISION NOT NULL,
  avg_speed_count BIGINT NOT NULL,
  tip_pct_sum DOUBLE PRECISION NOT NULL,
  tip_pct_count BIGINT NOT NULL,
  PRIMARY KEY (pickup_date, pickup_hour, borough, payment_type_group, time_bucket)
);

CREATE TABLE IF NOT EXISTS summary_flow_daily (
  pickup_date DATE NOT NULL,
  origin_borough TEXT NOT NULL,
  destination_borough TEXT NOT NULL,
  payment_type_group TEXT NOT NULL,
  time_bucket TEXT NOT NULL,
  trip_count BIGINT NOT NULL,
  total_amount_sum DOUBLE PRECISION NOT NULL,
  PRIMARY KEY (
    pickup_date,
    origin_borough,
    destination_borough,
    payment_type_group,
    time_bucket
  )
);

CREATE TABLE IF NOT EXISTS summary_route_daily (
  pickup_date DATE NOT NULL,
  pickup_zone TEXT NOT NULL,
  dropoff_zone TEXT NOT NULL,
  pickup_borough TEXT NOT NULL,
  payment_type_group TEXT NOT NULL,
  time_bucket TEXT NOT NULL,
  trip_count BIGINT NOT NULL,
  total_amount_sum DOUBLE PRECISION NOT NULL,
  PRIMARY KEY (
    pickup_date,
    pickup_zone,
    dropoff_zone,
    pickup_borough,
    payment_type_group,
    time_bucket
  )
);

CREATE TABLE IF NOT EXISTS summary_anomaly_daily (
  pickup_date DATE NOT NULL,
  borough TEXT NOT NULL,
  payment_type_group TEXT NOT NULL,
  time_bucket TEXT NOT NULL,
  anomaly_type TEXT NOT NULL,
  anomaly_count BIGINT NOT NULL,
  PRIMARY KEY (pickup_date, borough, payment_type_group, time_bucket, anomaly_type)
);

CREATE INDEX IF NOT EXISTS idx_trips_cleaned_pickup_zone ON trips_cleaned (pu_location_id);
CREATE INDEX IF NOT EXISTS idx_trips_cleaned_pickup_date ON trips_cleaned (pickup_date);
CREATE INDEX IF NOT EXISTS idx_trips_cleaned_payment_group ON trips_cleaned (payment_type_group);
CREATE INDEX IF NOT EXISTS idx_trips_cleaned_time_bucket ON trips_cleaned (time_bucket);
CREATE INDEX IF NOT EXISTS idx_trips_cleaned_pickup_borough ON trips_cleaned (pickup_borough);

CREATE INDEX IF NOT EXISTS idx_flagged_trips_date ON flagged_trips (pickup_date);
CREATE INDEX IF NOT EXISTS idx_flagged_trips_anomaly ON flagged_trips (anomaly_type);
CREATE INDEX IF NOT EXISTS idx_flagged_trips_borough ON flagged_trips (pickup_borough);

CREATE INDEX IF NOT EXISTS idx_summary_overview_filters
  ON summary_overview_daily (pickup_date, borough, payment_type_group, time_bucket);
CREATE INDEX IF NOT EXISTS idx_summary_zone_filters
  ON summary_zone_daily (pickup_date, borough, payment_type_group, time_bucket);
CREATE INDEX IF NOT EXISTS idx_summary_hourly_filters
  ON summary_hourly (pickup_date, borough, payment_type_group, time_bucket, pickup_hour);
CREATE INDEX IF NOT EXISTS idx_summary_flow_filters
  ON summary_flow_daily (pickup_date, origin_borough, payment_type_group, time_bucket);
CREATE INDEX IF NOT EXISTS idx_summary_route_filters
  ON summary_route_daily (pickup_date, pickup_borough, payment_type_group, time_bucket);
CREATE INDEX IF NOT EXISTS idx_summary_anomaly_filters
  ON summary_anomaly_daily (pickup_date, borough, payment_type_group, time_bucket, anomaly_type);
