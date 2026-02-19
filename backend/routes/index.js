'use strict';

/**
 * routes/index.js
 * Central router for the NYC Taxi Analytics API.
 * Dispatches requests to the appropriate route module based on URL prefix.
 *
 * Route namespaces:
 *   /api/overview/*     → routes/overview.js
 *   /api/profitability/*→ routes/profitability.js
 *   /api/tips/*         → routes/tips.js
 *   /api/anomalies/*    → routes/anomalies.js
 */

const url         = require('url');
const overview      = require('./overview');
const profitability = require('./profitability');
const tips          = require('./tips');
const anomalies     = require('./anomalies');
const { error, ok, setCorsHeaders, parseQuery } = require('../utils/httpHelpers');

// ---------------------------------------------------------------------------
// Route table: prefix → handler module
// ---------------------------------------------------------------------------
const ROUTE_TABLE = [
  { prefix: '/api/overview',      handler: overview      },
  { prefix: '/api/profitability', handler: profitability },
  { prefix: '/api/tips',          handler: tips          },
  { prefix: '/api/anomalies',     handler: anomalies     },
];

// ---------------------------------------------------------------------------
// Health check endpoint
// ---------------------------------------------------------------------------
function handleHealth(req, res) {
  ok(res, { status: 'ok', timestamp: new Date().toISOString() });
}

// ---------------------------------------------------------------------------
// Main request dispatcher
// ---------------------------------------------------------------------------

/**
 * Dispatch an incoming HTTP request to the correct route handler.
 * @param {import('http').IncomingMessage} req
 * @param {import('http').ServerResponse}  res
 */
async function dispatch(req, res) {
  // Always add CORS headers
  setCorsHeaders(res);

  // Handle pre-flight OPTIONS requests immediately
  if (req.method === 'OPTIONS') {
    res.writeHead(204);
    res.end();
    return;
  }

  // Parse the URL once
  const parsed   = url.parse(req.url, true);
  const pathname = parsed.pathname || '/';
  const query    = parseQuery(new URL(req.url, 'http://localhost'));

  // Health check
  if (pathname === '/health' || pathname === '/api/health') {
    return handleHealth(req, res);
  }

  // Walk route table — O(k) where k is the number of namespaces (small, constant)
  for (let i = 0; i < ROUTE_TABLE.length; i++) {
    const { prefix, handler } = ROUTE_TABLE[i];

    if (pathname.startsWith(prefix)) {
      // Compute sub-path relative to the prefix
      const subpath = pathname.slice(prefix.length) || '/';
      try {
        await handler.handle(req, res, subpath, query);
      } catch (err) {
        console.error('[Router] Unhandled error in handler:', err.message, err.stack);
        error(res, 500, 'Internal Server Error');
      }
      return;
    }
  }

  // No route matched
  error(res, 404, `Route not found: ${pathname}`);
}

module.exports = { dispatch };
