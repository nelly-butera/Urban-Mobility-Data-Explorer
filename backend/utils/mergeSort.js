'use strict';

/**
 * utils/mergeSort.js
 * Custom in-place merge sort implementation.
 *
 * Time Complexity:
 *   Best case:    O(n log n)
 *   Average case: O(n log n)
 *   Worst case:   O(n log n)
 * Space Complexity: O(n)  — auxiliary arrays for merge step
 *
 * NOTE: Array.prototype.sort() is deliberately NOT used, as per project requirements.
 */

/**
 * Merge two sorted sub-arrays [left..mid] and [mid+1..right] back into `arr`.
 * @param {Array}    arr        The array being sorted (mutated in-place)
 * @param {number}   left       Start index of left half
 * @param {number}   mid        End index of left half
 * @param {number}   right      End index of right half
 * @param {Function} compareFn  (a, b) => number  — negative: a before b
 */
function merge(arr, left, mid, right, compareFn) {
  const leftLen  = mid - left + 1;
  const rightLen = right - mid;

  // O(n) auxiliary space for each merge call
  const leftArr  = new Array(leftLen);
  const rightArr = new Array(rightLen);

  // Copy data into temporary arrays
  for (let i = 0; i < leftLen; i++)  leftArr[i]  = arr[left + i];
  for (let j = 0; j < rightLen; j++) rightArr[j] = arr[mid + 1 + j];

  let i = 0;      // index into leftArr
  let j = 0;      // index into rightArr
  let k = left;   // index into arr

  // Merge back in sorted order
  while (i < leftLen && j < rightLen) {
    if (compareFn(leftArr[i], rightArr[j]) <= 0) {
      arr[k++] = leftArr[i++];
    } else {
      arr[k++] = rightArr[j++];
    }
  }

  // Drain remaining elements
  while (i < leftLen)  arr[k++] = leftArr[i++];
  while (j < rightLen) arr[k++] = rightArr[j++];
}

/**
 * Recursive merge sort driver.
 * Divides the array into halves, sorts each, then merges.
 * O(log n) recursive depth, O(n) work per level → O(n log n) total.
 *
 * @param {Array}    arr       Array to sort (mutated in-place)
 * @param {number}   left      Start index
 * @param {number}   right     End index (inclusive)
 * @param {Function} compareFn (a, b) => number
 */
function mergeSortHelper(arr, left, right, compareFn) {
  if (left >= right) return; // base case: single element

  const mid = Math.floor((left + right) / 2); // O(1)

  mergeSortHelper(arr, left, mid, compareFn);         // sort left half
  mergeSortHelper(arr, mid + 1, right, compareFn);    // sort right half
  merge(arr, left, mid, right, compareFn);            // merge both halves
}

/**
 * Public API: sort an array using merge sort.
 *
 * @param {Array}    arr        Array to sort (mutated in-place)
 * @param {Function} [compareFn=defaultCompare]
 *   Optional comparator: (a, b) => number.
 *   Negative → a comes first; positive → b comes first; 0 → equal.
 * @returns {Array} The same (sorted) array reference
 *
 * @example
 * const trips = [{ fare: 10 }, { fare: 5 }, { fare: 8 }];
 * mergeSort(trips, (a, b) => a.fare - b.fare);
 * // trips is now sorted by fare ascending
 */
function mergeSort(arr, compareFn) {
  if (!Array.isArray(arr)) throw new TypeError('mergeSort: expected an Array');
  if (arr.length <= 1) return arr;

  const cmp = typeof compareFn === 'function' ? compareFn : defaultCompare;
  mergeSortHelper(arr, 0, arr.length - 1, cmp);
  return arr;
}

/**
 * Default comparator: natural ascending order for primitives.
 * @param {*} a
 * @param {*} b
 * @returns {number}
 */
function defaultCompare(a, b) {
  if (a < b) return -1;
  if (a > b) return  1;
  return 0;
}

module.exports = { mergeSort };
