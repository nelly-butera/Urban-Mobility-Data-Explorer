/**
 * - Read taxi_zone_lookup.csv
 * - Check basic bad values
 * - Return clean rows + issue notes
 */
const fs = require("fs");
const { DataIssueNote } = require("../small_models/DataIssueNote");

class ReadZoneLookupCsv {
  constructor(filePath) {
    this.filePath = filePath;
  }

  readAndCheck() {
    const csvText = fs.readFileSync(this.filePath, "utf8");
    const allLines = csvText.split(/\r?\n/).filter((line) => line.trim().length > 0);
    if (allLines.length < 2) {
      return { rows: [], notes: [] };
    }

    const header = this.#splitCsvLine(allLines[0]);
    const rows = [];
    const notes = [];

    for (let i = 1; i < allLines.length; i += 1) {
      const lineValues = this.#splitCsvLine(allLines[i]);
      const raw = {};
      for (let j = 0; j < header.length; j += 1) {
        raw[header[j]] = lineValues[j] ?? "";
      }

      const lineNo = i + 1;
      const idText = (raw.LocationID || "").trim();
      const borough = (raw.Borough || "").trim();
      const zone = (raw.Zone || "").trim();
      const serviceZone = (raw.service_zone || "").trim();

      if (!/^\d+$/.test(idText)) {
        notes.push(
          new DataIssueNote(
            "taxi_zone_lookup.csv",
            `line:${lineNo}`,
            "INVALID_LOCATION_ID",
            "excluded",
            `LocationID '${idText}' is not numeric`
          )
        );
        continue;
      }

      if (!borough || !zone || !serviceZone) {
        notes.push(
          new DataIssueNote(
            "taxi_zone_lookup.csv",
            `line:${lineNo}`,
            "BLANK_TEXT_VALUE",
            "excluded",
            "One or more needed text columns are blank"
          )
        );
        continue;
      }

      rows.push({
        locationId: Number.parseInt(idText, 10),
        borough,
        zone,
        serviceZone,
      });
    }

    // Keep first row for same location id.
    const seenIds = new Set();
    const noDupRows = [];
    for (const row of rows) {
      if (seenIds.has(row.locationId)) {
        notes.push(
          new DataIssueNote(
            "taxi_zone_lookup.csv",
            String(row.locationId),
            "DUPLICATE_LOCATION_ID",
            "excluded",
            "Duplicate location id in lookup file, first row kept"
          )
        );
        continue;
      }
      seenIds.add(row.locationId);
      noDupRows.push(row);
    }

    return { rows: noDupRows, notes };
  }

  #splitCsvLine(line) {
    // We parse CSV by hand to support comma inside quoted text.
    const values = [];
    let part = "";
    let insideQuotes = false;

    for (let i = 0; i < line.length; i += 1) {
      const ch = line[i];
      const next = line[i + 1];

      if (ch === '"' && insideQuotes && next === '"') {
        part += '"';
        i += 1;
        continue;
      }
      if (ch === '"') {
        insideQuotes = !insideQuotes;
        continue;
      }
      if (ch === "," && !insideQuotes) {
        values.push(part);
        part = "";
        continue;
      }
      part += ch;
    }
    values.push(part);
    return values;
  }
}

module.exports = { ReadZoneLookupCsv };
