'use strict';

require('dotenv').config();
const http = require('http');
const config = require('./config');
const db = require('./database');
const router = require('./routes/index');

const sleep = (ms) => new Promise(resolve => setTimeout(resolve, ms));

async function start() {
    let connected = false;
    let attempts = 0;
    const maxAttempts = 5;

    console.log('connecting to database... loading');

    while (!connected && attempts < maxAttempts) {
        try {
            await db.query('SELECT 1');
            connected = true;
            console.log('connected to postgres. the db is awake now.');
        } catch (err) {
            attempts++;
            console.warn(`database not ready. retry ${attempts}/${maxAttempts} in 5s...`);
            await sleep(5000); 
        }
    }

    if (!connected) {
        console.error('database is still down. bibaye bibi. exiting.');
        process.exit(1);
    }

    try {
        if (process.env.LOAD_DATA === 'true') {
            console.log('starting data loader... wait a bit');
            const { loadData } = require('./data_processing/dataLoader');
            await loadData();
        }

        const server = http.createServer(async (req, res) => {
            console.log(`${req.method} ${req.url}`);
            try {
                await router.dispatch(req, res);
            } catch (err) {
                console.error('route error:', err);
                res.statusCode = 500;
                res.setHeader('Content-Type', 'application/json');
                res.end(JSON.stringify({ error: 'server error... quel dommage' }));
            }
        });

        // CRITICAL FIX: Listen on config.server.host (0.0.0.0) 
        // This allows Render's load balancer to find our app.
        server.listen(config.server.port, config.server.host, () => {
            console.log(`server is running at http://${config.server.host}:${config.server.port}`);
            console.log('Everything is looking nziza. Deployment successful.');
        });

    } catch (err) {
        console.error('failed to start server:', err);
        process.exit(1);
    }
}

start();