'use strict';

const db            = require('../database');
const { ok, error } = require('../utils/httpHelpers');

// GET /api/anomalies/summary
async function getAnomalySummary(req, res) {
  try {
    // Exclude BAD_DATETIME and DROPOFF_BEFORE_PICKUP — those are rows that were
    // rejected entirely and never inserted into trips. Showing them would inflate
    // the counts and confuse the frontend (they have no trip to reference).
    const byType = await db.query(`
      SELECT err_type, COUNT(*) AS count
      FROM error_log
      WHERE err_type NOT IN ('BAD_DATETIME', 'DROPOFF_BEFORE_PICKUP')
      GROUP BY err_type
      ORDER BY count DESC
    `);

    const totals = await db.query(`
      SELECT
        COUNT(*)                  AS total_records,
        COUNT(DISTINCT row_num)   AS unique_flagged_rows
      FROM error_log
      WHERE err_type NOT IN ('BAD_DATETIME', 'DROPOFF_BEFORE_PICKUP')
    `);

    const tripCount = await db.query(`SELECT COUNT(*) AS total FROM trips`);

    const totalTrips  = parseInt(tripCount.rows[0].total, 10);
    const flaggedRows = parseInt(totals.rows[0].unique_flagged_rows, 10);
    const flagRate    = totalTrips > 0
      ? parseFloat(((flaggedRows / totalTrips) * 100).toFixed(2))
      : 0;

    ok(res, {
      total_error_records: parseInt(totals.rows[0].total_records, 10),
      unique_flagged_rows: flaggedRows,
      flag_rate_percent:   flagRate,
      by_type:             byType.rows,
    });
  } catch (err) {
    console.error('[anomalies/summary]', err.message);
    error(res, 500, 'Failed to fetch anomaly summary', err.message);
  }
}

// GET /api/anomalies/list
// Joins error_log -> trips -> zones so we get actual zone names and fare info
async function getAnomalyList(req, res, query) {
  const limit  = Math.min(parseInt(query.limit, 10)  || 50, 200);
  const offset = Math.max(parseInt(query.offset, 10) || 0,  0);
  const type   = query.type || null;

  const params     = [limit, offset];
  let   typeClause = '';

  if (type) {
    typeClause = 'AND el.err_type = $3';
    params.push(type);
  }

  try {
    // JOIN trips + pickup zone so the table shows real zone names and fare values
    const result = await db.query(`
      SELECT
        el.err_id,
        el.row_num,
        el.err_type,
        el.details,
        el.created_at,
        -- fare and distance are stored in the details JSONB by the ETL pipeline
        (el.details->>'fare')::numeric     AS fare,
        (el.details->>'distance')::numeric AS distance
      FROM error_log el
      WHERE 1=1 ${typeClause}
        AND el.err_type NOT IN ('BAD_DATETIME', 'DROPOFF_BEFORE_PICKUP')
      ORDER BY el.created_at DESC
      LIMIT $1 OFFSET $2
    `, params);

    const countParams = type ? [type] : [];
    const countWhere  = type
      ? "WHERE err_type = $1 AND err_type NOT IN ('BAD_DATETIME','DROPOFF_BEFORE_PICKUP')"
      : "WHERE err_type NOT IN ('BAD_DATETIME','DROPOFF_BEFORE_PICKUP')";
    const countResult = await db.query(
      `SELECT COUNT(*) AS total FROM error_log ${countWhere}`,
      countParams,
    );

    const total = parseInt(countResult.rows[0].total, 10);
    ok(res, result.rows, {
      total,
      limit,
      offset,
      count:    result.rows.length,
      has_more: offset + result.rows.length < total,
    });
  } catch (err) {
    console.error('[anomalies/list]', err.message);
    error(res, 500, 'Failed to fetch anomaly list', err.message);
  }
}

async function handle(req, res, subpath, query) {
  if (req.method !== 'GET') return error(res, 405, 'Method Not Allowed');
  if (subpath === '/summary') return getAnomalySummary(req, res);
  if (subpath === '/list')    return getAnomalyList(req, res, query);
  error(res, 404, `Anomalies route not found: ${subpath}`);
}

module.exports = { handle };