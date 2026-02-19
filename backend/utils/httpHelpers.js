'use strict';

/**
 * utils/httpHelpers.js
 * Lightweight helpers for the raw Node.js http server:
 * sending JSON responses, parsing request bodies, routing URL matching, etc.
 */

/**
 * Send a JSON response.
 * @param {import('http').ServerResponse} res
 * @param {number} statusCode
 * @param {*}      data         Anything serialisable as JSON
 */
function sendJson(res, statusCode, data) {
  const body = JSON.stringify(data);
  res.writeHead(statusCode, {
    'Content-Type':  'application/json',
    'Content-Length': Buffer.byteLength(body),
    'X-Powered-By':  'NYC-Taxi-Analytics',
  });
  res.end(body);
}

/**
 * Send a 200 OK with a data envelope.
 * @param {import('http').ServerResponse} res
 * @param {*}      data
 * @param {Object} [meta]  Optional metadata (e.g. { total, page })
 */
function ok(res, data, meta = {}) {
  sendJson(res, 200, { success: true, data, meta });
}

/**
 * Send an error response.
 * @param {import('http').ServerResponse} res
 * @param {number} statusCode
 * @param {string} message
 * @param {*}      [details]
 */
function error(res, statusCode, message, details) {
  const body = { success: false, error: { message } };
  if (details !== undefined) body.error.details = details;
  sendJson(res, statusCode, body);
}

/**
 * Parse the JSON body from a request stream.
 * @param {import('http').IncomingMessage} req
 * @returns {Promise<Object>}
 */
function parseBody(req) {
  return new Promise((resolve, reject) => {
    const chunks = [];
    req.on('data', (chunk) => chunks[chunks.length] = chunk);
    req.on('end',  () => {
      try {
        const raw  = Buffer.concat(chunks).toString('utf8');
        resolve(raw ? JSON.parse(raw) : {});
      } catch (e) {
        reject(new Error('Invalid JSON body'));
      }
    });
    req.on('error', reject);
  });
}

/**
 * Parse query string parameters from a URL object.
 * @param {URL} urlObj
 * @returns {Object} key-value pairs (all strings)
 */
function parseQuery(urlObj) {
  const params = Object.create(null);
  urlObj.searchParams.forEach((value, key) => {
    params[key] = value;
  });
  return params;
}

/**
 * Match a pathname against a pattern that may contain named segments.
 * Segments starting with ':' are captured.
 *
 * @param {string} pattern  e.g. '/api/trips/:id'
 * @param {string} pathname e.g. '/api/trips/abc-123'
 * @returns {Object|null}   Named captures or null if no match
 *
 * @example
 * matchPath('/api/trips/:id', '/api/trips/42') // => { id: '42' }
 */
function matchPath(pattern, pathname) {
  const patternParts  = pattern.split('/');
  const pathnameParts = pathname.split('/');

  if (patternParts.length !== pathnameParts.length) return null;

  const captures = Object.create(null);
  for (let i = 0; i < patternParts.length; i++) {
    const part = patternParts[i];
    if (part.startsWith(':')) {
      captures[part.slice(1)] = decodeURIComponent(pathnameParts[i]);
    } else if (part !== pathnameParts[i]) {
      return null;
    }
  }
  return captures;
}

/**
 * Add CORS headers for local development / API consumers.
 * @param {import('http').ServerResponse} res
 */
function setCorsHeaders(res) {
  res.setHeader('Access-Control-Allow-Origin',  '*');
  res.setHeader('Access-Control-Allow-Methods', 'GET, POST, OPTIONS');
  res.setHeader('Access-Control-Allow-Headers', 'Content-Type, Authorization');
}

module.exports = { sendJson, ok, error, parseBody, parseQuery, matchPath, setCorsHeaders };
