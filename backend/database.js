'use strict';

// grabbing the pool tool because opening a new connection for every trip is a nightmare
const { Pool } = require('pg');
const config = require('./config');

/**
 * we create a pool here. 
 * it is basically a stack of open lines to the database.
 * instead of dialing every time, we just grab a line that is already open.
 * c'est plus simple like that.
 */
const pool = new Pool({
  // using the neon url if we have it, otherwise fallback to the basics
  connectionString: config.database.connectionString,
  
  host: config.database.host,
  port: config.database.port,
  database: config.database.database,
  user: config.database.user,
  password: config.database.password,
  
  // neon needs ssl or it will ghost us
  ssl: config.database.ssl,
  
  // max connections so we don't accidentally ddos our own database
  max: config.database.max,
});

pool.on('connect', () => {
  console.log('db connected... enfin');
});

pool.on('error', (err) => {
  console.error('db unexpected error:', err.message);
});

/**
 * this is the main function for everything.
 * text is the sql command, params are the variables we want to plug in safely.
 */
async function query(text, params) {
  try {
    // sending the command and waiting for the data to come back
    const result = await pool.query(text, params);
    return result;
  } catch (err) {
    // if the sql is bad, we log it here so we don't spend hours wondering why it failed
    console.error('db query failed... quel dommage');
    console.error('sql command:', text);
    console.error('error message:', err.message);
    throw err;
  }
}

// for when we need a dedicated client, like for heavy transactions
async function getClient() {
  const client = await pool.connect();
  return client;
}

// closing the pool when the server shuts down
async function end() {
  await pool.end();
  console.log('db connection pool closed. finished.');
}

module.exports = { query, getClient, end };