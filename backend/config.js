// This line is THE MOST IMPORTANT. 
// It tells Node to actually look at your .env file and grab the secrets.
require('dotenv').config();

const config = {
  // Settings for the local server (where the website runs)
  server: {
    port: process.env.PORT || 3000,
    host: process.env.HOST || '0.0.0.0',
  },

  // This part handles the database connection
  database: {
    // We use the long "DATABASE_URL" from Neon because it's easier.
    connectionString: process.env.DATABASE_URL,

    // If for some reason the URL is missing, it tries these defaults:
    host:     process.env.PG_HOST     || 'localhost',
    port:     process.env.PG_PORT     || 5432,
    database: process.env.PG_DATABASE || 'nyc_taxi',
    user:     process.env.PG_USER     || 'postgres',
    password: process.env.PG_PASSWORD || '',

    // Connection pooling (prevents the DB from getting overwhelmed)
    max: process.env.PG_POOL_MAX || 10,

    // Neon (cloud DB) REQUIRES SSL to be on. 
    // This basically says: "If we're using a URL (Neon), turn on SSL."
    ssl: process.env.DATABASE_URL ? { rejectUnauthorized: false } : false,
  },

  // Where our data files are hiding on the computer
  data: {
    tripsCSVPath:  process.env.TRIPS_CSV_PATH  || './datasets/yellow_tripdata_2019-01.csv',
    zonesCSVPath:  process.env.ZONES_CSV_PATH  || './datasets/taxi_zone_lookup.csv',
    shapefilePath: process.env.SHAPEFILE_PATH || './datasets/taxi_zones/taxi_zones.shp',
  },

  // Rules for flagging weird data (like a taxi going 200mph)
  anomaly: {
    maxSpeedMph: 80,
    maxTipPercentage: 100, 
  },

  // Controls how much data we send to the frontend at once
  api: {
    defaultLimit: process.env.API_DEFAULT_LIMIT || 100,
    maxLimit:     process.env.API_MAX_LIMIT     || 1000,
  },
};

// Export this so our other files (like loadShapefile.js) can use it
module.exports = config;