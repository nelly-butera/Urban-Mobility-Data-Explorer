'use strict';

/**
 * database.js
 * Thin wrapper around the `pg` connection pool.
 * Exposes query(), getClient(), and end() for graceful shutdown.
 */

const { Pool } = require('pg');
const config   = require('./config');

// ---------------------------------------------------------------------------
// Pool initialisation
// ---------------------------------------------------------------------------

const pool = new Pool({
  host:               config.database.host,
  port:               config.database.port,
  database:           config.database.database,
  user:               config.database.user,
  password:           config.database.password,
  max:                config.database.max,
  idleTimeoutMillis:  config.database.idleTimeoutMs,
  connectionTimeoutMillis: config.database.connectionTimeoutMs,
});

// Surface pool-level errors so the process doesn't crash silently
pool.on('error', (err) => {
  console.error('[DB] Unexpected pool error:', err.message);
});

// ---------------------------------------------------------------------------
// Public helpers
// ---------------------------------------------------------------------------

/**
 * Execute a parameterised query and return the pg Result object.
 * @param {string}  text   SQL string with $1 … $n placeholders
 * @param {Array}   params Parameter values
 * @returns {Promise<import('pg').QueryResult>}
 */
async function query(text, params) {
  const start = Date.now();
  try {
    const result = await pool.query(text, params);
    const duration = Date.now() - start;
    console.debug(`[DB] query executed in ${duration}ms | rows=${result.rowCount}`);
    return result;
  } catch (err) {
    console.error('[DB] Query error:', err.message, '\nSQL:', text);
    throw err;
  }
}

/**
 * Acquire a dedicated client from the pool (for transactions).
 * Callers MUST call client.release() when done.
 * @returns {Promise<import('pg').PoolClient>}
 */
async function getClient() {
  const client = await pool.connect();
  // Monkey-patch release to log long-held clients
  const originalRelease = client.release.bind(client);
  const acquired = Date.now();
  client.release = () => {
    const held = Date.now() - acquired;
    if (held > 5000) {
      console.warn(`[DB] Client held for ${held}ms — potential connection leak`);
    }
    originalRelease();
  };
  return client;
}

/**
 * Gracefully close the pool (call on process exit).
 */
async function end() {
  await pool.end();
  console.log('[DB] Connection pool closed');
}

module.exports = { query, getClient, end };
