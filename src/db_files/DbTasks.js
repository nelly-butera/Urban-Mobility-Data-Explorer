/**
 * - Keep all PostgreSQL work in one class.
 * - Insert, clean, aggregate, and read counts all here.
 * - Other files call easy methods, not raw SQL everywhere.
 */
const fs = require("fs");
const path = require("path");
const { Client } = require("pg");

class DbTasks {
  constructor(dbUrl) {
    this.dbClient = new Client(this.#makeDbConfig(dbUrl));
  }

  async openDb() {
    await this.dbClient.connect();
  }

  async closeDb() {
    await this.dbClient.end();
  }

  async runSchemaFile(schemaFilePath = path.resolve("sql", "schema.sql")) {
    const sqlText = fs.readFileSync(schemaFilePath, "utf8");
    await this.dbClient.query(sqlText);
  }

  async clearOldPipelineData() {
    // We keep schema, but remove old data rows.
    await this.dbClient.query(`
      TRUNCATE TABLE flagged_trips RESTART IDENTITY;
      TRUNCATE TABLE trips_cleaned RESTART IDENTITY;
      TRUNCATE TABLE trips_staging RESTART IDENTITY;
      TRUNCATE TABLE quality_log RESTART IDENTITY;
      TRUNCATE TABLE summary_overview_daily;
      TRUNCATE TABLE summary_zone_daily;
      TRUNCATE TABLE summary_hourly;
      TRUNCATE TABLE summary_flow_daily;
      TRUNCATE TABLE summary_route_daily;
      TRUNCATE TABLE summary_anomaly_daily;
      TRUNCATE TABLE zones RESTART IDENTITY CASCADE;
      TRUNCATE TABLE boroughs RESTART IDENTITY CASCADE;
    `);
  }

  async saveZones(zoneRows) {
    if (!zoneRows.length) {
      return;
    }

    const values = [];
    const marks = [];
    let argPos = 1;

    for (const zone of zoneRows) {
      marks.push(
        `($${argPos}, $${argPos + 1}, $${argPos + 2}, $${argPos + 3}, $${argPos + 4}, $${argPos + 5}, $${argPos + 6}, $${argPos + 7}, $${argPos + 8})`
      );
      values.push(
        zone.locationId,
        zone.borough,
        zone.zone,
        zone.serviceZone,
        zone.hasGeometry,
        zone.geometryRecordCount,
        zone.mapStatus,
        null,
        null
      );
      argPos += 9;
    }

    await this.dbClient.query(
      `
      INSERT INTO zones (
        location_id, borough, zone, service_zone, has_geometry, geometry_record_count, map_status, centroid_lat, centroid_lng
      )
      VALUES ${marks.join(",")}
      `,
      values
    );
  }

  async makeBoroughTableFromZones() {
    await this.dbClient.query(`
      INSERT INTO boroughs (borough, borough_group)
      SELECT
        z.borough,
        CASE
          WHEN z.borough IN ('EWR', 'Unknown', 'N/A') THEN 'special'
          ELSE 'nyc_borough'
        END AS borough_group
      FROM zones z
      GROUP BY z.borough
      ORDER BY z.borough
    `);
  }

  async saveIssueNotes(noteRows) {
    if (!noteRows.length) {
      return;
    }

    const values = [];
    const marks = [];
    let argPos = 1;

    for (const note of noteRows) {
      marks.push(
        `($${argPos}, $${argPos + 1}, $${argPos + 2}, $${argPos + 3}, $${argPos + 4}, $${argPos + 5})`
      );
      values.push(
        new Date(),
        note.dataset,
        note.recordKey,
        note.issueType,
        note.action,
        note.details
      );
      argPos += 6;
    }

    await this.dbClient.query(
      `
      INSERT INTO quality_log (event_ts, dataset, record_key, issue_type, action, details)
      VALUES ${marks.join(",")}
      `,
      values
    );
  }

  async saveNoParquetNote() {
    await this.dbClient.query(`
      INSERT INTO quality_log (event_ts, dataset, record_key, issue_type, action, details)
      VALUES (NOW(), 'trip_parquet', 'all', 'NO_PARQUET_FILES_FOUND', 'skipped', 'No .parquet files were discovered under datasets directory')
    `);
    await this.rebuildSummaryTables();
  }

  async saveTripStageBatch(batchRows) {
    if (!batchRows.length) {
      return;
    }

    const values = [];
    const marks = [];
    let argPos = 1;

    for (const row of batchRows) {
      marks.push(
        `($${argPos}, $${argPos + 1}, $${argPos + 2}, $${argPos + 3}, $${argPos + 4}, $${argPos + 5}, $${argPos + 6}, $${argPos + 7}, $${argPos + 8}, $${argPos + 9}, $${argPos + 10}, $${argPos + 11}, $${argPos + 12}, $${argPos + 13}, $${argPos + 14}, $${argPos + 15}, $${argPos + 16}, $${argPos + 17}, $${argPos + 18}, $${argPos + 19})`
      );
      values.push(
        row.sourceFile,
        row.sourceRowNum,
        row.vendorId,
        row.pickupTs,
        row.dropoffTs,
        row.passengerCount,
        row.tripDistance,
        row.ratecodeId,
        row.storeAndFwdFlag,
        row.puLocationId,
        row.doLocationId,
        row.paymentType,
        row.fareAmount,
        row.extra,
        row.mtaTax,
        row.tipAmount,
        row.tollsAmount,
        row.improvementSurcharge,
        row.totalAmount,
        row.congestionSurcharge
      );
      argPos += 20;
    }

    await this.dbClient.query(
      `
      INSERT INTO trips_staging (
        source_file, source_row_num, vendor_id, pickup_ts, dropoff_ts, passenger_count,
        trip_distance, ratecode_id, store_and_fwd_flag, pu_location_id, do_location_id,
        payment_type, fare_amount, extra, mta_tax, tip_amount, tolls_amount,
        improvement_surcharge, total_amount, congestion_surcharge
      )
      VALUES ${marks.join(",")}
      `,
      values
    );
  }

  async makeCleanTripsAndFlags() {
    // This big SQL does:
    // 1) remove bad trips
    // 2) build clean metrics
    // 3) build anomaly rows
    // 4) log what was excluded
    await this.dbClient.query(`
      DROP TABLE IF EXISTS trip_quality_work;
      DROP TABLE IF EXISTS flagged_trip_unique_work;

      CREATE TEMP TABLE trip_quality_work AS
      WITH ranked AS (
        SELECT
          s.*,
          ROW_NUMBER() OVER (
            PARTITION BY
              s.pickup_ts, s.dropoff_ts, s.pu_location_id, s.do_location_id,
              s.passenger_count, s.trip_distance, s.fare_amount, s.tip_amount, s.total_amount
            ORDER BY s.source_file, s.source_row_num
          ) AS duplicate_rank
        FROM trips_staging s
      )
      SELECT
        r.*,
        EXTRACT(EPOCH FROM (r.dropoff_ts - r.pickup_ts)) / 60.0 AS trip_duration_min,
        EXTRACT(EPOCH FROM (r.dropoff_ts - r.pickup_ts)) / 3600.0 AS trip_duration_hr,
        (
          r.duplicate_rank > 1
          OR r.pickup_ts IS NULL
          OR r.dropoff_ts IS NULL
          OR r.pu_location_id IS NULL
          OR r.do_location_id IS NULL
          OR r.trip_distance IS NULL
          OR r.trip_distance < 0
          OR r.fare_amount IS NULL
          OR r.total_amount IS NULL
          OR r.fare_amount < 0
          OR r.total_amount < 0
          OR EXTRACT(EPOCH FROM (r.dropoff_ts - r.pickup_ts)) / 60.0 <= 0
        ) AS is_excluded
      FROM ranked r;

      INSERT INTO quality_log (event_ts, dataset, record_key, issue_type, action, details)
      SELECT
        NOW(),
        q.source_file,
        q.source_file || ':' || q.source_row_num::text,
        'DUPLICATE_TRIP',
        'excluded',
        'Duplicate natural-key trip row retained once'
      FROM trip_quality_work q
      WHERE q.duplicate_rank > 1;

      INSERT INTO quality_log (event_ts, dataset, record_key, issue_type, action, details)
      SELECT
        NOW(),
        q.source_file,
        q.source_file || ':' || q.source_row_num::text,
        'TRIP_EXCLUDED',
        'excluded',
        'Excluded for null critical fields, non-positive duration, or negative amount/distance'
      FROM trip_quality_work q
      WHERE q.is_excluded = TRUE
        AND q.duplicate_rank = 1;

      INSERT INTO trips_cleaned (
        source_file, source_row_num, vendor_id, pickup_ts, dropoff_ts, passenger_count,
        trip_distance, ratecode_id, store_and_fwd_flag, pu_location_id, do_location_id,
        payment_type, payment_type_group, fare_amount, extra, mta_tax, tip_amount, tolls_amount,
        improvement_surcharge, total_amount, congestion_surcharge, trip_duration_min,
        revenue_per_minute, fare_per_mile, avg_speed_mph, tip_percentage, pickup_hour,
        pickup_date, time_bucket, pickup_borough, pickup_zone, pickup_service_zone, dropoff_borough,
        dropoff_zone, dropoff_service_zone
      )
      SELECT
        q.source_file,
        q.source_row_num,
        q.vendor_id,
        q.pickup_ts,
        q.dropoff_ts,
        q.passenger_count,
        q.trip_distance,
        q.ratecode_id,
        q.store_and_fwd_flag,
        q.pu_location_id,
        q.do_location_id,
        q.payment_type,
        CASE
          WHEN q.payment_type = 1 THEN 'credit_card'
          WHEN q.payment_type = 2 THEN 'cash'
          WHEN q.payment_type = 3 THEN 'no_charge'
          ELSE 'other'
        END AS payment_type_group,
        q.fare_amount,
        q.extra,
        q.mta_tax,
        q.tip_amount,
        q.tolls_amount,
        q.improvement_surcharge,
        q.total_amount,
        q.congestion_surcharge,
        q.trip_duration_min,
        q.total_amount / NULLIF(q.trip_duration_min, 0) AS revenue_per_minute,
        q.total_amount / NULLIF(q.trip_distance, 0) AS fare_per_mile,
        q.trip_distance / NULLIF(q.trip_duration_hr, 0) AS avg_speed_mph,
        100.0 * q.tip_amount / NULLIF(q.fare_amount, 0) AS tip_percentage,
        EXTRACT(HOUR FROM q.pickup_ts)::INT AS pickup_hour,
        q.pickup_ts::DATE AS pickup_date,
        CASE
          WHEN EXTRACT(HOUR FROM q.pickup_ts) BETWEEN 7 AND 9 THEN 'morning_rush'
          WHEN EXTRACT(HOUR FROM q.pickup_ts) BETWEEN 16 AND 18 THEN 'evening_rush'
          ELSE 'off_peak'
        END AS time_bucket,
        pu.borough AS pickup_borough,
        pu.zone AS pickup_zone,
        pu.service_zone AS pickup_service_zone,
        dz.borough AS dropoff_borough,
        dz.zone AS dropoff_zone,
        dz.service_zone AS dropoff_service_zone
      FROM trip_quality_work q
      LEFT JOIN zones pu ON pu.location_id = q.pu_location_id
      LEFT JOIN zones dz ON dz.location_id = q.do_location_id
      WHERE q.is_excluded = FALSE;

      INSERT INTO flagged_trips (
        source_file, source_row_num, pickup_ts, pickup_date, pickup_hour, payment_type_group,
        time_bucket, pickup_borough, pickup_zone, dropoff_borough, dropoff_zone, pu_location_id,
        do_location_id, trip_distance, fare_amount, tip_amount, total_amount, trip_duration_min,
        avg_speed_mph, fare_per_mile, anomaly_type, severity
      )
      SELECT
        t.source_file,
        t.source_row_num,
        t.pickup_ts,
        t.pickup_date,
        t.pickup_hour,
        t.payment_type_group,
        t.time_bucket,
        t.pickup_borough,
        t.pickup_zone,
        t.dropoff_borough,
        t.dropoff_zone,
        t.pu_location_id,
        t.do_location_id,
        t.trip_distance,
        t.fare_amount,
        t.tip_amount,
        t.total_amount,
        t.trip_duration_min,
        t.avg_speed_mph,
        t.fare_per_mile,
        a.anomaly_type,
        'suspicious'
      FROM trips_cleaned t
      JOIN LATERAL (
        VALUES
          (CASE
            WHEN t.trip_distance > 0.5 AND (t.avg_speed_mph > 80 OR t.avg_speed_mph < 1)
            THEN 'SPEED_OUT_OF_RANGE'
            ELSE NULL
          END),
          (CASE
            WHEN t.trip_distance > 0 AND (t.fare_per_mile > 50 OR t.fare_per_mile < 1)
            THEN 'FARE_PER_MILE_OUT_OF_RANGE'
            ELSE NULL
          END),
          (CASE
            WHEN t.trip_duration_min < 1 AND t.trip_distance > 2
            THEN 'DURATION_DISTANCE_CONFLICT'
            ELSE NULL
          END),
          (CASE
            WHEN t.fare_amount > 0 AND t.tip_amount > (0.5 * t.fare_amount)
            THEN 'TIP_OVER_50_PERCENT'
            ELSE NULL
          END)
      ) AS a(anomaly_type) ON a.anomaly_type IS NOT NULL;

      CREATE TEMP TABLE flagged_trip_unique_work AS
      SELECT
        f.source_file,
        f.source_row_num,
        COUNT(*) AS anomaly_count
      FROM flagged_trips f
      GROUP BY f.source_file, f.source_row_num;
    `);

    await this.rebuildSummaryTables();
  }

  async rebuildSummaryTables() {
    // Pre-calc summary tables so API is fast.
    await this.dbClient.query(`
      TRUNCATE TABLE summary_overview_daily;
      TRUNCATE TABLE summary_zone_daily;
      TRUNCATE TABLE summary_hourly;
      TRUNCATE TABLE summary_flow_daily;
      TRUNCATE TABLE summary_route_daily;
      TRUNCATE TABLE summary_anomaly_daily;

      INSERT INTO summary_overview_daily (
        pickup_date, borough, payment_type_group, time_bucket, trip_count, total_amount_sum,
        fare_amount_sum, tip_amount_sum, tip_pct_sum, tip_pct_count, duration_min_sum, speed_sum,
        speed_count, revenue_per_minute_sum, revenue_per_minute_count, flagged_trip_count
      )
      SELECT
        t.pickup_date,
        COALESCE(t.pickup_borough, 'Unknown') AS borough,
        t.payment_type_group,
        t.time_bucket,
        COUNT(*) AS trip_count,
        COALESCE(SUM(t.total_amount), 0) AS total_amount_sum,
        COALESCE(SUM(t.fare_amount), 0) AS fare_amount_sum,
        COALESCE(SUM(t.tip_amount), 0) AS tip_amount_sum,
        COALESCE(SUM(t.tip_percentage), 0) AS tip_pct_sum,
        COUNT(t.tip_percentage) AS tip_pct_count,
        COALESCE(SUM(t.trip_duration_min), 0) AS duration_min_sum,
        COALESCE(SUM(t.avg_speed_mph), 0) AS speed_sum,
        COUNT(t.avg_speed_mph) AS speed_count,
        COALESCE(SUM(t.revenue_per_minute), 0) AS revenue_per_minute_sum,
        COUNT(t.revenue_per_minute) AS revenue_per_minute_count,
        COALESCE(SUM(CASE WHEN fu.anomaly_count IS NULL THEN 0 ELSE 1 END), 0) AS flagged_trip_count
      FROM trips_cleaned t
      LEFT JOIN (
        SELECT source_file, source_row_num, 1 AS anomaly_count
        FROM flagged_trips
        GROUP BY source_file, source_row_num
      ) fu ON fu.source_file = t.source_file AND fu.source_row_num = t.source_row_num
      GROUP BY t.pickup_date, COALESCE(t.pickup_borough, 'Unknown'), t.payment_type_group, t.time_bucket;

      INSERT INTO summary_zone_daily (
        pickup_date, zone_id, zone_name, borough, payment_type_group, time_bucket, lat, lng,
        trip_count, revenue_per_minute_sum, revenue_per_minute_count, fare_per_mile_sum,
        fare_per_mile_count, tip_pct_sum, tip_pct_count, avg_speed_sum, avg_speed_count, total_amount_sum
      )
      SELECT
        t.pickup_date,
        t.pu_location_id AS zone_id,
        COALESCE(t.pickup_zone, 'Unknown') AS zone_name,
        COALESCE(t.pickup_borough, 'Unknown') AS borough,
        t.payment_type_group,
        t.time_bucket,
        z.centroid_lat AS lat,
        z.centroid_lng AS lng,
        COUNT(*) AS trip_count,
        COALESCE(SUM(t.revenue_per_minute), 0) AS revenue_per_minute_sum,
        COUNT(t.revenue_per_minute) AS revenue_per_minute_count,
        COALESCE(SUM(t.fare_per_mile), 0) AS fare_per_mile_sum,
        COUNT(t.fare_per_mile) AS fare_per_mile_count,
        COALESCE(SUM(t.tip_percentage), 0) AS tip_pct_sum,
        COUNT(t.tip_percentage) AS tip_pct_count,
        COALESCE(SUM(t.avg_speed_mph), 0) AS avg_speed_sum,
        COUNT(t.avg_speed_mph) AS avg_speed_count,
        COALESCE(SUM(t.total_amount), 0) AS total_amount_sum
      FROM trips_cleaned t
      LEFT JOIN zones z ON z.location_id = t.pu_location_id
      GROUP BY
        t.pickup_date,
        t.pu_location_id,
        COALESCE(t.pickup_zone, 'Unknown'),
        COALESCE(t.pickup_borough, 'Unknown'),
        t.payment_type_group,
        t.time_bucket,
        z.centroid_lat,
        z.centroid_lng;

      INSERT INTO summary_hourly (
        pickup_date, pickup_hour, borough, payment_type_group, time_bucket, trip_count,
        revenue_per_minute_sum, revenue_per_minute_count, avg_speed_sum, avg_speed_count,
        tip_pct_sum, tip_pct_count
      )
      SELECT
        t.pickup_date,
        t.pickup_hour,
        COALESCE(t.pickup_borough, 'Unknown') AS borough,
        t.payment_type_group,
        t.time_bucket,
        COUNT(*) AS trip_count,
        COALESCE(SUM(t.revenue_per_minute), 0) AS revenue_per_minute_sum,
        COUNT(t.revenue_per_minute) AS revenue_per_minute_count,
        COALESCE(SUM(t.avg_speed_mph), 0) AS avg_speed_sum,
        COUNT(t.avg_speed_mph) AS avg_speed_count,
        COALESCE(SUM(t.tip_percentage), 0) AS tip_pct_sum,
        COUNT(t.tip_percentage) AS tip_pct_count
      FROM trips_cleaned t
      GROUP BY t.pickup_date, t.pickup_hour, COALESCE(t.pickup_borough, 'Unknown'), t.payment_type_group, t.time_bucket;

      INSERT INTO summary_flow_daily (
        pickup_date, origin_borough, destination_borough, payment_type_group, time_bucket, trip_count, total_amount_sum
      )
      SELECT
        t.pickup_date,
        COALESCE(t.pickup_borough, 'Unknown') AS origin_borough,
        COALESCE(t.dropoff_borough, 'Unknown') AS destination_borough,
        t.payment_type_group,
        t.time_bucket,
        COUNT(*) AS trip_count,
        COALESCE(SUM(t.total_amount), 0) AS total_amount_sum
      FROM trips_cleaned t
      GROUP BY
        t.pickup_date,
        COALESCE(t.pickup_borough, 'Unknown'),
        COALESCE(t.dropoff_borough, 'Unknown'),
        t.payment_type_group,
        t.time_bucket;

      INSERT INTO summary_route_daily (
        pickup_date, pickup_zone, dropoff_zone, pickup_borough, payment_type_group, time_bucket, trip_count, total_amount_sum
      )
      SELECT
        t.pickup_date,
        COALESCE(t.pickup_zone, 'Unknown') AS pickup_zone,
        COALESCE(t.dropoff_zone, 'Unknown') AS dropoff_zone,
        COALESCE(t.pickup_borough, 'Unknown') AS pickup_borough,
        t.payment_type_group,
        t.time_bucket,
        COUNT(*) AS trip_count,
        COALESCE(SUM(t.total_amount), 0) AS total_amount_sum
      FROM trips_cleaned t
      GROUP BY
        t.pickup_date,
        COALESCE(t.pickup_zone, 'Unknown'),
        COALESCE(t.dropoff_zone, 'Unknown'),
        COALESCE(t.pickup_borough, 'Unknown'),
        t.payment_type_group,
        t.time_bucket;

      INSERT INTO summary_anomaly_daily (
        pickup_date, borough, payment_type_group, time_bucket, anomaly_type, anomaly_count
      )
      SELECT
        f.pickup_date,
        COALESCE(f.pickup_borough, 'Unknown') AS borough,
        COALESCE(f.payment_type_group, 'other') AS payment_type_group,
        COALESCE(f.time_bucket, 'off_peak') AS time_bucket,
        f.anomaly_type,
        COUNT(*) AS anomaly_count
      FROM flagged_trips f
      GROUP BY
        f.pickup_date,
        COALESCE(f.pickup_borough, 'Unknown'),
        COALESCE(f.payment_type_group, 'other'),
        COALESCE(f.time_bucket, 'off_peak'),
        f.anomaly_type;
    `);
  }

  async getRowCounts() {
    const tables = [
      "zones",
      "boroughs",
      "trips_cleaned",
      "flagged_trips",
      "quality_log",
      "summary_overview_daily",
      "summary_zone_daily",
      "summary_hourly",
      "summary_flow_daily",
      "summary_route_daily",
      "summary_anomaly_daily",
    ];
    const out = {};

    for (const oneTable of tables) {
      const result = await this.dbClient.query(
        `SELECT COUNT(*)::bigint AS count FROM ${oneTable}`
      );
      out[oneTable] = Number(result.rows[0].count);
    }
    return out;
  }

  #makeDbConfig(dbUrl) {
    // Neon usually needs SSL.
    const cfg = { connectionString: dbUrl };
    try {
      const urlObj = new URL(dbUrl);
      const sslMode = (urlObj.searchParams.get("sslmode") || "").toLowerCase();
      if (sslMode === "require" || urlObj.hostname.endsWith(".neon.tech")) {
        cfg.ssl = { rejectUnauthorized: false };
      }
    } catch (_err) {
      // If URL parse fails, we still try default.
    }
    return cfg;
  }
}

module.exports = { DbTasks };
