'use strict';

// connecting to the brain (db) and our helper tools
const db            = require('../database');
const { ok, error } = require('../utils/httpHelpers');

// get /api/anomalies/summary
async function getAnomalySummary(req, res) {
  try {
    // we ghosted bad_datetime and dropoff_before_pickup bc they never even 
    // made it into the main trips table. no point showing them to the user.
    const byType = await db.query(`
      SELECT err_type, COUNT(*) AS count
      FROM error_log
      WHERE err_type NOT IN ('BAD_DATETIME', 'DROPOFF_BEFORE_PICKUP')
      GROUP BY err_type
      ORDER BY count DESC
    `);

    // math time: counting every single l we found in the data
    const totals = await db.query(`
      SELECT
        COUNT(*)                  AS total_records,
        COUNT(DISTINCT row_num)   AS unique_flagged_rows
      FROM error_log
      WHERE err_type NOT IN ('BAD_DATETIME', 'DROPOFF_BEFORE_PICKUP')
    `);

    // checking the total trip count so we can calculate the sus percentage
    const tripCount = await db.query(`SELECT COUNT(*) AS total FROM trips`);

    const totalTrips  = parseInt(tripCount.rows[0].total, 10);
    const flaggedRows = parseInt(totals.rows[0].unique_flagged_rows, 10);
    const flagRate    = totalTrips > 0
      ? parseFloat(((flaggedRows / totalTrips) * 100).toFixed(2))
      : 0;

    // sending the tea back to the frontend
    ok(res, {
      total_error_records: parseInt(totals.rows[0].total_records, 10),
      unique_flagged_rows: flaggedRows,
      flag_rate_percent:   flagRate,
      by_type:             byType.rows,
    });
  } catch (err) {
    // if it flops, log it and tell the user they're cooked
    console.error('[anomalies/summary]', err.message);
    error(res, 500, 'failed to fetch anomaly summary', err.message);
  }
}

// get /api/anomalies/list
// getting a whole list of receipts so we can see why these trips are weird
async function getAnomalyList(req, res, query) {
  // capping the limit so the frontend doesn't explode
  const limit  = Math.min(parseInt(query.limit, 10)  || 50, 200);
  const offset = Math.max(parseInt(query.offset, 10) || 0,  0);
  const type   = query.type || null;

  const params     = [limit, offset];
  let   typeClause = '';

  // if the user is looking for a specific type of error, filter it here
  if (type) {
    typeClause = 'AND el.err_type = $3';
    params.push(type);
  }

  try {
    // digging into the jsonb storage to pull out fare and distance info
    const result = await db.query(`
      SELECT
        el.err_id,
        el.row_num,
        el.err_type,
        el.details,
        el.created_at,
        -- parsing the json stuff bc sql needs real numbers to deal
        (el.details->>'fare')::numeric     AS fare,
        (el.details->>'distance')::numeric AS distance
      FROM error_log el
      WHERE 1=1 ${typeClause}
        AND el.err_type NOT IN ('BAD_DATETIME', 'DROPOFF_BEFORE_PICKUP')
      ORDER BY el.created_at DESC
      LIMIT $1 OFFSET $2
    `, params);

    // get the total count so the frontend knows how many pages to show
    const countParams = type ? [type] : [];
    const countWhere  = type
      ? "WHERE err_type = $1 AND err_type NOT IN ('BAD_DATETIME','DROPOFF_BEFORE_PICKUP')"
      : "WHERE err_type NOT IN ('BAD_DATETIME','DROPOFF_BEFORE_PICKUP')";
    const countResult = await db.query(
      `SELECT COUNT(*) AS total FROM error_log ${countWhere}`,
      countParams,
    );

    const total = parseInt(countResult.rows[0].total, 10);
    // success! return the rows and the paging info
    ok(res, result.rows, {
      total,
      limit,
      offset,
      count:    result.rows.length,
      has_more: offset + result.rows.length < total,
    });
  } catch (err) {
    // big error vibes, logging it now
    console.error('[anomalies/list]', err.message);
    error(res, 500, 'failed to fetch anomaly list', err.message);
  }
}

// this is the traffic controller for the anomaly routes
async function handle(req, res, subpath, query) {
  // only get requests allowed here, no cap
  if (req.method !== 'GET') return error(res, 405, 'method not allowed');
  if (subpath === '/summary') return getAnomalySummary(req, res);
  if (subpath === '/list')    return getAnomalyList(req, res, query);
  
  // if they hit a weird url, tell them it's a 404
  error(res, 404, `anomalies route not found: ${subpath}`);
}

module.exports = { handle };