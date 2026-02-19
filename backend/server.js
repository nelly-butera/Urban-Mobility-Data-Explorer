'use strict';

require('dotenv').config();

const http = require('http');
const config = require('./config');
const db = require('./database');
const router = require('./routes/index');

// helper to wait a few seconds so we don't overwhelm the server
const sleep = (ms) => new Promise(resolve => setTimeout(resolve, ms));

async function start() {
    let connected = false;
    let attempts = 0;
    const maxAttempts = 5;

    console.log('connecting to database... loading');

    // 1. retry loop: handle the database waking up
    // neon sleeps sometimes, so we have to wait for it to wake up
    while (!connected && attempts < maxAttempts) {
        try {
            await db.query('SELECT 1');
            connected = true;
            console.log('connected to postgres. the db is awake now.');
        } catch (err) {
            attempts++;
            // if it fails, we wait 5s and try again
            console.warn(`database not ready. retry ${attempts}/${maxAttempts} in 5s...`);
            await sleep(5000); 
        }
    }

    if (!connected) {
        console.error('database is still down after 5 tries. bibaye bibi. exiting.');
        process.exit(1);
    }

    try {
        // 2. optional: load data if the flag is set
        if (process.env.LOAD_DATA === 'true') {
            console.log('starting data loader... wait a bit');
            const { loadData } = require('./data_processing/dataLoader');
            await loadData();
        }

        // 3. start server
        // this is the main logic pour le serveur
        const server = http.createServer(async (req, res) => {
            console.log(`${req.method} ${req.url}`);
            try {
                await router.dispatch(req, res);
            } catch (err) {
                console.error('route error:', err);
                res.statusCode = 500;
                res.end(JSON.stringify({ error: 'server error... quel dommage' }));
            }
        });

        server.listen(config.server.port, config.server.host, () => {
            console.log(`server is running. check it out at http://${config.server.host}:${config.server.port}`);
            console.log('everything is looking nziza.');
        });

    } catch (err) {
        console.error('failed to start server:', err);
        process.exit(1);
    }
}

// launch the whole thing
start();