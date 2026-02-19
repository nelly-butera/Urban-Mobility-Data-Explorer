'use strict';

// This function adds new calculated data to a single taxi trip
function computeFeatures(trip) {
  // First we calculate how long the trip lasted in minutes
  const pickupMs  = new Date(trip.pickup_datetime).getTime();
  const dropoffMs = new Date(trip.dropoff_datetime).getTime();
  const durationMs = dropoffMs - pickupMs;

  // We divide by 60,000 to turn milliseconds into minutes and keep 2 decimal spots
  trip.trip_duration_minutes =
    isFinite(durationMs) && durationMs > 0
      ? parseFloat((durationMs / 60000).toFixed(2))
      : null;

  // Next we find the average speed in miles per hour
  const distanceMiles     = parseFloat(trip.trip_distance) || 0;
  const durationHours     = trip.trip_duration_minutes
    ? trip.trip_duration_minutes / 60 // Turn minutes into hours for the MPH math
    : null;

  // We only calculate speed if the taxi actually moved and time passed
  trip.average_speed_mph =
    durationHours && durationHours > 0 && distanceMiles > 0
      ? parseFloat((distanceMiles / durationHours).toFixed(2))
      : null;

  // Now we see how much money the driver makes every minute
  const totalAmount = parseFloat(trip.total_amount) || 0;

  trip.revenue_per_minute =
    trip.trip_duration_minutes && trip.trip_duration_minutes > 0
      ? parseFloat((totalAmount / trip.trip_duration_minutes).toFixed(4))
      : null;

  // Finally, we calculate what percentage the passenger tipped
  const tipAmount  = parseFloat(trip.tip_amount)  || 0;
  const fareAmount = parseFloat(trip.fare_amount) || 0;

  // We check if fare is above 0 so we don't accidentally divide by zero
  trip.tip_percentage =
    fareAmount > 0
      ? parseFloat(((tipAmount / fareAmount) * 100).toFixed(2))
      : null;

  return trip;
}

// This function takes a whole list of trips and runs the math on every single one
function computeFeaturesForAll(trips) {
  for (let i = 0; i < trips.length; i++) {
    computeFeatures(trips[i]);
  }
  return trips;
}

module.exports = { computeFeatures, computeFeaturesForAll };