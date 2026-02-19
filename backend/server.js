'use strict';

require('dotenv').config();

const http = require('http');
const config = require('./config');
const db = require('./database');
const router = require('./routes/index');

async function start() {
  try {
    // db check
    await db.query('SELECT 1');
    console.log('Connected to PostgreSQL');

    // Check if we need to load data on start
    if (process.env.LOAD_DATA === 'true') {
      console.log('Starting data loader...');
      const { loadData } = require('./data_processing/dataLoader');
      await loadData();
    }

    const server = http.createServer(async (req, res) => {
      // Simple request logger
      console.log(`${req.method} ${req.url}`);

      try {
        await router.dispatch(req, res);
      } catch (err) {
        console.error('Route Error:', err);
        res.statusCode = 500;
        res.end(JSON.stringify({ error: 'Server Error' }));
      }
    });

    server.listen(config.server.port, config.server.host, () => {
      console.log(`Server running at http://${config.server.host}:${config.server.port}`);
      console.log(' Endpoints You Can Test Out:');
      console.log('  GET /api/overview/kpis');
      console.log('  GET /api/overview/trips-over-time');
      console.log('  GET /api/overview/top-zones');
      console.log('  GET /api/profitability/top-zones');
      console.log('  GET /api/profitability/by-borough');
      console.log('  GET /api/profitability/by-hour');
      console.log('  GET /api/tips/by-borough');
      console.log('  GET /api/tips/by-hour');
      console.log('  GET /api/tips/payment-comparison');
      console.log('  GET /api/anomalies/summary');
      console.log('  GET /api/anomalies/list');
    });

  } catch (err) {
    console.error('Failed to start server:', err);
    process.exit(1);
  }
}

start();
