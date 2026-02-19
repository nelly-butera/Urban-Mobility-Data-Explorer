'use strict';

const db            = require('../database');
const { ok, error } = require('../utils/httpHelpers');

// GET /api/anomalies/summary
async function getAnomalySummary(req, res) {
  try {
    const byType = await db.query(`
      SELECT err_type, COUNT(*) AS count
      FROM error_log
      GROUP BY err_type
      ORDER BY count DESC
    `);

    const totals = await db.query(`
      SELECT
        COUNT(*)                  AS total_records,
        COUNT(DISTINCT row_num)   AS unique_flagged_rows
      FROM error_log
    `);

    const tripCount = await db.query(`
      SELECT COUNT(*) AS total FROM trips
    `);

    const totalTrips   = parseInt(tripCount.rows[0].total, 10);
    const flaggedRows  = parseInt(totals.rows[0].unique_flagged_rows, 10);
    const flagRate     = totalTrips > 0
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
async function getAnomalyList(req, res, query) {
  const limit  = Math.min(parseInt(query.limit, 10)  || 50, 200);
  const offset = Math.max(parseInt(query.offset, 10) || 0,  0);
  const type   = query.type || null;

  const params     = [limit, offset];
  let   typeClause = '';

  if (type) {
    typeClause = 'AND err_type = $3';
    params.push(type);
  }

  try {
    const result = await db.query(`
      SELECT err_id, row_num, err_type, details, created_at
      FROM error_log
      WHERE 1=1 ${typeClause}
      ORDER BY created_at DESC
      LIMIT $1 OFFSET $2
    `, params);

    const countParams = type ? [type] : [];
    const countWhere  = type ? 'WHERE err_type = $1' : '';
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
