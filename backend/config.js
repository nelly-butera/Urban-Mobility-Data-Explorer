'use strict';

// this line is literally the only reason the app knows your secrets.
// sans ca, the .env file might as well not exist.
require('dotenv').config();

const config = {
  // settings for where the local server lives
  server: {
    port: parseInt(process.env.PORT,10) || 3000,
    host: process.env.NODE_ENV === 'production' ? '0.0.0.0' : localhost,
  },

  // this part is the brain for the database connection
  database: {
    // using the connection string from neon because life is too short for manual setup
    connectionString: process.env.DATABASE_URL,

    // backup settings in case the url decides to disappear
    host:     process.env.PG_HOST     || 'localhost',
    port:     process.env.PG_PORT     || 5432,
    database: process.env.PG_DATABASE || 'nyc_taxi',
    user:     process.env.PG_USER     || 'postgres',
    password: process.env.PG_PASSWORD || '',

    // pooling so we don't crash the database when traffic hits
    max: process.env.PG_POOL_MAX || 10,

    // neon is picky and requires ssl to work. 
    // it is basically a security requirement pour le cloud.
    ssl: process.env.DATABASE_URL ? { rejectUnauthorized: false } : false,
  },

  // telling the scripts exactly where the data is hiding
  data: {
    tripsCSVPath:  process.env.TRIPS_CSV_PATH  || './datasets/yellow_tripdata_2019-01.csv',
    zonesCSVPath:  process.env.ZONES_CSV_PATH  || './datasets/taxi_zone_lookup.csv',
    shapefilePath: process.env.SHAPEFILE_PATH || './datasets/taxi_zones/taxi_zones.shp',
  },

  // settings for catching data that looks fake (like a 200mph taxi)
  anomaly: {
    maxSpeedMph: 80,
    maxTipPercentage: 100, 
  },

  // limits for the api so we don't accidentally send 7 million rows at once
  api: {
    defaultLimit: process.env.API_DEFAULT_LIMIT || 100,
    maxLimit:     process.env.API_MAX_LIMIT     || 1000,
  },
};

// exporting this so the rest of the app can stay organized
module.exports = config;
