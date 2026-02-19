'use strict';

//  need the 'Pool' tool from the 'pg' (node-postgres) package
const { Pool } = require('pg');
const config = require('./config');

/**
 * create a "Pool" here. 
 * Think of it as a stack of open phone lines to your database.
 * Instead of dialing the database every time we want to say something,
 * we just grab an open line from the pool.
 */
const pool = new Pool({
  // If we have that long Neon URL, use it!
  connectionString: config.database.connectionString,
  
  // These are backup settings in case the URL isn't there
  host: config.database.host,
  port: config.database.port,
  database: config.database.database,
  user: config.database.user,
  password: config.database.password,
  
  // SSL is like 'https' for your database. Neon requires this.
  ssl: config.database.ssl,
  
  // Don't open more than X connections at once
  max: config.database.max,
});

pool.on('connect', () => {
  console.log('db connected to the database!');
});


pool.on('error', (err) => {
  console.error('db unexpected error:', err.message);
});

/**
 * dis is e main function you'll use.
 * 'text' is your SQL command (like SELECT * FROM...)
 * 'params' r e variables you want to safely plug into the SQL
 */
async function query(text, params) {
  try {
    // We send the command to the database and wait for it to finish
    const result = await pool.query(text, params);
    return result;
  } catch (err) {
    // If you wrote bad SQL, this is where it tells you why
    console.error('db query failed!');
    console.error('SQL command:', text);
    console.error('Error message:', err.message);
    throw err;
  }
}

async function getClient() {
  const client = await pool.connect();
  return client;
}


async function end() {
  await pool.end();
  console.log('db connection pool closed.');
}

module.exports = { query, getClient, end };