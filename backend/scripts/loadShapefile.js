'use strict';

// this file reads the official nyc map files (shapefiles) and puts them in our database.
// it also does a bunch of math to turn local ny map coordinates into regular lat/long 
// so the zones actually show up in the right spot on a web map instead of the ocean.

const path      = require('path');
const shapefile = require('shapefile');
const proj4     = require('proj4');
const db        = require('../database');
const config    = require('../config');

// these long strings are just math settings to convert map coordinates 
// from ny state specific numbers to regular lat/long that google maps uses
const EPSG2263 = '+proj=lcc +lat_1=41.03333333333333 +lat_2=40.66666666666667 ' +
                 '+lat_0=40.16666666666666 +lon_0=-74 +x_0=300000.0000000001 ' +
                 '+y_0=0 +ellps=GRS80 +datum=NAD83 +to_meter=0.3048006096012192 +no_defs';
const EPSG4326 = '+proj=longlat +datum=WGS84 +no_defs';

const KNOWN_DUPES = new Set([56, 103]);

// this function does the actual math to shift the map points
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

// database needs the shapes as a specific string format (wkt)
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
  throw new Error(`unsupported geometry type: ${geom.type}`);
}

// making sure all shapes are multipolygons so the database doesn't complain
function ensureMultiPolygon(geom) {
  if (geom.type === 'Polygon') {
    return { type: 'MultiPolygon', coordinates: [geom.coordinates] };
  }
  return geom;
}

async function loadShapefile() {
  const shpPath = path.resolve(config.data.shapefilePath);
  console.log(`[shapefile] reading: ${shpPath}`);

  // 1. check if postgis is installed in the database
  try {
    await db.query("SELECT 1 FROM pg_extension WHERE extname = 'postgis'");
    console.log('[shapefile] postgis: ok');
  } catch (e) {
    console.error('error: postgis not found. run: create extension postgis;');
    process.exit(1);
  }

  // 2. check if the table actually exists
  try {
    await db.query('SELECT 1 FROM zone_shapes LIMIT 1');
    console.log('[shapefile] zone_shapes table: ok');
  } catch (e) {
    console.error('error: zone_shapes table missing. run your schema.sql file first.');
    process.exit(1);
  }

  const idCounts = Object.create(null);
  let rowCount = 0;
  let inserted = 0;

  const source = await shapefile.open(shpPath);

  // starting a transaction so it uploads way faster
  console.log('[shapefile] starting bulk upload...');
  await db.query('BEGIN'); 
  
  try {
    while (true) {
      const result = await source.read();
      if (result.done) break;

      rowCount++;
      const feature = result.value;
      const props   = feature.properties || {};
      const locId   = parseInt(props.LocationID || props.location_id || props.OBJECTID, 10);
      
      // converting the shapes twice: once for original map data, once for web view
      const geomOrig = toWKT(ensureMultiPolygon(feature.geometry));
      const geomWeb  = toWKT(ensureMultiPolygon(reprojectGeometry(feature.geometry)));

      // sticking the shapes into the table
      await db.query(`
        INSERT INTO zone_shapes (location_id, area, len, geom, geom_web, mappable)
        VALUES ($1, $2, $3, ST_GeomFromText($4, 2263), ST_GeomFromText($5, 4326), true)
      `, [locId, props.Shape_Area || 0, props.Shape_Leng || 0, geomOrig, geomWeb]);

      inserted++;
      if (inserted % 50 === 0) console.log(`[shapefile] progress: ${inserted} zones...`);
    }

    // save everything at once
    await db.query('COMMIT'); 
    console.log(`\n[shapefile] success! inserted ${inserted} zones.`);

  } catch (err) {
    // if it fails, undo it all so we don't have half-uploaded maps
    await db.query('ROLLBACK'); 
    console.error('[shapefile] critical error during upload:', err.message);
  }
}

// script entry point
if (require.main === module) {
  loadShapefile()
    .then(() => db.end())
    .catch(err => { console.error('[shapefile] fatal error:', err); process.exit(1); });
}

module.exports = { loadShapefile };