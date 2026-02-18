'use strict';

/**
 * config.js
 * Centralized configuration for the NYC Taxi Mobility Analytics Platform.
 * All environment-sensitive values are read from process.env with safe defaults.
 */

const config = {
  server: {
    port: parseInt(process.env.PORT, 10) || 3000,
    host: process.env.HOST || '0.0.0.0',
  },

  database: {
    host:     process.env.PG_HOST     || 'localhost',
    port:     parseInt(process.env.PG_PORT, 10) || 5432,
    database: process.env.PG_DATABASE || 'nyc_taxi',
    user:     process.env.PG_USER     || 'postgres',
    password: process.env.PG_PASSWORD || '',
    // Connection pool settings
    max:             parseInt(process.env.PG_POOL_MAX, 10) || 10,
    idleTimeoutMs:   parseInt(process.env.PG_IDLE_TIMEOUT, 10) || 30000,
    connectionTimeoutMs: parseInt(process.env.PG_CONN_TIMEOUT, 10) || 5000,
  },

  data: {
    // Path to pre-converted taxi trip JSON file
    tripsJsonPath:    process.env.TRIPS_JSON_PATH    || './data/taxi_trips.json',
    // Path to taxi zone lookup JSON file
    zonesJsonPath:    process.env.ZONES_JSON_PATH    || './data/taxi_zone_lookup.json',
  },

  anomaly: {
    maxSpeedMph:        80,    // trips exceeding this speed are anomalous
    maxTipPercentage:   100,   // tip_pct > 100% is anomalous
  },

  api: {
    // Default page size for list endpoints
    defaultLimit: parseInt(process.env.API_DEFAULT_LIMIT, 10) || 100,
    maxLimit:     parseInt(process.env.API_MAX_LIMIT, 10)     || 1000,
  },
};

module.exports = config;
