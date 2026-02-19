'use strict';

/**
 * utils/groupBy.js
 * Custom groupBy using plain object hashing.
 *
 * Time Complexity:
 *   O(n) — single pass through the array; hash map insertions/lookups are O(1) average.
 * Space Complexity:
 *   O(n) — each element is stored exactly once in one of the groups.
 *
 * NOTE: Array.prototype.reduce() and external libraries are deliberately NOT used,
 * as per project requirements.
 */

/**
 * Group an array of objects by the value returned by `keyFn`.
 *
 * @param {Array}    arr    Input array
 * @param {Function} keyFn  (element) => string | number — produces the group key
 * @returns {Object}  Plain object whose keys are group labels and values are arrays
 *                    of elements belonging to that group.
 *
 * @example
 * const trips = [
 *   { borough: 'Manhattan', fare: 10 },
 *   { borough: 'Brooklyn',  fare: 8  },
 *   { borough: 'Manhattan', fare: 15 },
 * ];
 * const grouped = groupBy(trips, t => t.borough);
 * // { Manhattan: [...], Brooklyn: [...] }
 */
function groupBy(arr, keyFn) {
  if (!Array.isArray(arr)) throw new TypeError('groupBy: expected an Array');
  if (typeof keyFn !== 'function') throw new TypeError('groupBy: keyFn must be a function');

  // Plain object used as a hash map — O(n) time, O(n) space
  const groups = Object.create(null); // no prototype pollution

  // Single forward pass — O(n)
  for (let i = 0; i < arr.length; i++) {
    const key = String(keyFn(arr[i])); // coerce to string for safe property access

    // O(1) average lookup / insert
    if (groups[key] === undefined) {
      groups[key] = [];
    }
    groups[key][groups[key].length] = arr[i]; // avoid push (minor perf, explicit intent)
  }

  return groups;
}

/**
 * Aggregate grouped data into summary statistics without reduce().
 * Each group becomes { count, sum, min, max, avg } for a numeric field.
 *
 * Time Complexity: O(n)
 *
 * @param {Object} grouped     Result of groupBy()
 * @param {string} numericKey  Field name to aggregate
 * @returns {Object} Keyed by group, valued with { count, sum, min, max, avg }
 */
function aggregateGroups(grouped, numericKey) {
  const result = Object.create(null);
  const keys   = Object.keys(grouped);

  for (let i = 0; i < keys.length; i++) {
    const groupKey = keys[i];
    const items    = grouped[groupKey];

    let count = 0;
    let sum   = 0;
    let min   = Infinity;
    let max   = -Infinity;

    // Inner loop — still O(n) total across all groups
    for (let j = 0; j < items.length; j++) {
      const val = parseFloat(items[j][numericKey]);
      if (isNaN(val)) continue;

      count++;
      sum += val;
      if (val < min) min = val;
      if (val > max) max = val;
    }

    result[groupKey] = {
      count,
      sum:   parseFloat(sum.toFixed(4)),
      min:   min === Infinity  ? null : parseFloat(min.toFixed(4)),
      max:   max === -Infinity ? null : parseFloat(max.toFixed(4)),
      avg:   count > 0 ? parseFloat((sum / count).toFixed(4)) : null,
    };
  }

  return result;
}

module.exports = { groupBy, aggregateGroups };
