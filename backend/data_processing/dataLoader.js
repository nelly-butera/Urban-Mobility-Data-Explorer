'use strict';

// Import the basic tools we need for files and paths
const fs   = require('fs');
const path = require('path');
const { parse }  = require('csv-parse');

// Bring in our own project settings and database connection
const config = require('../config');
const db     = require('../database');
const { computeFeatures }  = require('./featureEngineering');
const { buildTripKey }     = require('./deduplication');
const { detectAnomalies }  = require('./anomalyDetection');

// Set some basic limits so the computer doesn't crash
const CHUNK_SIZE = 2000;
const ROW_LIMIT = 1000000;
const PEAK_HOURS = new Set([7, 8, 9, 16, 17, 18, 19]);

// This function reads the taxi zones from a CSV and puts them in the database
async function loadZoneLookup() {
  const filePath = path.resolve(config.data.zonesCSVPath);
  console.log(`[Loader] Reading zone lookup: ${filePath}`);

  // Use a promise to wait for the whole file to finish reading
  const rows = await new Promise((resolve, reject) => {
    const records = [];
    fs.createReadStream(filePath)
      .pipe(parse({ columns: true, trim: true, skip_empty_lines: true }))
      .on('data', (row) => { records.push(row); })
      .on('end',  () => resolve(records))
      .on('error', reject);
  });

  console.log(`[Loader] Parsed ${rows.length} zone rows`);

  // Create a quick-access list in memory so we don't have to ask the DB every time
  const zoneMap = Object.create(null);
  for (let i = 0; i < rows.length; i++) {
    const r  = rows[i];
    const id = parseInt(r.LocationID, 10);
    zoneMap[id] = {
      borough:      r.Borough       || null,
      zone:         r.Zone          || null,
      service_zone: r.service_zone || null,
    };
  }

  // Prepare the data to be sent to the database in one big group
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

  // Run the SQL command to save the zones, but skip any we already have
  await db.query(`
    INSERT INTO zones (id, borough, zone_name, service_zone)
    VALUES ${values.join(',')}
    ON CONFLICT (id) DO NOTHING
  `, params);

  console.log(`[Loader] Inserted ${rows.length} rows into zones`);
  return zoneMap;
}

// This function cleans up one row of data and checks if it's broken
function normaliseRow(raw, rowNum, zoneMap) {
  const logs     = [];
  let   excluded = false;

  // Small helper to keep track of any errors we find
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

  // Turn the text dates into actual Javascript dates
  const pickupDt  = new Date(raw.tpep_pickup_datetime);
  const dropoffDt = new Date(raw.tpep_dropoff_datetime);

  // If the dates are gibberish, we can't use this trip
  if (isNaN(pickupDt.getTime()) || isNaN(dropoffDt.getTime())) {
    flag('BAD_DATETIME', 'excluded', 'unparseable pickup or dropoff datetime',
         'tpep_pickup_datetime', raw.tpep_pickup_datetime);
    excluded = true;
  }

  // Make sure the taxi didn't finish before it started
  if (!excluded && dropoffDt <= pickupDt) {
    flag('DROPOFF_BEFORE_PICKUP', 'excluded',
         `dropoff ${raw.tpep_dropoff_datetime} is not after pickup ${raw.tpep_pickup_datetime}`,
         'tpep_dropoff_datetime', raw.tpep_dropoff_datetime);
    excluded = true;
  }

  // Convert all the text numbers from the CSV into real numbers
  const passengers = parseInt(raw.passenger_count, 10);
  const distance   = parseFloat(raw.trip_distance);
  const fare       = parseFloat(raw.fare_amount);
  const tip        = parseFloat(raw.tip_amount);
  const total      = parseFloat(raw.total_amount);
  const rateId     = parseInt(raw.RatecodeID, 10);
  const congestion = raw.congestion_surcharge !== ''
    ? parseFloat(raw.congestion_surcharge)
    : null; 

  // Check for weird numbers like zero passengers or negative money
  if (passengers <= 0)  flag('ZERO_PASS',     'retained', `passenger_count is ${passengers} (≤ 0)`,     'passenger_count',  passengers);
  if (passengers > 8)   flag('HIGH_PASS',     'retained', `passenger_count is ${passengers} (> 8)`,     'passenger_count',  passengers);
  if (distance <= 0)    flag('ZERO_DIST',     'retained', `trip_distance is ${distance} (≤ 0)`,         'trip_distance',    distance);
  if (distance > 100)   flag('LARGE_DIST',    'retained', `trip_distance is ${distance} (> 100 miles)`, 'trip_distance',    distance);
  if (fare < 0)         flag('NEG_FARE',      'retained', `fare_amount is ${fare} (negative)`,          'fare_amount',      fare);
  if (total < 0)        flag('NEG_TOTAL',     'retained', `total_amount is ${total} (negative)`,        'total_amount',     total);
  if (tip < 0)          flag('NEG_TIP',       'retained', `tip_amount is ${tip} (negative)`,            'tip_amount',       tip);
  if (![1,2,3,4,5,6].includes(rateId))
                        flag('BAD_RATE_CODE', 'retained', `RatecodeID ${rateId} is non-standard`,       'RatecodeID',       rateId);

  // Figure out which neighborhood the taxi was in
  const puId   = parseInt(raw.PULocationID, 10) || null;
  const doId   = parseInt(raw.DOLocationID, 10) || null;
  const puZone = puId ? (zoneMap[puId] || {}) : {};
  const doZone = doId ? (zoneMap[doId] || {}) : {};

  // Extract the hour and day to help with our charts later
  const hourOfDay   = excluded ? null : pickupDt.getHours();
  const dayOfWeek   = excluded ? null : pickupDt.getDay();
  const isPeak      = hourOfDay !== null ? PEAK_HOURS.has(hourOfDay) : null;

  // Build the final object that will be saved in our database table
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

// This function does extra math to find things like speed and tip percentage
function enrichTrip(trip) {
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

  // Calculate how many minutes the trip lasted
  trip.duration_min = isFinite(durationMs) && durationMs > 0
    ? parseFloat((durationMs / 60000).toFixed(2))
    : null;

  // Calculate how fast the taxi was going in miles per hour
  const durationHours = trip.duration_min ? trip.duration_min / 60 : null;
  trip.speed_mph = durationHours && durationHours > 0 && trip.distance > 0
    ? parseFloat((trip.distance / durationHours).toFixed(2))
    : null;

  // Figure out how much money was made for every minute driven
  trip.money_per_min = trip.duration_min && trip.duration_min > 0
    ? parseFloat((trip.total / trip.duration_min).toFixed(4))
    : null;

  // Calculate the tip percentage (like 15% or 20%)
  trip.tip_pct = trip.fare > 0
    ? parseFloat(((trip.tip / trip.fare) * 100).toFixed(2))
    : null;

  // See how expensive each mile was for the passenger
  trip.cost_per_mile = trip.distance > 0
    ? parseFloat((trip.total / trip.distance).toFixed(4))
    : null;

  return trip;
}

// This checks for "impossible" data, like a taxi going 100mph
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

// This function takes a big group of trips and saves them to the DB all at once
async function bulkInsertTrips(trips) {
  if (trips.length === 0) return 0;

  const values = [];
  const params = [];
  let   p = 1;

  // Build a huge SQL list of all the values we want to insert
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

  // Define exactly where each piece of data goes in our SQL table
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

// Save any errors or weird trips into the error_log table
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

// Similar to the error log, but specifically for data quality issues
async function bulkInsertQualityFlags(logs) {
  if (logs.length === 0) return 0;

  const values = [];
  const params = [];
  let   p = 1;

  for (let i = 0; i < logs.length; i++) {
    const l = logs[i];
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

// This is the main engine that starts the whole loading process
async function loadData() {
  console.log('[Loader] Starting pipeline...');

  // First, load the zones map so we can link trips to locations
  const zoneMap = await loadZoneLookup();

  const tripsPath = path.resolve(config.data.tripsCSVPath);
  console.log(`[Loader] Streaming: ${tripsPath}`);

  // This object helps us remember trips we've already seen so we don't save them twice
  const globalSeen = Object.create(null);

  // Set up some counters to track our progress
  let rowNum         = 0;
  let totalRaw       = 0;
  let totalDupes     = 0;
  let totalExcluded  = 0;
  let totalClean     = 0;
  let totalAnomalous = 0;
  let totalInserted  = 0;

  // Empty buckets to hold data until we have enough to save to the DB
  let tripBatch  = [];
  let errorBatch = [];
  let logBatch   = [];

  // This helper pushes our current buckets into the database
  async function flushBatch() {
    totalInserted += await bulkInsertTrips(tripBatch);
    await bulkInsertErrors(errorBatch);
    await bulkInsertQualityFlags(logBatch);
    tripBatch  = [];
    errorBatch = [];
    logBatch   = [];
  }

  // Start reading the giant CSV file row by row
  await new Promise((resolve, reject) => {
    const parser = parse({ columns: true, trim: true, skip_empty_lines: true });

    parser.on('data', async (raw) => {
      rowNum++;
      totalRaw++;

      // Stop if we hit our limit so it doesn't run forever
      if(rowNum > ROW_LIMIT){
        parser.destroy();
        return;
      }
      parser.pause();

      try {
        // Clean the row and see if it's usable
        const { trip, logs, excluded } = normaliseRow(raw, rowNum, zoneMap);

        for (let i = 0; i < logs.length; i++) logBatch.push(logs[i]);

        // If the row is totally broken, just skip it and move on
        if (excluded) {
          totalExcluded++;
          if (tripBatch.length >= CHUNK_SIZE) await flushBatch();
          parser.resume();
          return;
        }

        // Check if we've already seen this exact trip before
        const key = buildTripKey({
          vendor_id:         trip.vendor,
          pickup_datetime:   trip.pickup_time,
          dropoff_datetime: trip.dropoff_time,
          pu_location_id:    trip.pickup_zone,
          do_location_id:    trip.dropoff_zone,
          total_amount:      trip.total,
        });
        if (globalSeen[key] !== undefined) {
          totalDupes++;
          parser.resume();
          return;
        }
        globalSeen[key] = 1;

        // Calculate the speed and other cool features
        enrichTrip(trip);

        // Check if the trip looks suspicious or weird
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

        // Remove our temporary row markers before saving
        delete trip._rowNum;
        delete trip._excluded;
        tripBatch.push(trip);

        // If we have 2000 trips ready, save them to the DB
        if (tripBatch.length >= CHUNK_SIZE) await flushBatch();

        // Print a message every 100,000 rows so we know it's still working
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

  // Save any leftover data that didn't fill a whole batch
  if (tripBatch.length > 0 || errorBatch.length > 0 || logBatch.length > 0) {
    await flushBatch();
  }

  // Tell the database to update its summary tables for the dashboard
  console.log('[Loader] Refreshing views...');
  await db.query('SELECT update_stats()');

  // Print a final summary of everything we did
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