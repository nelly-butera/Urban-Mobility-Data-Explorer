'use strict';

/**
 * server.js
 * Entry point for the NYC Taxi Mobility Analytics Platform.
 * Creates a raw Node.js HTTP server (no Express) and wires up:
 *   - Request routing
 *   - Graceful shutdown
 *   - Optional data pipeline trigger on startup
 *
 * Start with:
 *   node server.js
 *   LOAD_DATA=true node server.js   # also run data pipeline on startup
 */

const http    = require('http');
const config  = require('./config');
const db      = require('./database');
const router  = require('./routes/index');

// ---------------------------------------------------------------------------
// Optional: load data pipeline on startup
// ---------------------------------------------------------------------------

async function maybeLoadData() {
  if (process.env.LOAD_DATA !== 'true') return;

  console.log('[Server] LOAD_DATA=true — running data pipeline...');
  try {
    const { loadData } = require('./data_processing/dataLoader');
    const summary = await loadData();
    console.log('[Server] Data pipeline finished:', summary);
  } catch (err) {
    console.error('[Server] Data pipeline failed:', err.message);
    // Non-fatal — server still starts
  }
}

// ---------------------------------------------------------------------------
// HTTP server creation
// ---------------------------------------------------------------------------

const server = http.createServer(async (req, res) => {
  const start = Date.now();

  // Delegate to central router
  await router.dispatch(req, res);

  // Access log
  const duration = Date.now() - start;
  console.log(`[${new Date().toISOString()}] ${req.method} ${req.url} — ${res.statusCode} (${duration}ms)`);
});

// ---------------------------------------------------------------------------
// Startup sequence
// ---------------------------------------------------------------------------

async function start() {
  try {
    // Verify DB connectivity before accepting traffic
    await db.query('SELECT 1');
    console.log('[Server] Database connection verified');

    // Run optional data pipeline
    await maybeLoadData();

    // Begin accepting connections
    server.listen(config.server.port, config.server.host, () => {
      console.log(
        `[Server] NYC Taxi Analytics API listening on ` +
        `http://${config.server.host}:${config.server.port}`
      );
      console.log('[Server] Available endpoints:');
      console.log('  GET /health');
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
    console.error('[Server] Failed to start:', err.message);
    process.exit(1);
  }
}

// ---------------------------------------------------------------------------
// Graceful shutdown
// ---------------------------------------------------------------------------

async function shutdown(signal) {
  console.log(`\n[Server] Received ${signal} — shutting down gracefully...`);

  // Stop accepting new connections
  server.close(async () => {
    console.log('[Server] HTTP server closed');
    // Close DB pool
    await db.end();
    console.log('[Server] Goodbye.');
    process.exit(0);
  });

  // Force exit after 10 seconds if graceful shutdown stalls
  setTimeout(() => {
    console.error('[Server] Forced shutdown after timeout');
    process.exit(1);
  }, 10_000);
}

process.on('SIGTERM', () => shutdown('SIGTERM'));
process.on('SIGINT',  () => shutdown('SIGINT'));

// Catch unhandled rejections so the process doesn't crash silently
process.on('unhandledRejection', (reason) => {
  console.error('[Server] Unhandled promise rejection:', reason);
});

// ---------------------------------------------------------------------------
// Go!
// ---------------------------------------------------------------------------
start();
