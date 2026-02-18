/**
 * File: src/work_steps/RunPipelineStep.js
 * Why file exist:
 * - Main pipeline flow.
 * - Read files, clean data, save data, write run summary.
 */
const fs = require("fs");
const path = require("path");
const { ReadZoneLookupCsv } = require("../read_files/ReadZoneLookupCsv");
const { ReadTaxiDbf } = require("../read_files/ReadTaxiDbf");
const { ReadTripParquet } = require("../read_files/ReadTripParquet");
const { CleanZoneInfo } = require("./CleanZoneInfo");
const { CleanTripLine } = require("./CleanTripLine");

class RunPipelineStep {
  constructor(setup, dbTasks) {
    this.setup = setup;
    this.dbTasks = dbTasks;
    this.tripCleaner = new CleanTripLine();
  }

  async runAll() {
    const lookupFile = path.join(this.setup.datasetsFolder, "taxi_zone_lookup.csv");
    const dbfFile = path.join(this.setup.datasetsFolder, "taxi_zones", "taxi_zones.dbf");

    if (!fs.existsSync(lookupFile)) {
      throw new Error(`Missing lookup file: ${lookupFile}`);
    }
    if (!fs.existsSync(dbfFile)) {
      throw new Error(`Missing DBF file: ${dbfFile}`);
    }

    const lookupReader = new ReadZoneLookupCsv(lookupFile);
    const dbfReader = new ReadTaxiDbf(dbfFile);
    const tripReader = new ReadTripParquet(this.setup.datasetsFolder);
    const zoneCleaner = new CleanZoneInfo();

    const lookupResult = lookupReader.readAndCheck();
    const dbfRows = dbfReader.readRows();
    const zoneResult = zoneCleaner.fixData(lookupResult.rows, dbfRows);

    await this.dbTasks.openDb();
    try {
      await this.dbTasks.runSchemaFile();
      await this.dbTasks.clearOldPipelineData();
      await this.dbTasks.saveZones(zoneResult.zoneRows);
      await this.dbTasks.makeBoroughTableFromZones();
      await this.dbTasks.saveIssueNotes([...lookupResult.notes, ...zoneResult.notes]);

      const parquetFiles = tripReader.findParquetFiles();
      if (!parquetFiles.length) {
        await this.dbTasks.saveNoParquetNote();
      } else {
        for (const oneFile of parquetFiles) {
          await this.#loadOneParquetFile(tripReader, oneFile);
        }
        await this.dbTasks.makeCleanTripsAndFlags();
      }

      const counts = await this.dbTasks.getRowCounts();
      await this.#writeRunSummary(parquetFiles, zoneResult.summary, counts);
      return { parquetFiles, zoneSummary: zoneResult.summary, counts };
    } finally {
      await this.dbTasks.closeDb();
    }
  }

  async #loadOneParquetFile(tripReader, oneFile) {
    const sourceFileName = path.basename(oneFile);
    const batch = [];
    let rowNum = 0;

    // Stream file rows to keep low memory usage.
    for await (const rawRow of tripReader.streamRows(oneFile)) {
      rowNum += 1;
      const cleanRow = this.tripCleaner.makeCleanRow(rawRow, sourceFileName, rowNum);
      batch.push(cleanRow);

      if (batch.length >= this.setup.chunkSize) {
        await this.dbTasks.saveTripStageBatch(batch);
        batch.length = 0;
      }
    }

    if (batch.length) {
      await this.dbTasks.saveTripStageBatch(batch);
    }
  }

  async #writeRunSummary(parquetFiles, zoneSummary, counts) {
    fs.mkdirSync(this.setup.outputFolder, { recursive: true });
    const payload = {
      runUtc: new Date().toISOString(),
      postgresTarget: true,
      parquetFiles: parquetFiles.map((p) => path.resolve(p)),
      tableCounts: counts,
      zoneCleaning: zoneSummary,
    };
    const outFile = path.join(this.setup.outputFolder, "pipeline_run_summary.json");
    fs.writeFileSync(outFile, JSON.stringify(payload, null, 2), "utf8");
  }
}

module.exports = { RunPipelineStep };
