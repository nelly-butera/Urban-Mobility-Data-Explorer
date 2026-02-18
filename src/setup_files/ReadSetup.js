/**
 * - This file read setup values.
 * - Setup can come from CLI args or .env values.
 * - We keep this in one place so other files stay clean.
 */
const path = require("path");

class ReadSetup {
  constructor({ datasetsFolder, outputFolder, dbUrl, chunkSize }) {
    // Make full paths so script works same from any terminal folder.
    this.datasetsFolder = path.resolve(datasetsFolder);
    this.outputFolder = path.resolve(outputFolder);
    this.dbUrl = dbUrl;
    this.chunkSize = Number(chunkSize) || 1000;
  }

  static fromUserInput(argv, env) {
    const rawArgs = ReadSetup.#readArgPairs(argv);
    const datasetsFolder = rawArgs["datasets-dir"] || "datasets";
    const outputFolder = rawArgs["output-dir"] || "artifacts";
    const dbUrl = ReadSetup.#cleanDbUrl(rawArgs["database-url"] || env.DATABASE_URL || "");
    const chunkSize = rawArgs["batch-size"] || env.BATCH_SIZE || "1000";

    if (!dbUrl) {
      throw new Error("DATABASE_URL is missing. Please set env or pass --database-url.");
    }

    return new ReadSetup({
      datasetsFolder,
      outputFolder,
      dbUrl,
      chunkSize,
    });
  }

  static #readArgPairs(argv) {
    const out = {};
    for (let i = 0; i < argv.length; i += 1) {
      const one = argv[i];
      if (!one.startsWith("--")) {
        continue;
      }
      const key = one.slice(2);
      const next = argv[i + 1];
      if (!next || next.startsWith("--")) {
        out[key] = "true";
      } else {
        out[key] = next;
        i += 1;
      }
    }
    return out;
  }

  static #cleanDbUrl(rawUrl) {
    // Some students copy URL with single quote from docs.
    // We remove outside quote if it exists.
    const trimmed = String(rawUrl || "").trim();
    if (!trimmed) {
      return "";
    }
    if (
      (trimmed.startsWith("'") && trimmed.endsWith("'")) ||
      (trimmed.startsWith('"') && trimmed.endsWith('"'))
    ) {
      return trimmed.slice(1, -1);
    }
    return trimmed;
  }
}

module.exports = { ReadSetup };
