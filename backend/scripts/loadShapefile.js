'use strict';

const path      = require('path');
const shapefile = require('shapefile');
const proj4     = require('proj4');
const db        = require('../database');
const config    = require('../config');

const EPSG2263 = '+proj=lcc +lat_1=41.03333333333333 +lat_2=40.66666666666667 ' +
                 '+lat_0=40.16666666666666 +lon_0=-74 +x_0=300000.0000000001 ' +
                 '+y_0=0 +ellps=GRS80 +datum=NAD83 +to_meter=0.3048006096012192 +no_defs';
const EPSG4326 = '+proj=longlat +datum=WGS84 +no_defs';

const KNOWN_DUPES = new Set([56, 103]);

function reprojectGeometry(geom) {
  function reprojectCoords(coords) {
    if (typeof coords[0] === 'number') {
      return proj4(EPSG2263, EPSG4326, coords);
    }
    const out = [];
    for (let i = 0; i < coords.length; i++) {
      out.push(reprojectCoords(coords[i]));
    }
    return out;
  }
  return { type: geom.type, coordinates: reprojectCoords(geom.coordinates) };
}

function toWKT(geom) {
  function ringToWKT(ring) {
    return '(' + ring.map(([x, y]) => `${x} ${y}`).join(', ') + ')';
  }
  if (geom.type === 'MultiPolygon') {
    return 'MULTIPOLYGON(' + geom.coordinates.map(
      poly => '(' + poly.map(ringToWKT).join(', ') + ')'
    ).join(', ') + ')';
  }
  if (geom.type === 'Polygon') {
    return 'POLYGON(' + geom.coordinates.map(ringToWKT).join(', ') + ')';
  }
  throw new Error(`Unsupported geometry type: ${geom.type}`);
}

function ensureMultiPolygon(geom) {
  if (geom.type === 'Polygon') {
    return { type: 'MultiPolygon', coordinates: [geom.coordinates] };
  }
  return geom;
}

async function loadShapefile() {
  const shpPath = path.resolve(config.data.shapefilePath);
  console.log(`[Shapefile] Reading: ${shpPath}`);

  // 1. Check if PostGIS is there
  try {
    await db.query("SELECT 1 FROM pg_extension WHERE extname = 'postgis'");
    console.log('[Shapefile] PostGIS: OK');
  } catch (e) {
    console.error('ERROR: PostGIS not found. Run: CREATE EXTENSION postgis;');
    process.exit(1);
  }

  // 2. Check if the table exists
  try {
    await db.query('SELECT 1 FROM zone_shapes LIMIT 1');
    console.log('[Shapefile] zone_shapes table: OK');
  } catch (e) {
    console.error('ERROR: zone_shapes table missing. Run your schema.sql file first.');
    process.exit(1);
  }

  const idCounts = Object.create(null);
  let rowCount = 0;
  let inserted = 0;

  const source = await shapefile.open(shpPath);

  // --- SPEED UP STARTS HERE ---
  console.log('[Shapefile] Starting bulk upload...');
  await db.query('BEGIN'); // Tell the DB to "hold its breath" and wait for all data
  
  try {
    while (true) {
      const result = await source.read();
      if (result.done) break;

      rowCount++;
      const feature = result.value;
      const props   = feature.properties || {};
      const locId   = parseInt(props.LocationID || props.location_id || props.OBJECTID, 10);
      
      // Reproject the map coordinates (math is fast, network is slow)
      const geomOrig = toWKT(ensureMultiPolygon(feature.geometry));
      const geomWeb  = toWKT(ensureMultiPolygon(reprojectGeometry(feature.geometry)));

      // This query is now part of a "Transaction"
      await db.query(`
        INSERT INTO zone_shapes (location_id, area, len, geom, geom_web, mappable)
        VALUES ($1, $2, $3, ST_GeomFromText($4, 2263), ST_GeomFromText($5, 4326), true)
      `, [locId, props.Shape_Area || 0, props.Shape_Leng || 0, geomOrig, geomWeb]);

      inserted++;
      if (inserted % 50 === 0) console.log(`[Shapefile] Progress: ${inserted} zones...`);
    }

    await db.query('COMMIT'); // Tell the DB: "Okay, save everything I just sent!"
    console.log(`\n[Shapefile] Success! Inserted ${inserted} zones.`);

  } catch (err) {
    await db.query('ROLLBACK'); // If something breaks, undo everything so we don't have partial data
    console.error('[Shapefile] Critical error during upload:', err.message);
  }
}

if (require.main === module) {
  loadShapefile()
    .then(() => db.end())
    .catch(err => { console.error('[Shapefile] Fatal error:', err); process.exit(1); });
}

module.exports = { loadShapefile };
