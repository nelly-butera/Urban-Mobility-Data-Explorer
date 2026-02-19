'use strict';

/**
 * data_processing/featureEngineering.js
 * Computes derived features for each taxi trip record:
 *   - trip_duration_minutes
 *   - average_speed_mph
 *   - revenue_per_minute
 *   - tip_percentage
 */

/**
 * Enrich a single trip object with derived features.
 * The input record is mutated in-place and returned.
 *
 * @param {Object} trip  Raw trip record (post-join with zone data)
 * @returns {Object}     Same object with new numeric fields appended
 */
function computeFeatures(trip) {
  // ── trip_duration_minutes ─────────────────────────────────────────────────
  const pickupMs  = new Date(trip.pickup_datetime).getTime();
  const dropoffMs = new Date(trip.dropoff_datetime).getTime();
  const durationMs = dropoffMs - pickupMs;

  // Store as decimal minutes; null if dates are invalid
  trip.trip_duration_minutes =
    isFinite(durationMs) && durationMs > 0
      ? parseFloat((durationMs / 60000).toFixed(2))
      : null;

  // ── average_speed_mph ─────────────────────────────────────────────────────
  const distanceMiles     = parseFloat(trip.trip_distance) || 0;
  const durationHours     = trip.trip_duration_minutes
    ? trip.trip_duration_minutes / 60
    : null;

  trip.average_speed_mph =
    durationHours && durationHours > 0 && distanceMiles > 0
      ? parseFloat((distanceMiles / durationHours).toFixed(2))
      : null;

  // ── revenue_per_minute ────────────────────────────────────────────────────
  const totalAmount = parseFloat(trip.total_amount) || 0;

  trip.revenue_per_minute =
    trip.trip_duration_minutes && trip.trip_duration_minutes > 0
      ? parseFloat((totalAmount / trip.trip_duration_minutes).toFixed(4))
      : null;

  // ── tip_percentage ────────────────────────────────────────────────────────
  const tipAmount  = parseFloat(trip.tip_amount)  || 0;
  const fareAmount = parseFloat(trip.fare_amount) || 0;

  trip.tip_percentage =
    fareAmount > 0
      ? parseFloat(((tipAmount / fareAmount) * 100).toFixed(2))
      : null;

  return trip;
}

/**
 * Enrich an array of trips in a single pass — O(n).
 *
 * @param {Array<Object>} trips
 * @returns {Array<Object>} Same array, each element enriched
 */
function computeFeaturesForAll(trips) {
  for (let i = 0; i < trips.length; i++) {
    computeFeatures(trips[i]);
  }
  return trips;
}

module.exports = { computeFeatures, computeFeaturesForAll };
