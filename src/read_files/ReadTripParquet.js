/**
 * - Find all parquet files in data folder.
 * - Stream trip rows one by one (memory friendly).
 */
const fs = require("fs");
const path = require("path");
const parquet = require("parquetjs-lite");

class ReadTripParquet {
  constructor(rootFolder) {
    this.rootFolder = rootFolder;
  }

  findParquetFiles() {
    const out = [];
    this.#scanFolder(this.rootFolder, out);
    return out.sort((a, b) => a.localeCompare(b));
  }

  async *streamRows(filePath) {
    const fileReader = await parquet.ParquetReader.openFile(filePath);
    try {
      const cursor = fileReader.getCursor();
      let row;
      while ((row = await cursor.next())) {
        yield row;
      }
    } finally {
      await fileReader.close();
    }
  }

  #scanFolder(folderPath, out) {
    const entries = fs.readdirSync(folderPath, { withFileTypes: true });
    for (const entry of entries) {
      const full = path.join(folderPath, entry.name);
      if (entry.isDirectory()) {
        this.#scanFolder(full, out);
      } else if (entry.isFile() && entry.name.toLowerCase().endsWith(".parquet")) {
        out.push(full);
      }
    }
  }
}

module.exports = { ReadTripParquet };
