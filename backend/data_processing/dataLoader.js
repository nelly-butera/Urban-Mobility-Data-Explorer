'use strict';

const fs   = require('fs');
const path = require('path');
const { parse }  = require('csv-parse');

const config = require('../config');
const db     = require('../database');
const { computeFeatures }  = require('./featureEngineering');
const { buildTripKey }     = require('./deduplication');
const { detectAnomalies }  = require('./anomalyDetection');

const CHUNK_SIZE = 2000;
const ROW_LIMIT = 1000000;
const PEAK_HOURS = new Set([7, 8, 9, 16, 17, 18, 19]);

// ─────────────────────────────────────────────
// Stage 1 — load the zone lookup CSV into the zones table
// ─────────────────────────────────────────────

async function loadZoneLookup() {
  const filePath = path.resolve(config.data.zonesCSVPath);
  console.log(`[Loader] Reading zone lookup: ${filePath}`);

  const rows = await new Promise((resolve, reject) => {
    const records = [];
    fs.createReadStream(filePath)
      .pipe(parse({ columns: true, trim: true, skip_empty_lines: true }))
      .on('data', (row) => { records.push(row); })
      .on('end',  () => resolve(records))
      .on('error', reject);
  });

  console.log(`[Loader] Parsed ${rows.length} zone rows`);

  // build in-memory hash map for the trip join later
  const zoneMap = Object.create(null);
  for (let i = 0; i < rows.length; i++) {
    const r  = rows[i];
    const id = parseInt(r.LocationID, 10);
    zoneMap[id] = {
      borough:      r.Borough      || null,
      zone:         r.Zone         || null,
      service_zone: r.service_zone || null,
    };
  }

  // insert all zones — tiny dataset so one statement is fine
  const values = [];
  const params = [];
  let   p      = 1;
  for (let i = 0; i < rows.length; i++) {
    const r = rows[i];
    values.push(`($${p++}, $${p++}, $${p++}, $${p++})`);
    params.push(
      parseInt(r.LocationID, 10),
      r.Borough      || null,
      r.Zone         || null,
      r.service_zone || null,
    );
  }

  await db.query(`
    INSERT INTO zones (id, borough, zone_name, service_zone)
    VALUES ${values.join(',')}
    ON CONFLICT (id) DO NOTHING
  `, params);

  console.log(`[Loader] Inserted ${rows.length} rows into zones`);
  return zoneMap;
}

// ─────────────────────────────────────────────
// Row normalisation
// Parses one CSV row, runs quality checks, and builds the trip object.
// Returns the trip plus a logs array for anything flagged.
// ─────────────────────────────────────────────

function normaliseRow(raw, rowNum, zoneMap) {
  const logs     = [];
  let   excluded = false;

  function flag(code, action, reason, field, value) {
    logs.push({
      row_num:    rowNum,
      err_type:   code,
      action:     action,
      reason,
      field_name: field,
      orig_value: String(value ?? ''),
    });
  }

  // datetimes
  const pickupDt  = new Date(raw.tpep_pickup_datetime);
  const dropoffDt = new Date(raw.tpep_dropoff_datetime);

  if (isNaN(pickupDt.getTime()) || isNaN(dropoffDt.getTime())) {
    flag('BAD_DATETIME', 'excluded', 'unparseable pickup or dropoff datetime',
         'tpep_pickup_datetime', raw.tpep_pickup_datetime);
    excluded = true;
  }

  if (!excluded && dropoffDt <= pickupDt) {
    flag('DROPOFF_BEFORE_PICKUP', 'excluded',
         `dropoff ${raw.tpep_dropoff_datetime} is not after pickup ${raw.tpep_pickup_datetime}`,
         'tpep_dropoff_datetime', raw.tpep_dropoff_datetime);
    excluded = true;
  }

  // numeric fields
  const passengers = parseInt(raw.passenger_count, 10);
  const distance   = parseFloat(raw.trip_distance);
  const fare       = parseFloat(raw.fare_amount);
  const tip        = parseFloat(raw.tip_amount);
  const total      = parseFloat(raw.total_amount);
  const rateId     = parseInt(raw.RatecodeID, 10);
  const congestion = raw.congestion_surcharge !== ''
    ? parseFloat(raw.congestion_surcharge)
    : null;  // 63% missing, store as null not 0

  // quality checks — retain but flag unless marked excluded above
  if (passengers <= 0)  flag('ZERO_PASS',     'retained', `passenger_count is ${passengers} (≤ 0)`,     'passenger_count',  passengers);
  if (passengers > 8)   flag('HIGH_PASS',     'retained', `passenger_count is ${passengers} (> 8)`,     'passenger_count',  passengers);
  if (distance <= 0)    flag('ZERO_DIST',     'retained', `trip_distance is ${distance} (≤ 0)`,         'trip_distance',    distance);
  if (distance > 100)   flag('LARGE_DIST',    'retained', `trip_distance is ${distance} (> 100 miles)`, 'trip_distance',    distance);
  if (fare < 0)         flag('NEG_FARE',      'retained', `fare_amount is ${fare} (negative)`,          'fare_amount',      fare);
  if (total < 0)        flag('NEG_TOTAL',     'retained', `total_amount is ${total} (negative)`,        'total_amount',     total);
  if (tip < 0)          flag('NEG_TIP',       'retained', `tip_amount is ${tip} (negative)`,            'tip_amount',       tip);
  if (![1,2,3,4,5,6].includes(rateId))
                        flag('BAD_RATE_CODE', 'retained', `RatecodeID ${rateId} is non-standard`,       'RatecodeID',       rateId);

  // zone join
  const puId   = parseInt(raw.PULocationID, 10) || null;
  const doId   = parseInt(raw.DOLocationID, 10) || null;
  const puZone = puId ? (zoneMap[puId] || {}) : {};
  const doZone = doId ? (zoneMap[doId] || {}) : {};

  // time columns
  const hourOfDay   = excluded ? null : pickupDt.getHours();
  const dayOfWeek   = excluded ? null : pickupDt.getDay();
  const isPeak      = hourOfDay !== null ? PEAK_HOURS.has(hourOfDay) : null;

  const trip = {
    vendor:       parseInt(raw.VendorID, 10)     || null,
    pickup_time:  excluded ? null : pickupDt.toISOString(),
    dropoff_time: excluded ? null : dropoffDt.toISOString(),
    passengers:   isNaN(passengers) ? null : passengers,
    distance:     isNaN(distance)   ? 0    : distance,
    rate_id:      isNaN(rateId)     ? null : rateId,
    store_fwd:    raw.store_and_fwd_flag || null,
    pickup_zone:  puId,
    dropoff_zone: doId,
    payment_type: parseInt(raw.payment_type, 10) || null,
    fare:         isNaN(fare)  ? 0 : fare,
    extra:        parseFloat(raw.extra)           || 0,
    tax:          parseFloat(raw.mta_tax)          || 0,
    tip:          isNaN(tip)   ? 0 : tip,
    tolls:        parseFloat(raw.tolls_amount)     || 0,
    surcharge:    parseFloat(raw.improvement_surcharge) || 0,
    total:        isNaN(total) ? 0 : total,
    congestion,
    hour_of_day:  hourOfDay,
    day_of_week:  dayOfWeek,
    is_peak:      isPeak,
    // computed by featureEngineering next
    duration_min:   null,
    speed_mph:      null,
    money_per_min:  null,
    tip_pct:        null,
    cost_per_mile:  null,
    _rowNum:        rowNum,
    _excluded:      excluded,
  };

  return { trip, logs, excluded };
}

// ─────────────────────────────────────────────
// Feature engineering + extra anomaly checks
// ─────────────────────────────────────────────

function enrichTrip(trip) {
  // featureEngineering.js expects the old field names internally,
  // so we pass a temporary alias map
  const alias = {
    pickup_datetime:       trip.pickup_time,
    dropoff_datetime:      trip.dropoff_time,
    trip_distance:         trip.distance,
    total_amount:          trip.total,
    fare_amount:           trip.fare,
    tip_amount:            trip.tip,
  };

  const pickupMs  = new Date(alias.pickup_datetime).getTime();
  const dropoffMs = new Date(alias.dropoff_datetime).getTime();
  const durationMs = dropoffMs - pickupMs;

  trip.duration_min = isFinite(durationMs) && durationMs > 0
    ? parseFloat((durationMs / 60000).toFixed(2))
    : null;

  const durationHours = trip.duration_min ? trip.duration_min / 60 : null;
  trip.speed_mph = durationHours && durationHours > 0 && trip.distance > 0
    ? parseFloat((trip.distance / durationHours).toFixed(2))
    : null;

  trip.money_per_min = trip.duration_min && trip.duration_min > 0
    ? parseFloat((trip.total / trip.duration_min).toFixed(4))
    : null;

  trip.tip_pct = trip.fare > 0
    ? parseFloat(((trip.tip / trip.fare) * 100).toFixed(2))
    : null;

  trip.cost_per_mile = trip.distance > 0
    ? parseFloat((trip.total / trip.distance).toFixed(4))
    : null;

  return trip;
}

function checkAnomalies(trip, rowNum, logBatch) {
  const types = [];

  if (trip.speed_mph !== null && trip.speed_mph > 80) {
    types.push('HIGH_SPEED');
    logBatch.push({ row_num: rowNum, err_type: 'HIGH_SPEED', action: 'retained',
      reason: `speed_mph is ${trip.speed_mph} (> 80)`, field_name: 'speed_mph',
      orig_value: String(trip.speed_mph) });
  }
  if (trip.tip_pct !== null && trip.tip_pct > 100) {
    types.push('HIGH_TIP_PCT');
    logBatch.push({ row_num: rowNum, err_type: 'HIGH_TIP_PCT', action: 'retained',
      reason: `tip_pct is ${trip.tip_pct} (> 100%)`, field_name: 'tip_pct',
      orig_value: String(trip.tip_pct) });
  }
  if (trip.distance === 0 && trip.fare > 0) {
    types.push('ZERO_DIST_POS_FARE');
    logBatch.push({ row_num: rowNum, err_type: 'ZERO_DIST_POS_FARE', action: 'retained',
      reason: `distance=0 but fare=${trip.fare}`, field_name: 'distance',
      orig_value: '0' });
  }

  return types;
}

// ─────────────────────────────────────────────
// Bulk insert helpers
// ─────────────────────────────────────────────

async function bulkInsertTrips(trips) {
  if (trips.length === 0) return 0;

  const values = [];
  const params = [];
  let   p = 1;

  for (let i = 0; i < trips.length; i++) {
    const t = trips[i];
    values.push(`(
      $${p++},$${p++},$${p++},$${p++},$${p++},
      $${p++},$${p++},$${p++},$${p++},$${p++},
      $${p++},$${p++},$${p++},$${p++},$${p++},
      $${p++},$${p++},$${p++},$${p++},$${p++},
      $${p++},$${p++},$${p++},$${p++},$${p++},$${p++}
    )`);
    params.push(
      t.vendor,        t.pickup_time,   t.dropoff_time,
      t.passengers,    t.distance,      t.rate_id,
      t.store_fwd,     t.pickup_zone,   t.dropoff_zone,
      t.payment_type,  t.fare,          t.extra,
      t.tax,           t.tip,           t.tolls,
      t.surcharge,     t.total,         t.congestion,
      t.duration_min,  t.speed_mph,     t.money_per_min,
      t.tip_pct,       t.cost_per_mile, t.hour_of_day,
      t.day_of_week,   t.is_peak,
    );
  }

  const sql = `
    INSERT INTO trips (
      vendor, pickup_time, dropoff_time,
      passengers, distance, rate_id,
      store_fwd, pickup_zone, dropoff_zone,
      payment_type, fare, extra,
      tax, tip, tolls,
      surcharge, total, congestion,
      duration_min, speed_mph, money_per_min,
      tip_pct, cost_per_mile, hour_of_day,
      day_of_week, is_peak
    ) VALUES ${values.join(',')}
    ON CONFLICT DO NOTHING
  `;

  const result = await db.query(sql, params);
  return result.rowCount || 0;
}

async function bulkInsertErrors(items) {
  if (items.length === 0) return 0;

  const values = [];
  const params = [];
  let   p = 1;

  for (let i = 0; i < items.length; i++) {
    const { rowNum, type, details, raw } = items[i];
    values.push(`(uuid_generate_v4(), $${p++}, $${p++}, $${p++}, $${p++}, NOW())`);
    params.push(rowNum, type, JSON.stringify(details), JSON.stringify(raw));
  }

  const result = await db.query(`
    INSERT INTO error_log (err_id, row_num, err_type, details, raw_data, created_at)
    VALUES ${values.join(',')}
  `, params);
  return result.rowCount || 0;
}

// quality_log no longer exists as a separate table — flags go into error_log too
async function bulkInsertQualityFlags(logs) {
  if (logs.length === 0) return 0;

  const values = [];
  const params = [];
  let   p = 1;

  for (let i = 0; i < logs.length; i++) {
    const l = logs[i];
    // store quality flags in error_log with the flag info packed into details
    values.push(`(uuid_generate_v4(), $${p++}, $${p++}, $${p++}, $${p++}, NOW())`);
    params.push(
      l.row_num,
      l.err_type,
      JSON.stringify({ action: l.action, reason: l.reason,
                       field: l.field_name, original_value: l.orig_value }),
      JSON.stringify({}),
    );
  }

  const result = await db.query(`
    INSERT INTO error_log (err_id, row_num, err_type, details, raw_data, created_at)
    VALUES ${values.join(',')}
  `, params);
  return result.rowCount || 0;
}

// ─────────────────────────────────────────────
// Main pipeline
// ─────────────────────────────────────────────

async function loadData() {
  console.log('[Loader] Starting pipeline...');

  const zoneMap = await loadZoneLookup();

  const tripsPath = path.resolve(config.data.tripsCSVPath);
  console.log(`[Loader] Streaming: ${tripsPath}`);

  const globalSeen = Object.create(null);

  let rowNum         = 0;
  let totalRaw       = 0;
  let totalDupes     = 0;
  let totalExcluded  = 0;
  let totalClean     = 0;
  let totalAnomalous = 0;
  let totalInserted  = 0;

  let tripBatch  = [];
  let errorBatch = [];
  let logBatch   = [];

  async function flushBatch() {
    totalInserted += await bulkInsertTrips(tripBatch);
    await bulkInsertErrors(errorBatch);
    await bulkInsertQualityFlags(logBatch);
    tripBatch  = [];
    errorBatch = [];
    logBatch   = [];
  }

  await new Promise((resolve, reject) => {
    const parser = parse({ columns: true, trim: true, skip_empty_lines: true });

    parser.on('data', async (raw) => {
      rowNum++;
      totalRaw++;

      if(rowNum > ROW_LIMIT){
        parser.destroy();
        return;
      }
      parser.pause();

      try {
        const { trip, logs, excluded } = normaliseRow(raw, rowNum, zoneMap);

        for (let i = 0; i < logs.length; i++) logBatch.push(logs[i]);

        if (excluded) {
          totalExcluded++;
          if (tripBatch.length >= CHUNK_SIZE) await flushBatch();
          parser.resume();
          return;
        }

        // dedup
        const key = buildTripKey({
          vendor_id:        trip.vendor,
          pickup_datetime:  trip.pickup_time,
          dropoff_datetime: trip.dropoff_time,
          pu_location_id:   trip.pickup_zone,
          do_location_id:   trip.dropoff_zone,
          total_amount:     trip.total,
        });
        if (globalSeen[key] !== undefined) {
          totalDupes++;
          parser.resume();
          return;
        }
        globalSeen[key] = 1;

        enrichTrip(trip);

        const anomalyTypes = checkAnomalies(trip, rowNum, logBatch);

        if (anomalyTypes.length > 0) {
          totalAnomalous++;
          for (let i = 0; i < anomalyTypes.length; i++) {
            errorBatch.push({
              rowNum,
              type:    anomalyTypes[i],
              details: { distance: trip.distance, fare: trip.fare,
                         speed_mph: trip.speed_mph, duration_min: trip.duration_min,
                         tip_pct: trip.tip_pct },
              raw,
            });
          }
        } else {
          totalClean++;
        }

        delete trip._rowNum;
        delete trip._excluded;
        tripBatch.push(trip);

        if (tripBatch.length >= CHUNK_SIZE) await flushBatch();

        if (rowNum % 100000 === 0) {
          console.log(`[Loader] ${rowNum.toLocaleString()} rows | ` +
            `clean=${totalClean.toLocaleString()} | ` +
            `flagged=${totalAnomalous.toLocaleString()} | ` +
            `skipped=${totalExcluded.toLocaleString()} | ` +
            `dupes=${totalDupes.toLocaleString()}`);
        }
      } catch (err) {
        console.error(`[Loader] Row ${rowNum} error:`, err.message);
      }

      parser.resume();
    });

    parser.on('end', () => resolve());
    parser.on('close', () => resolve());
    parser.on('error', reject);

    const fileStream = fs.createReadStream(tripsPath);
    fileStream.pipe(parser);
  });

  if (tripBatch.length > 0 || errorBatch.length > 0 || logBatch.length > 0) {
    await flushBatch();
  }

  console.log('[Loader] Refreshing views...');
  await db.query('SELECT update_stats()');

  const summary = {
    total_raw_rows: totalRaw,
    excluded:       totalExcluded,
    duplicates:     totalDupes,
    flagged:        totalAnomalous,
    clean:          totalClean,
    inserted:       totalInserted,
  };

  console.log('[Loader] Done:', summary);
  return summary;
}

module.exports = { loadData };
