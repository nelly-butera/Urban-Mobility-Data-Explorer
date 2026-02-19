'use strict';

require('dotenv').config();

const http = require('http');
const config = require('./config');
const db = require('./database');
const router = require('./routes/index');

// Helper to wait a few seconds
const sleep = (ms) => new Promise(resolve => setTimeout(resolve, ms));

async function start() {
    let connected = false;
    let attempts = 0;
    const maxAttempts = 5;

    console.log('Connecting to database...');

    // 1. RETRY LOOP: Handle the database "waking up"
    while (!connected && attempts < maxAttempts) {
        try {
            await db.query('SELECT 1');
            connected = true;
            console.log('Connected to PostgreSQL (Database is awake)');
        } catch (err) {
            attempts++;
            console.warn(`Database not ready. Retry ${attempts}/${maxAttempts} in 5s...`);
            await sleep(5000); // Wait 5 seconds before trying again
        }
    }

    if (!connected) {
        console.error('Could not connect to database after multiple attempts. Exiting.');
        process.exit(1);
    }

    try {
        // 2. Optional: Load data
        if (process.env.LOAD_DATA === 'true') {
            console.log('Starting data loader...');
            const { loadData } = require('./data_processing/dataLoader');
            await loadData();
        }

        // 3. Start Server
        const server = http.createServer(async (req, res) => {
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
        });

    } catch (err) {
        console.error('Failed to start server:', err);
        process.exit(1);
    }
}

start();