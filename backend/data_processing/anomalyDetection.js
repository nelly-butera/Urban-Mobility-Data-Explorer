'use strict';

/**
 * data_processing/anomalyDetection.js
 * Flags and separates unusual trip entries.
 *
 * Anomaly types detected:
 *   1. zero_distance_positive_fare  — trip_distance == 0 but fare_amount > 0
 *   2. excessive_speed              — average_speed_mph > 80
 *   3. invalid_duration             — trip_duration_minutes <= 0 or null
 *   4. excessive_tip_percentage     — tip_percentage > 100%
 *
 * Each flagged trip is moved to an anomalies list; clean trips are returned separately.
 *
 * Time Complexity: O(n) — single forward pass with O(1) checks per trip.
 */

const config = require('../config');

// ---------------------------------------------------------------------------
// Individual anomaly checkers
// ---------------------------------------------------------------------------

/**
 * @param {Object} trip
 * @returns {string|null}  Anomaly type label, or null if OK
 */
function checkZeroDistancePositiveFare(trip) {
  const distance = parseFloat(trip.trip_distance) || 0;
  const fare     = parseFloat(trip.fare_amount)   || 0;
  if (distance === 0 && fare > 0) {
    return 'zero_distance_positive_fare';
  }
  return null;
}

/**
 * @param {Object} trip
 * @returns {string|null}
 */
function checkExcessiveSpeed(trip) {
  const speed = parseFloat(trip.average_speed_mph);
  if (isFinite(speed) && speed > config.anomaly.maxSpeedMph) {
    return 'excessive_speed';
  }
  return null;
}

/**
 * @param {Object} trip
 * @returns {string|null}
 */
function checkInvalidDuration(trip) {
  if (trip.trip_duration_minutes === null || trip.trip_duration_minutes <= 0) {
    return 'invalid_duration';
  }
  return null;
}

/**
 * @param {Object} trip
 * @returns {string|null}
 */
function checkExcessiveTipPercentage(trip) {
  const tipPct = parseFloat(trip.tip_percentage);
  if (isFinite(tipPct) && tipPct > config.anomaly.maxTipPercentage) {
    return 'excessive_tip_percentage';
  }
  return null;
}

// Ordered list of checker functions — easy to extend
const CHECKERS = [
  checkZeroDistancePositiveFare,
  checkExcessiveSpeed,
  checkInvalidDuration,
  checkExcessiveTipPercentage,
];

// ---------------------------------------------------------------------------
// Public API
// ---------------------------------------------------------------------------

/**
 * Run all anomaly checks against a trip.
 * Returns an array of anomaly type labels (may be empty if clean).
 *
 * @param {Object} trip
 * @returns {string[]}
 */
function detectAnomalies(trip) {
  const flags = [];
  for (let i = 0; i < CHECKERS.length; i++) {
    const result = CHECKERS[i](trip);
    if (result !== null) {
      flags[flags.length] = result;
    }
  }
  return flags;
}

/**
 * Partition trips into { clean, anomalies }.
 * A trip with ANY anomaly flag is moved to the anomalies list.
 *
 * @param {Array<Object>} trips  Enriched trip records (features already computed)
 * @returns {{ clean: Array<Object>, anomalies: Array<{trip: Object, types: string[]}> }}
 */
function partitionTrips(trips) {
  const clean     = [];
  const anomalies = [];

  for (let i = 0; i < trips.length; i++) {
    const trip  = trips[i];
    const flags = detectAnomalies(trip);

    if (flags.length === 0) {
      clean[clean.length] = trip;
    } else {
      anomalies[anomalies.length] = {
        trip,
        types:  flags,
        detail: buildAnomalyDetail(trip, flags),
      };
    }
  }

  return { clean, anomalies };
}

/**
 * Build a structured detail object for an anomalous trip (stored in DB as JSONB).
 * @param {Object}   trip
 * @param {string[]} types
 * @returns {Object}
 */
function buildAnomalyDetail(trip, types) {
  return {
    anomaly_types:        types,
    trip_distance:        trip.trip_distance,
    fare_amount:          trip.fare_amount,
    average_speed_mph:    trip.average_speed_mph,
    trip_duration_minutes: trip.trip_duration_minutes,
    tip_percentage:       trip.tip_percentage,
  };
}

module.exports = { detectAnomalies, partitionTrips };
