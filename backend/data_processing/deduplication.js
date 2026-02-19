'use strict';

/**
 * data_processing/deduplication.js
 *
 * Manual deduplication using a plain object as a hash table.
 * Per requirements: no built-in Set, no advanced utilities.
 *
 * Strategy:
 *   Build a composite key from the fields that uniquely identify a trip.
 *   On first encounter, store the trip. On subsequent encounters, skip it.
 *
 * Time Complexity:  O(n)  — single forward pass; hash-table lookup/insert O(1) avg.
 * Space Complexity: O(n)  — hash table stores at most n keys.
 */

/**
 * Produce a deterministic string key that identifies a unique trip.
 * Uses: vendor_id + pickup_datetime + dropoff_datetime + pu_location_id + do_location_id + total_amount.
 *
 * @param {Object} trip
 * @returns {string}
 */
function buildTripKey(trip) {
  return [
    trip.vendor_id          ?? '',
    trip.pickup_datetime    ?? '',
    trip.dropoff_datetime   ?? '',
    trip.pu_location_id     ?? '',
    trip.do_location_id     ?? '',
    trip.total_amount       ?? '',
  ].join('|');
}

/**
 * Remove duplicate trip records using a hash table.
 * The FIRST occurrence of each unique key is retained.
 *
 * @param {Array<Object>} trips  Raw trip records (may contain duplicates)
 * @returns {{ unique: Array<Object>, duplicateCount: number }}
 */
function deduplicate(trips) {
  // Plain object used as hash map — deliberately avoids Set per project rules
  const seen           = Object.create(null);
  const unique         = [];
  let   duplicateCount = 0;

  // O(n) forward pass
  for (let i = 0; i < trips.length; i++) {
    const key = buildTripKey(trips[i]);

    if (seen[key] === undefined) {
      // First encounter — mark as seen and keep the record
      seen[key] = 1;                        // O(1) insert
      unique[unique.length] = trips[i];     // O(1) append
    } else {
      // Duplicate — discard
      duplicateCount++;
    }
  }

  return { unique, duplicateCount };
}

module.exports = { deduplicate, buildTripKey };
