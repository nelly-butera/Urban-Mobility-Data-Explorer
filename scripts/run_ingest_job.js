/**
 * - Assignment asks separate ingest script.
 * - This just calls same pipeline classes.
 */
require("dotenv").config();

const { ReadSetup } = require("../src/setup_files/ReadSetup");
const { DbTasks } = require("../src/db_files/DbTasks");
const { RunPipelineStep } = require("../src/work_steps/RunPipelineStep");

async function runIngest() {
  const setup = ReadSetup.fromUserInput(process.argv.slice(2), process.env);
  const dbTasks = new DbTasks(setup.dbUrl);
  const pipeline = new RunPipelineStep(setup, dbTasks);
  const result = await pipeline.runAll();

  console.log("Ingest done.");
  console.log(JSON.stringify(result.counts, null, 2));
}

runIngest().catch((err) => {
  console.error("Ingest failed:");
  console.error(err.message);
  process.exitCode = 1;
});
