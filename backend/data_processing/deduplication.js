'use strict';

// This function makes a long "ID" string by gluing trip details together with pipes
function buildTripKey(trip) {
  return [
    trip.vendor_id           ?? '',
    trip.pickup_datetime     ?? '',
    trip.dropoff_datetime    ?? '',
    trip.pu_location_id      ?? '',
    trip.do_location_id      ?? '',
    trip.total_amount        ?? '',
  ].join('|'); // The pipe symbol helps separate the values so they don't mush together
}

// This function goes through a list of trips and throws away the copies
function deduplicate(trips) {
  // We use this empty object to remember which trip "IDs" we have already seen
  const seen           = Object.create(null);
  const unique         = [];
  let   duplicateCount = 0;

  // Loop through every trip in the list one by one
  for (let i = 0; i < trips.length; i++) {
    // Get the unique "ID" for the current trip
    const key = buildTripKey(trips[i]);

    // If the ID isn't in our "seen" list yet, it's a new trip
    if (seen[key] === undefined) {
      // Add it to the "seen" list so we don't pick it up again
      seen[key] = 1; 
      // Put the trip into our final list of unique trips
      unique[unique.length] = trips[i];
    } else {
      // If we already saw this ID, it's a double, so we just count it and skip it
      duplicateCount++;
    }
  }

  // Send back the clean list and the count of how many copies we found
  return { unique, duplicateCount };
}

// Share these functions so the other files can use them
module.exports = { deduplicate, buildTripKey };