/**
 * - Read .dbf file with Node Buffer only.
 * - No GIS library needed for this metadata read.
 */
const fs = require("fs");

class ReadTaxiDbf {
  constructor(filePath) {
    this.filePath = filePath;
  }

  readRows() {
    const buf = fs.readFileSync(this.filePath);

    // DBF fixed header offsets.
    const totalRows = buf.readUInt32LE(4);
    const headerSize = buf.readUInt16LE(8);
    const oneRowSize = buf.readUInt16LE(10);
    const columnCount = Math.floor((headerSize - 33) / 32);

    const columns = [];
    let pointer = 32;
    for (let i = 0; i < columnCount; i += 1) {
      const colMeta = buf.subarray(pointer, pointer + 32);
      const zeroIndex = colMeta.indexOf(0x00);
      const colName = colMeta
        .subarray(0, zeroIndex >= 0 ? zeroIndex : 11)
        .toString("ascii")
        .trim();
      const colSize = colMeta[16];
      columns.push({ colName, colSize });
      pointer += 32;
    }

    const headerEnd = buf[pointer];
    if (headerEnd !== 0x0d) {
      throw new Error(`DBF header end byte is wrong: ${headerEnd}`);
    }
    pointer += 1;

    const rows = [];
    for (let rowNo = 0; rowNo < totalRows; rowNo += 1) {
      const rowStart = pointer + rowNo * oneRowSize;
      const deleteFlag = buf[rowStart];
      if (deleteFlag === 0x2a) {
        continue;
      }

      const one = {};
      let valuePos = rowStart + 1;
      for (const col of columns) {
        const txt = buf
          .subarray(valuePos, valuePos + col.colSize)
          .toString("latin1");
        one[col.colName] = txt;
        valuePos += col.colSize;
      }
      rows.push(one);
    }

    return rows;
  }
}

module.exports = { ReadTaxiDbf };
