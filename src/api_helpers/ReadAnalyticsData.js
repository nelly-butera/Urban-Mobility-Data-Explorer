/**
 * - Run SELECT queries for dashboard endpoints.
 * - Use only pre-aggregated tables for speed.
 */
const { Pool } = require("pg");

class ReadAnalyticsData {
  constructor(dbUrl, filterReader) {
    this.pool = new Pool(this.#makePoolConfig(dbUrl));
    this.filterReader = filterReader;
  }

  async closePool() {
    await this.pool.end();
  }

  async readOverviewKpis(filters) {
    const where = this.filterReader.makeWhereSql(filters, "s", "pickup_date");
    const filtered = await this.#one(
      `
      SELECT
        COALESCE(SUM(s.trip_count), 0)::bigint AS total_trips,
        CASE WHEN COALESCE(SUM(s.trip_count), 0) = 0
          THEN 0
          ELSE COALESCE(SUM(s.fare_amount_sum), 0) / NULLIF(SUM(s.trip_count), 0)
        END AS avg_fare,
        CASE WHEN COALESCE(SUM(s.speed_count), 0) = 0
          THEN 0
          ELSE COALESCE(SUM(s.speed_sum), 0) / NULLIF(SUM(s.speed_count), 0)
        END AS avg_speed_mph,
        CASE WHEN COALESCE(SUM(s.duration_min_sum), 0) = 0
          THEN 0
          ELSE COALESCE(SUM(s.total_amount_sum), 0) / NULLIF(SUM(s.duration_min_sum), 0)
        END AS revenue_per_minute,
        CASE WHEN COALESCE(SUM(s.trip_count), 0) = 0
          THEN 0
          ELSE 100.0 * COALESCE(SUM(s.flagged_trip_count), 0) / NULLIF(SUM(s.trip_count), 0)
        END AS pct_suspicious_trips
      FROM summary_overview_daily s
      ${where.clause}
      `,
      where.params
    );

    const total = await this.#one(`
      SELECT COALESCE(SUM(trip_count), 0)::bigint AS total_trips
      FROM summary_overview_daily
    `);

    return {
      data: {
        total_trips: Number(filtered.total_trips || 0),
        avg_fare: Number(filtered.avg_fare || 0),
        avg_speed_mph: Number(filtered.avg_speed_mph || 0),
        revenue_per_minute: Number(filtered.revenue_per_minute || 0),
        pct_suspicious_trips: Number(filtered.pct_suspicious_trips || 0),
      },
      total: Number(total.total_trips || 0),
      filtered: Number(filtered.total_trips || 0),
    };
  }

  async readTripsOverTime(filters) {
    const where = this.filterReader.makeWhereSql(filters, "s", "pickup_date");
    const rows = await this.#many(
      `
      SELECT
        s.pickup_date::text AS date,
        COALESCE(SUM(s.trip_count), 0)::bigint AS trip_count
      FROM summary_overview_daily s
      ${where.clause}
      GROUP BY s.pickup_date
      ORDER BY s.pickup_date
      `,
      where.params
    );
    const total = await this.#one(
      `SELECT COUNT(DISTINCT pickup_date)::bigint AS count FROM summary_overview_daily`
    );
    return { data: rows.map(this.#toNumberRow), total: Number(total.count || 0), filtered: rows.length };
  }

  async readTripsByBorough(filters) {
    const where = this.filterReader.makeWhereSql(filters, "s", "pickup_date");
    const rows = await this.#many(
      `
      SELECT
        s.borough,
        COALESCE(SUM(s.trip_count), 0)::bigint AS trip_count
      FROM summary_overview_daily s
      ${where.clause}
      GROUP BY s.borough
      ORDER BY trip_count DESC
      `,
      where.params
    );
    const total = await this.#one(`SELECT COUNT(DISTINCT borough)::bigint AS count FROM summary_overview_daily`);
    return { data: rows.map(this.#toNumberRow), total: Number(total.count || 0), filtered: rows.length };
  }

  async readPickupDensity(filters) {
    const where = this.filterReader.makeWhereSql(filters, "s", "pickup_date");
    const rows = await this.#many(
      `
      SELECT
        s.zone_id,
        s.zone_name,
        MAX(s.lat) AS lat,
        MAX(s.lng) AS lng,
        COALESCE(SUM(s.trip_count), 0)::bigint AS trip_count
      FROM summary_zone_daily s
      ${where.clause}
      GROUP BY s.zone_id, s.zone_name
      ORDER BY trip_count DESC
      `,
      where.params
    );
    const total = await this.#one(`SELECT COUNT(DISTINCT zone_id)::bigint AS count FROM summary_zone_daily`);
    return { data: rows.map(this.#toNumberRow), total: Number(total.count || 0), filtered: rows.length };
  }

  async readProfitZoneRows(filters) {
    const where = this.filterReader.makeWhereSql(filters, "s", "pickup_date");
    const rows = await this.#many(
      `
      SELECT
        s.zone_id,
        s.zone_name,
        CASE WHEN SUM(s.revenue_per_minute_count) = 0 THEN 0
          ELSE SUM(s.revenue_per_minute_sum) / NULLIF(SUM(s.revenue_per_minute_count), 0)
        END AS revenue_per_minute,
        CASE WHEN SUM(s.fare_per_mile_count) = 0 THEN 0
          ELSE SUM(s.fare_per_mile_sum) / NULLIF(SUM(s.fare_per_mile_count), 0)
        END AS fare_per_mile,
        CASE WHEN SUM(s.tip_pct_count) = 0 THEN 0
          ELSE SUM(s.tip_pct_sum) / NULLIF(SUM(s.tip_pct_count), 0)
        END AS avg_tip_pct
      FROM summary_zone_daily s
      ${where.clause}
      GROUP BY s.zone_id, s.zone_name
      `,
      where.params
    );
    const total = await this.#one(`SELECT COUNT(DISTINCT zone_id)::bigint AS count FROM summary_zone_daily`);
    return { data: rows.map(this.#toNumberRow), total: Number(total.count || 0), filtered: rows.length };
  }

  async readProfitZoneMap(filters) {
    const where = this.filterReader.makeWhereSql(filters, "s", "pickup_date");
    const rows = await this.#many(
      `
      SELECT
        s.zone_id,
        s.zone_name,
        MAX(s.lat) AS lat,
        MAX(s.lng) AS lng,
        CASE WHEN SUM(s.revenue_per_minute_count) = 0 THEN 0
          ELSE SUM(s.revenue_per_minute_sum) / NULLIF(SUM(s.revenue_per_minute_count), 0)
        END AS revenue_per_minute
      FROM summary_zone_daily s
      ${where.clause}
      GROUP BY s.zone_id, s.zone_name
      ORDER BY revenue_per_minute DESC
      `,
      where.params
    );
    const total = await this.#one(`SELECT COUNT(DISTINCT zone_id)::bigint AS count FROM summary_zone_daily`);
    return { data: rows.map(this.#toNumberRow), total: Number(total.count || 0), filtered: rows.length };
  }

  async readRevenueByHour(filters) {
    const where = this.filterReader.makeWhereSql(filters, "h", "pickup_date");
    const rows = await this.#many(
      `
      SELECT
        h.pickup_hour AS hour,
        CASE WHEN SUM(h.revenue_per_minute_count) = 0 THEN 0
          ELSE SUM(h.revenue_per_minute_sum) / NULLIF(SUM(h.revenue_per_minute_count), 0)
        END AS revenue_per_minute
      FROM summary_hourly h
      ${where.clause}
      GROUP BY h.pickup_hour
      ORDER BY h.pickup_hour
      `,
      where.params
    );
    return { data: rows.map(this.#toNumberRow), total: 24, filtered: rows.length };
  }

  async readZoneSpeeds(filters) {
    const where = this.filterReader.makeWhereSql(filters, "s", "pickup_date");
    const rows = await this.#many(
      `
      SELECT
        s.zone_id,
        s.zone_name,
        MAX(s.lat) AS lat,
        MAX(s.lng) AS lng,
        CASE WHEN SUM(s.avg_speed_count) = 0 THEN 0
          ELSE SUM(s.avg_speed_sum) / NULLIF(SUM(s.avg_speed_count), 0)
        END AS avg_speed_mph
      FROM summary_zone_daily s
      ${where.clause}
      GROUP BY s.zone_id, s.zone_name
      `,
      where.params
    );

    const withScore = rows.map((row) => {
      const speed = Number(row.avg_speed_mph || 0);
      return {
        zone_id: Number(row.zone_id),
        zone_name: row.zone_name,
        avg_speed_mph: speed,
        congestion_score: Math.max(0, 100 - speed * 2),
        lat: row.lat === null ? null : Number(row.lat),
        lng: row.lng === null ? null : Number(row.lng),
      };
    });

    const total = await this.#one(`SELECT COUNT(DISTINCT zone_id)::bigint AS count FROM summary_zone_daily`);
    return { data: withScore, total: Number(total.count || 0), filtered: withScore.length };
  }

  async readSpeedByHour(filters) {
    const where = this.filterReader.makeWhereSql(filters, "h", "pickup_date");
    const rows = await this.#many(
      `
      SELECT
        h.pickup_hour AS hour,
        CASE WHEN SUM(h.avg_speed_count) = 0 THEN 0
          ELSE SUM(h.avg_speed_sum) / NULLIF(SUM(h.avg_speed_count), 0)
        END AS avg_speed_mph
      FROM summary_hourly h
      ${where.clause}
      GROUP BY h.pickup_hour
      ORDER BY h.pickup_hour
      `,
      where.params
    );
    return { data: rows.map(this.#toNumberRow), total: 24, filtered: rows.length };
  }

  async readSpeedByBorough(filters) {
    const where = this.filterReader.makeWhereSql(filters, "s", "pickup_date");
    const rows = await this.#many(
      `
      SELECT
        s.borough,
        CASE WHEN SUM(s.speed_count) = 0 THEN 0
          ELSE SUM(s.speed_sum) / NULLIF(SUM(s.speed_count), 0)
        END AS avg_speed_mph
      FROM summary_overview_daily s
      ${where.clause}
      GROUP BY s.borough
      ORDER BY s.borough
      `,
      where.params
    );
    const total = await this.#one(`SELECT COUNT(DISTINCT borough)::bigint AS count FROM summary_overview_daily`);
    return { data: rows.map(this.#toNumberRow), total: Number(total.count || 0), filtered: rows.length };
  }

  async readBoroughMatrix(filters) {
    const where = this.filterReader.makeWhereSql(filters, "f", "pickup_date", 1, {
      borough: "origin_borough",
      payment: "payment_type_group",
      time: "time_bucket",
    });
    const rows = await this.#many(
      `
      SELECT
        f.origin_borough,
        f.destination_borough,
        COALESCE(SUM(f.trip_count), 0)::bigint AS trip_count
      FROM summary_flow_daily f
      ${where.clause}
      GROUP BY f.origin_borough, f.destination_borough
      ORDER BY trip_count DESC
      `,
      where.params
    );
    const total = await this.#one(`
      SELECT COUNT(*)::bigint AS count
      FROM (
        SELECT origin_borough, destination_borough
        FROM summary_flow_daily
        GROUP BY origin_borough, destination_borough
      ) x
    `);
    return { data: rows.map(this.#toNumberRow), total: Number(total.count || 0), filtered: rows.length };
  }

  async readTopRoutes(filters) {
    const where = this.filterReader.makeWhereSql(filters, "r", "pickup_date", 1, {
      borough: "pickup_borough",
      payment: "payment_type_group",
      time: "time_bucket",
    });
    const rows = await this.#many(
      `
      SELECT
        r.pickup_zone,
        r.dropoff_zone,
        COALESCE(SUM(r.trip_count), 0)::bigint AS trip_count,
        CASE WHEN COALESCE(SUM(r.trip_count), 0) = 0 THEN 0
          ELSE COALESCE(SUM(r.total_amount_sum), 0) / NULLIF(SUM(r.trip_count), 0)
        END AS avg_fare
      FROM summary_route_daily r
      ${where.clause}
      GROUP BY r.pickup_zone, r.dropoff_zone
      `,
      where.params
    );
    const total = await this.#one(`
      SELECT COUNT(*)::bigint AS count
      FROM (
        SELECT pickup_zone, dropoff_zone
        FROM summary_route_daily
        GROUP BY pickup_zone, dropoff_zone
      ) x
    `);
    return { data: rows.map(this.#toNumberRow), total: Number(total.count || 0), filtered: rows.length };
  }

  async readAnomalyKpis(filters) {
    const whereAnomaly = this.filterReader.makeWhereSql(filters, "a", "pickup_date");
    const whereTrips = this.filterReader.makeWhereSql(filters, "s", "pickup_date");
    const whereFlags = this.filterReader.makeWhereSql(filters, "f", "pickup_date");

    const totalFlagged = await this.#one(
      `
      SELECT COUNT(*)::bigint AS total_flagged
      FROM (
        SELECT f.source_file, f.source_row_num
        FROM flagged_trips f
        ${whereFlags.clause}
        GROUP BY f.source_file, f.source_row_num
      ) x
      `,
      whereFlags.params
    );
    const totalTrips = await this.#one(
      `
      SELECT COALESCE(SUM(s.trip_count), 0)::bigint AS total_trips
      FROM summary_overview_daily s
      ${whereTrips.clause}
      `,
      whereTrips.params
    );
    const commonType = await this.#one(
      `
      SELECT a.anomaly_type, COALESCE(SUM(a.anomaly_count), 0)::bigint AS anomaly_count
      FROM summary_anomaly_daily a
      ${whereAnomaly.clause}
      GROUP BY a.anomaly_type
      ORDER BY anomaly_count DESC
      LIMIT 1
      `,
      whereAnomaly.params
    );

    const flagged = Number(totalFlagged.total_flagged || 0);
    const trips = Number(totalTrips.total_trips || 0);
    return {
      data: {
        total_flagged: flagged,
        pct_of_total: trips > 0 ? (100 * flagged) / trips : 0,
        most_common_type: commonType ? commonType.anomaly_type || null : null,
      },
      total: trips,
      filtered: flagged,
    };
  }

  async readAnomalyTrips(filters, page, limit) {
    const offset = (page - 1) * limit;
    const where = this.filterReader.makeWhereSql(filters, "f", "pickup_date");
    const rows = await this.#many(
      `
      SELECT
        f.pickup_zone,
        f.dropoff_zone,
        f.avg_speed_mph AS speed_mph,
        f.total_amount AS fare,
        f.anomaly_type AS flag_reason
      FROM flagged_trips f
      ${where.clause}
      ORDER BY f.pickup_ts DESC NULLS LAST, f.flagged_id DESC
      LIMIT $${where.nextIndex}
      OFFSET $${where.nextIndex + 1}
      `,
      [...where.params, limit, offset]
    );

    const filtered = await this.#one(
      `
      SELECT COUNT(*)::bigint AS count
      FROM flagged_trips f
      ${where.clause}
      `,
      where.params
    );
    const total = await this.#one(`SELECT COUNT(*)::bigint AS count FROM flagged_trips`);

    return {
      data: rows.map(this.#toNumberRow),
      total: Number(total.count || 0),
      filtered: Number(filtered.count || 0),
    };
  }

  async readAnomalyByType(filters) {
    const where = this.filterReader.makeWhereSql(filters, "a", "pickup_date");
    const rows = await this.#many(
      `
      SELECT
        a.anomaly_type,
        COALESCE(SUM(a.anomaly_count), 0)::bigint AS count
      FROM summary_anomaly_daily a
      ${where.clause}
      GROUP BY a.anomaly_type
      ORDER BY count DESC
      `,
      where.params
    );
    const total = await this.#one(`SELECT COUNT(DISTINCT anomaly_type)::bigint AS count FROM summary_anomaly_daily`);
    return { data: rows.map(this.#toNumberRow), total: Number(total.count || 0), filtered: rows.length };
  }

  async readTipsByBorough(filters) {
    const where = this.filterReader.makeWhereSql(filters, "s", "pickup_date");
    const rows = await this.#many(
      `
      SELECT
        s.borough,
        CASE WHEN SUM(s.tip_pct_count) = 0 THEN 0
          ELSE SUM(s.tip_pct_sum) / NULLIF(SUM(s.tip_pct_count), 0)
        END AS avg_tip_pct
      FROM summary_overview_daily s
      ${where.clause}
      GROUP BY s.borough
      ORDER BY avg_tip_pct DESC
      `,
      where.params
    );
    const total = await this.#one(`SELECT COUNT(DISTINCT borough)::bigint AS count FROM summary_overview_daily`);
    return { data: rows.map(this.#toNumberRow), total: Number(total.count || 0), filtered: rows.length };
  }

  async readTipsByHour(filters) {
    const where = this.filterReader.makeWhereSql(filters, "h", "pickup_date");
    const rows = await this.#many(
      `
      SELECT
        h.pickup_hour AS hour,
        CASE WHEN SUM(h.tip_pct_count) = 0 THEN 0
          ELSE SUM(h.tip_pct_sum) / NULLIF(SUM(h.tip_pct_count), 0)
        END AS avg_tip_pct
      FROM summary_hourly h
      ${where.clause}
      GROUP BY h.pickup_hour
      ORDER BY h.pickup_hour
      `,
      where.params
    );
    return { data: rows.map(this.#toNumberRow), total: 24, filtered: rows.length };
  }

  async readTipsCashVsCard(filters) {
    const where = this.filterReader.makeWhereSql(filters, "s", "pickup_date");
    const rows = await this.#many(
      `
      SELECT
        s.payment_type_group AS payment_type,
        CASE WHEN SUM(s.tip_pct_count) = 0 THEN 0
          ELSE SUM(s.tip_pct_sum) / NULLIF(SUM(s.tip_pct_count), 0)
        END AS avg_tip_pct,
        CASE WHEN SUM(s.trip_count) = 0 THEN 0
          ELSE SUM(s.tip_amount_sum) / NULLIF(SUM(s.trip_count), 0)
        END AS avg_tip_amount
      FROM summary_overview_daily s
      ${where.clause}
      AND s.payment_type_group IN ('cash', 'credit_card')
      GROUP BY s.payment_type_group
      `,
      where.params
    );
    return { data: rows.map(this.#toNumberRow), total: 2, filtered: rows.length };
  }

  async readTipInsight(filters) {
    const where = this.filterReader.makeWhereSql(filters, "s", "pickup_date");
    const row = await this.#one(
      `
      SELECT
        s.borough,
        CASE WHEN SUM(s.tip_pct_count) = 0 THEN 0
          ELSE SUM(s.tip_pct_sum) / NULLIF(SUM(s.tip_pct_count), 0)
        END AS avg_tip_pct
      FROM summary_overview_daily s
      ${where.clause}
      GROUP BY s.borough
      ORDER BY avg_tip_pct DESC
      LIMIT 1
      `,
      where.params
    );

    if (!row) {
      return { data: { text: "No data available for this filter choice." }, total: 0, filtered: 0 };
    }

    const tipText = Number(row.avg_tip_pct || 0).toFixed(2);
    return {
      data: { text: `${row.borough} has highest average tip (${tipText}%) in selected filters.` },
      total: 1,
      filtered: 1,
    };
  }

  async #many(sql, params = []) {
    const result = await this.pool.query(sql, params);
    return result.rows;
  }

  async #one(sql, params = []) {
    const rows = await this.#many(sql, params);
    return rows[0] || null;
  }

  #toNumberRow(row) {
    const out = {};
    for (const [k, v] of Object.entries(row)) {
      if (typeof v === "string" && /^-?\d+(\.\d+)?$/.test(v)) {
        out[k] = Number(v);
      } else {
        out[k] = v;
      }
    }
    return out;
  }

  #makePoolConfig(dbUrl) {
    const cfg = { connectionString: dbUrl, max: 10, idleTimeoutMillis: 30000 };
    try {
      const urlObj = new URL(dbUrl);
      const sslMode = (urlObj.searchParams.get("sslmode") || "").toLowerCase();
      if (sslMode === "require" || urlObj.hostname.endsWith(".neon.tech")) {
        cfg.ssl = { rejectUnauthorized: false };
      }
    } catch (_err) {
      // Keep defaults if url parse fails.
    }
    return cfg;
  }
}

module.exports = { ReadAnalyticsData };
