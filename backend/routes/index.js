'use strict';

// importing the native url tool and our own logic folders
const url         = require('url');
const overview      = require('./overview');
const profitability = require('./profitability');
const tips          = require('./tips');
const anomalies     = require('./anomalies');
const { error, ok, setCorsHeaders, parseQuery } = require('../utils/httpHelpers');

// list of where to send the request based on how the url starts
const ROUTE_TABLE = [
  { prefix: '/api/overview',      handler: overview      },
  { prefix: '/api/profitability', handler: profitability },
  { prefix: '/api/tips',          handler: tips          },
  { prefix: '/api/anomalies',     handler: anomalies     },
];

// just a quick check to see if the server is actually alive
function handleHealth(req, res) {
  ok(res, { status: 'ok', timestamp: new Date().toISOString() });
}

// this is the main function that figures out where a request should go
async function dispatch(req, res) {
  // need these so the frontend can actually talk to us without errors
  setCorsHeaders(res);

  // browsers send this check first, so we just say "yeah we are good"
  if (req.method === 'OPTIONS') {
    res.writeHead(204);
    res.end();
    return;
  }

  // splitting the url apart to see the path and the search params
  const parsed   = url.parse(req.url, true);
  const pathname = parsed.pathname || '/';
  const query    = parseQuery(new URL(req.url, 'http://localhost'));

  // if they just want the health check, send it here
  if (pathname === '/health' || pathname === '/api/health') {
    return handleHealth(req, res);
  }

  // looping through our table to see if the url matches any of our prefixes
  for (let i = 0; i < ROUTE_TABLE.length; i++) {
    const { prefix, handler } = ROUTE_TABLE[i];

    if (pathname.startsWith(prefix)) {
      // cut off the start of the url to get the specific endpoint they want
      const subpath = pathname.slice(prefix.length) || '/';
      try {
        // try to run the logic for that specific route
        await handler.handle(req, res, subpath, query);
      } catch (err) {
        // if something breaks, log the mess and send a 500 error
        console.error('[router] something broke in the handler:', err.message);
        error(res, 500, 'internal server error');
      }
      return;
    }
  }

  // if we got here, the url doesn't exist in our table
  error(res, 404, `route not found: ${pathname}`);
}

module.exports = { dispatch };