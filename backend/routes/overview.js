'use strict';

const db            = require('../database');
const { ok, error } = require('../utils/httpHelpers');

// get /api/overview/kpis
async function getKpis(req, res) {
  try {
    // grabbing all the big numbers like total cash and avg speed from the trips table
    const result = await db.query(`
      SELECT
        COUNT(*)                       AS total_trips,
        SUM(total)                     AS total_revenue,
        AVG(total)                     AS avg_fare,
        AVG(duration_min)              AS avg_duration_minutes,
        AVG(speed_mph)                 AS avg_speed_mph,
        AVG(tip_pct)                   AS avg_tip_percentage,
        SUM(tip)                       AS total_tips,
        AVG(money_per_min)             AS avg_revenue_per_minute,
        MIN(pickup_time)               AS earliest_trip,
        MAX(pickup_time)               AS latest_trip,
        COUNT(DISTINCT pickup_zone)    AS unique_pickup_zones,
        COUNT(DISTINCT dropoff_zone)   AS unique_dropoff_zones
      FROM trips
    `);

    // we only want to count rows that actually made it into the system.
    // some rows were totally broken (bad dates etc) so we skip those
    // so the dashboard doesn't look messy or wrong.
    const errorCount = await db.query(`
      SELECT COUNT(DISTINCT row_num) AS flagged_rows
      FROM error_log
      WHERE err_type NOT IN ('BAD_DATETIME', 'DROPOFF_BEFORE_PICKUP')
    `);

    const row = result.rows[0];
    // cleaning up the numbers so they aren't like 10 decimal places long
    ok(res, {
      total_trips:            parseInt(row.total_trips, 10),
      total_revenue:          parseFloat(parseFloat(row.total_revenue).toFixed(2)),
      avg_fare:               parseFloat(parseFloat(row.avg_fare).toFixed(2)),
      avg_duration_minutes:   parseFloat(parseFloat(row.avg_duration_minutes).toFixed(2)),
      avg_speed_mph:          parseFloat(parseFloat(row.avg_speed_mph).toFixed(2)),
      avg_tip_percentage:     parseFloat(parseFloat(row.avg_tip_percentage).toFixed(2)),
      total_tips:             parseFloat(parseFloat(row.total_tips).toFixed(2)),
      avg_revenue_per_minute: parseFloat(parseFloat(row.avg_revenue_per_minute).toFixed(4)),
      earliest_trip:          row.earliest_trip,
      latest_trip:            row.latest_trip,
      unique_pickup_zones:    parseInt(row.unique_pickup_zones, 10),
      unique_dropoff_zones:   parseInt(row.unique_dropoff_zones, 10),
      flag_rows:              parseInt(errorCount.rows[0].flagged_rows, 10),
    });
  } catch (err) {
    // if kpis fail just log the error and send a 500
    console.error('[overview/kpis]', err.message);
    error(res, 500, 'failed to fetch kpis', err.message);
  }
}

// get /api/overview/trips-over-time
async function getTripsOverTime(req, res, query) {
  // figure out if the user wants to see stats by the hour or by the day
  const unit = query.granularity === 'hour' ? 'hour' : 'day';
  try {
    const result = await db.query(`
      SELECT
        DATE_TRUNC('${unit}', pickup_time)  AS period,
        COUNT(*)                            AS trip_count,
        SUM(total)                          AS total_revenue,
        AVG(total)                          AS avg_fare,
        AVG(duration_min)                   AS avg_duration_minutes
      FROM trips
      GROUP BY 1
      ORDER BY 1 ASC
    `);
    ok(res, result.rows, { granularity: unit, count: result.rows.length });
  } catch (err) {
    console.error('[overview/trips-over-time]', err.message);
    error(res, 500, 'failed to fetch trips over time', err.message);
  }
}

// get /api/overview/top-zones
async function getTopZones(req, res, query) {
  // setting a limit so we don't try to load every single zone in nyc at once
  const limit = Math.min(parseInt(query.limit, 10) || 20, 100);
  try {
    const result = await db.query(`
      SELECT
        z.id            AS location_id,
        z.borough,
        z.zone_name,
        COUNT(t.id)     AS trip_count,
        SUM(t.total)    AS total_revenue,
        AVG(t.total)    AS avg_fare,
        AVG(t.tip_pct)  AS avg_tip_percentage
      FROM zones z
      JOIN trips t ON t.pickup_zone = z.id
      -- filter out the unknown/na zones bc they make the charts look bad
      WHERE z.id NOT IN (264, 265)
        AND z.zone_name NOT IN ('Unknown', 'N/A')
        AND z.borough   NOT IN ('Unknown', 'N/A')
      GROUP BY z.id, z.borough, z.zone_name
      ORDER BY trip_count DESC
      LIMIT $1
    `, [limit]);
    ok(res, result.rows, { limit, count: result.rows.length });
  } catch (err) {
    console.error('[overview/top-zones]', err.message);
    error(res, 500, 'failed to fetch top zones', err.message);
  }
}

// traffic control for the overview routes
async function handle(req, res, subpath, query) {
  if (req.method !== 'GET') return error(res, 405, 'method not allowed');
  if (subpath === '/kpis')            return getKpis(req, res);
  if (subpath === '/trips-over-time') return getTripsOverTime(req, res, query);
  if (subpath === '/top-zones')       return getTopZones(req, res, query);
  error(res, 404, `overview route not found: ${subpath}`);
}

module.exports = { handle };