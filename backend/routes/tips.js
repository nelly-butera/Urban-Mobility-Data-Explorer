'use strict';

const db            = require('../database');
const { ok, error } = require('../utils/httpHelpers');

// simple mapping so we don't just show numbers like 1 or 2 on the screen
const PAYMENT_LABELS = {
  1: 'Credit Card',
  2: 'Cash',
  3: 'No Charge',
  4: 'Dispute',
  5: 'Unknown',
  6: 'Voided Trip',
};

// get /api/tips/by-borough
async function getTipsByBorough(req, res) {
  try {
    // looking at how much people tip in different parts of the city
    const result = await db.query(`
      SELECT
        z.borough,
        COUNT(t.id)                AS trip_count,
        AVG(t.tip_pct)             AS avg_tip_percentage,
        AVG(t.tip)                 AS avg_tip_amount,
        SUM(t.tip)                 AS total_tips,
        SUM(t.total)               AS total_revenue,
        ROUND(SUM(t.tip) / NULLIF(SUM(t.total), 0) * 100, 2) AS tips_as_pct_of_revenue,
        PERCENTILE_CONT(0.5) WITHIN GROUP (ORDER BY t.tip_pct) AS median_tip_percentage
      FROM zones z
      JOIN trips t ON t.pickup_zone = z.id
      -- ignoring the weird records and n/a zones
      WHERE z.borough IS NOT NULL
        AND z.borough NOT IN ('Unknown', 'N/A')
        AND z.id NOT IN (264, 265)
        AND t.tip_pct IS NOT NULL
      GROUP BY z.borough
      ORDER BY avg_tip_percentage DESC
    `);
    ok(res, result.rows, { count: result.rows.length });
  } catch (err) {
    // log the error if the borough query fails
    console.error('[tips/by-borough]', err.message);
    error(res, 500, 'failed to fetch tips by borough', err.message);
  }
}

// get /api/tips/by-hour
async function getTipsByHour(req, res) {
  try {
    // checking if people tip more at certain times (like late at night)
    const result = await db.query(`
      SELECT
        hour_of_day,
        COUNT(*)       AS trip_count,
        AVG(tip_pct)   AS avg_tip_percentage,
        AVG(tip)       AS avg_tip_amount,
        SUM(tip)       AS total_tips,
        PERCENTILE_CONT(0.5) WITHIN GROUP (ORDER BY tip_pct) AS median_tip_percentage
      FROM trips
      WHERE tip_pct IS NOT NULL
      GROUP BY hour_of_day
      ORDER BY hour_of_day ASC
    `);
    ok(res, result.rows, { count: result.rows.length });
  } catch (err) {
    console.error('[tips/by-hour]', err.message);
    error(res, 500, 'failed to fetch tips by hour', err.message);
  }
}

// get /api/tips/payment-comparison
async function getTipsByPaymentType(req, res) {
  try {
    // comparing credit cards vs cash to see where the tips are actually logged
    const result = await db.query(`
      SELECT
        payment_type,
        COUNT(*)       AS trip_count,
        AVG(tip_pct)   AS avg_tip_percentage,
        AVG(tip)       AS avg_tip_amount,
        SUM(tip)       AS total_tips,
        MIN(tip_pct)   AS min_tip_percentage,
        MAX(tip_pct)   AS max_tip_percentage,
        PERCENTILE_CONT(0.5) WITHIN GROUP (ORDER BY tip_pct) AS median_tip_percentage,
        PERCENTILE_CONT(0.9) WITHIN GROUP (ORDER BY tip_pct) AS p90_tip_percentage
      FROM trips
      WHERE tip_pct IS NOT NULL
        AND payment_type IS NOT NULL
      GROUP BY payment_type
      ORDER BY payment_type ASC
    `);

    // mapping the payment numbers to actual names before sending to frontend
    const enriched = [];
    for (let i = 0; i < result.rows.length; i++) {
      const row = result.rows[i];
      enriched.push({
        ...row,
        payment_label: PAYMENT_LABELS[row.payment_type] || 'Unknown',
      });
    }
    ok(res, enriched, { count: enriched.length });
  } catch (err) {
    console.error('[tips/payment-comparison]', err.message);
    error(res, 500, 'failed to fetch payment comparison', err.message);
  }
}

// routing for the tip analytics sub-paths
async function handle(req, res, subpath, query) {
  if (req.method !== 'GET') return error(res, 405, 'method not allowed');
  if (subpath === '/by-borough')         return getTipsByBorough(req, res);
  if (subpath === '/by-hour')            return getTipsByHour(req, res);
  if (subpath === '/payment-comparison') return getTipsByPaymentType(req, res);
  error(res, 404, `tips route not found: ${subpath}`);
}

module.exports = { handle };