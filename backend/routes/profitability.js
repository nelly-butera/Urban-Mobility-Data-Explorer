'use strict';

const db            = require('../database');
const { ok, error } = require('../utils/httpHelpers');

// get /api/profitability/top-zones
async function getTopProfitableZones(req, res, query) {
  // capping the limit so the database doesn't hang
  const limit = Math.min(parseInt(query.limit, 10) || 20, 100);
  try {
    const result = await db.query(`
      SELECT
        z.id              AS location_id,
        z.borough,
        z.zone_name,
        z.service_zone,
        COUNT(t.id)       AS trip_count,
        AVG(t.money_per_min)  AS avg_revenue_per_minute,
        AVG(t.total)      AS avg_total_amount,
        SUM(t.total)      AS total_revenue,
        AVG(t.duration_min)   AS avg_duration_minutes,
        AVG(t.speed_mph)  AS avg_speed_mph,
        AVG(t.tip_pct)    AS avg_tip_percentage
      FROM zones z
      JOIN trips t ON t.pickup_zone = z.id
      -- ignoring nulls and the "unknown" zones so the data stays clean
      WHERE t.money_per_min IS NOT NULL
        AND z.id NOT IN (264, 265)
        AND z.zone_name NOT IN ('Unknown', 'N/A')
        AND z.borough   NOT IN ('Unknown', 'N/A')
      GROUP BY z.id, z.borough, z.zone_name, z.service_zone
      -- only showing zones with enough trips to be statistically relevant
      HAVING COUNT(t.id) >= 10
      ORDER BY avg_revenue_per_minute DESC
      LIMIT $1
    `, [limit]);
    ok(res, result.rows, { limit, count: result.rows.length });
  } catch (err) {
    // if the query fails for some reason
    console.error('[profitability/top-zones]', err.message);
    error(res, 500, 'failed to fetch top profitable zones', err.message);
  }
}

// get /api/profitability/by-borough
async function getProfitabilityByBorough(req, res) {
  try {
    // grouping everything by borough to see the averages across the city
    const result = await db.query(`
      SELECT
        z.borough,
        COUNT(t.id)                AS trip_count,
        SUM(t.total)               AS total_revenue,
        AVG(t.total)               AS avg_fare,
        AVG(t.money_per_min)       AS avg_revenue_per_minute,
        AVG(t.duration_min)        AS avg_duration_minutes,
        AVG(t.speed_mph)           AS avg_speed_mph,
        AVG(t.tip_pct)             AS avg_tip_percentage,
        PERCENTILE_CONT(0.5) WITHIN GROUP (ORDER BY t.total)         AS median_fare,
        PERCENTILE_CONT(0.5) WITHIN GROUP (ORDER BY t.money_per_min) AS median_revenue_per_minute
      FROM zones z
      JOIN trips t ON t.pickup_zone = z.id
      WHERE z.borough IS NOT NULL
        AND z.borough NOT IN ('Unknown', 'N/A')
        AND z.id NOT IN (264, 265)
      GROUP BY z.borough
      ORDER BY total_revenue DESC
    `);
    ok(res, result.rows, { count: result.rows.length });
  } catch (err) {
    console.error('[profitability/by-borough]', err.message);
    error(res, 500, 'failed to fetch profitability by borough', err.message);
  }
}

// get /api/profitability/by-hour
async function getProfitabilityByHour(req, res) {
  try {
    // checking which hours of the day are actually making the most money
    const result = await db.query(`
      SELECT
        hour_of_day,
        COUNT(*)            AS trip_count,
        AVG(money_per_min)  AS avg_revenue_per_minute,
        AVG(total)          AS avg_fare,
        SUM(total)          AS total_revenue,
        AVG(duration_min)   AS avg_duration_minutes,
        AVG(speed_mph)      AS avg_speed_mph
      FROM trips
      WHERE money_per_min IS NOT NULL
      GROUP BY hour_of_day
      ORDER BY hour_of_day ASC
    `);
    ok(res, result.rows, { count: result.rows.length });
  } catch (err) {
    console.error('[profitability/by-hour]', err.message);
    error(res, 500, 'failed to fetch profitability by hour', err.message);
  }
}

// this handles the sub-routing for the profitability section
async function handle(req, res, subpath, query) {
  if (req.method !== 'GET') return error(res, 405, 'method not allowed');
  if (subpath === '/top-zones')  return getTopProfitableZones(req, res, query);
  if (subpath === '/by-borough') return getProfitabilityByBorough(req, res);
  if (subpath === '/by-hour')    return getProfitabilityByHour(req, res);
  error(res, 404, `profitability route not found: ${subpath}`);
}

module.exports = { handle };