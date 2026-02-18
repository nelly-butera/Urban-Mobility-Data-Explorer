/**
 * - Main command for pipeline run.
 */
require("dotenv").config();

const { ReadSetup } = require("./setup_files/ReadSetup");
const { DbTasks } = require("./db_files/DbTasks");
const { RunPipelineStep } = require("./work_steps/RunPipelineStep");

async function runMain() {
  const setup = ReadSetup.fromUserInput(process.argv.slice(2), process.env);
  const dbTasks = new DbTasks(setup.dbUrl);
  const runPipeline = new RunPipelineStep(setup, dbTasks);

  const result = await runPipeline.runAll();
  console.log("Pipeline done.");
  console.log(`Parquet files: ${result.parquetFiles.length}`);
  console.log(`Zones: ${result.counts.zones}`);
  console.log(`Trips cleaned: ${result.counts.trips_cleaned}`);
  console.log(`Flagged trips: ${result.counts.flagged_trips}`);
}

runMain().catch((err) => {
  console.error("Pipeline failed:");
  console.error(err.message);
  process.exitCode = 1;
});
