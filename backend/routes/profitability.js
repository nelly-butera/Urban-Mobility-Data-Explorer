'use strict';

const db            = require('../database');
const { ok, error } = require('../utils/httpHelpers');

// GET /api/profitability/top-zones
async function getTopProfitableZones(req, res, query) {
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
      WHERE t.money_per_min IS NOT NULL
      GROUP BY z.id, z.borough, z.zone_name, z.service_zone
      HAVING COUNT(t.id) >= 10
      ORDER BY avg_revenue_per_minute DESC
      LIMIT $1
    `, [limit]);
    ok(res, result.rows, { limit, count: result.rows.length });
  } catch (err) {
    console.error('[profitability/top-zones]', err.message);
    error(res, 500, 'Failed to fetch top profitable zones', err.message);
  }
}

// GET /api/profitability/by-borough
async function getProfitabilityByBorough(req, res) {
  try {
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
      GROUP BY z.borough
      ORDER BY total_revenue DESC
    `);
    ok(res, result.rows, { count: result.rows.length });
  } catch (err) {
    console.error('[profitability/by-borough]', err.message);
    error(res, 500, 'Failed to fetch profitability by borough', err.message);
  }
}

// GET /api/profitability/by-hour
async function getProfitabilityByHour(req, res) {
  try {
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
    error(res, 500, 'Failed to fetch profitability by hour', err.message);
  }
}

async function handle(req, res, subpath, query) {
  if (req.method !== 'GET') return error(res, 405, 'Method Not Allowed');
  if (subpath === '/top-zones')  return getTopProfitableZones(req, res, query);
  if (subpath === '/by-borough') return getProfitabilityByBorough(req, res);
  if (subpath === '/by-hour')    return getProfitabilityByHour(req, res);
  error(res, 404, `Profitability route not found: ${subpath}`);
}

module.exports = { handle };
