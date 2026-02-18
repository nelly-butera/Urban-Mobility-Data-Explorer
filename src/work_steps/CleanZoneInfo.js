/**
 * File: src/work_steps/CleanZoneInfo.js
 * Why file exist:
 * - Merge lookup CSV + DBF metadata.
 * - Find duplicates, missing geometry ids, and trim whitespace.
 */
const { DataIssueNote } = require("../small_models/DataIssueNote");

class CleanZoneInfo {
  fixData(lookupRows, dbfRows) {
    const notes = [];
    const idCountMap = new Map();
    const trimmedDbfRows = [];

    for (let i = 0; i < dbfRows.length; i += 1) {
      const raw = dbfRows[i];
      const trimmed = {};
      let changed = false;

      for (const [key, value] of Object.entries(raw)) {
        const next = typeof value === "string" ? value.trim() : value;
        trimmed[key] = next;
        if (next !== value) {
          changed = true;
        }
      }

      if (changed) {
        notes.push(
          new DataIssueNote(
            "taxi_zones.dbf",
            `row:${i + 1}`,
            "FIXED_WIDTH_PADDING",
            "trimmed",
            "Trimmed DBF fixed-width whitespace"
          )
        );
      }

      const idText = (trimmed.LocationID || "").trim();
      if (!/^\d+$/.test(idText)) {
        notes.push(
          new DataIssueNote(
            "taxi_zones.dbf",
            `row:${i + 1}`,
            "INVALID_LOCATION_ID",
            "excluded",
            `LocationID '${idText}' is not numeric`
          )
        );
      } else {
        const id = Number.parseInt(idText, 10);
        idCountMap.set(id, (idCountMap.get(id) || 0) + 1);
      }

      trimmedDbfRows.push(trimmed);
    }

    let duplicateRowsRemoved = 0;
    for (const [id, count] of idCountMap.entries()) {
      if (count > 1) {
        const removed = count - 1;
        duplicateRowsRemoved += removed;
        notes.push(
          new DataIssueNote(
            "taxi_zones.dbf",
            String(id),
            "DUPLICATE_SHAPE_METADATA",
            "excluded",
            `Removed ${removed} duplicate record(s), kept one`
          )
        );
      }
    }

    const lookupMap = new Map(lookupRows.map((r) => [r.locationId, r]));
    const dbfIdSet = new Set(idCountMap.keys());

    const missingGeometryIds = Array.from(lookupMap.keys())
      .filter((id) => !dbfIdSet.has(id))
      .sort((a, b) => a - b);

    for (const id of missingGeometryIds) {
      notes.push(
        new DataIssueNote(
          "taxi_zones.dbf",
          String(id),
          "MISSING_GEOMETRY",
          "retained_non_mappable",
          "Lookup id exists but no DBF geometry metadata"
        )
      );
    }

    const zoneRows = Array.from(lookupMap.values())
      .sort((a, b) => a.locationId - b.locationId)
      .map((lookup) => {
        const oneCount = idCountMap.get(lookup.locationId) || 0;
        return {
          locationId: lookup.locationId,
          borough: lookup.borough,
          zone: lookup.zone,
          serviceZone: lookup.serviceZone,
          hasGeometry: oneCount > 0,
          geometryRecordCount: oneCount,
          mapStatus: oneCount > 0 ? "mappable" : "missing_geometry",
        };
      });

    const summary = {
      lookupRowsRetained: lookupRows.length,
      dbfRowsInput: dbfRows.length,
      dbfUniqueLocationIds: dbfIdSet.size,
      dbfDuplicateRecordsRemoved: duplicateRowsRemoved,
      missingGeometryIds,
    };

    return { zoneRows, notes, summary };
  }
}

module.exports = { CleanZoneInfo };
