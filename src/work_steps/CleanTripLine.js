/**
 * File: src/work_steps/CleanTripLine.js
 * Why file exist:
 * - Convert one raw parquet row to our standard row format.
 * - Handle column name differences between TLC files.
 */
class CleanTripLine {
  makeCleanRow(rawRow, sourceFile, sourceRowNum) {
    return {
      sourceFile,
      sourceRowNum,
      vendorId: this.#readInt(this.#pickByName(rawRow, ["VendorID", "vendor_id"])),
      pickupTs: this.#readTime(
        this.#pickByName(rawRow, ["tpep_pickup_datetime", "pickup_datetime", "lpep_pickup_datetime"])
      ),
      dropoffTs: this.#readTime(
        this.#pickByName(rawRow, ["tpep_dropoff_datetime", "dropoff_datetime", "lpep_dropoff_datetime"])
      ),
      passengerCount: this.#readInt(this.#pickByName(rawRow, ["passenger_count"])),
      tripDistance: this.#readFloat(this.#pickByName(rawRow, ["trip_distance"])),
      ratecodeId: this.#readInt(this.#pickByName(rawRow, ["RatecodeID", "ratecodeid", "rate_code"])),
      storeAndFwdFlag: this.#readUpperText(this.#pickByName(rawRow, ["store_and_fwd_flag"])),
      puLocationId: this.#readInt(this.#pickByName(rawRow, ["PULocationID", "pulocationid"])),
      doLocationId: this.#readInt(this.#pickByName(rawRow, ["DOLocationID", "dolocationid"])),
      paymentType: this.#readInt(this.#pickByName(rawRow, ["payment_type"])),
      fareAmount: this.#readFloat(this.#pickByName(rawRow, ["fare_amount"])),
      extra: this.#readFloat(this.#pickByName(rawRow, ["extra"])),
      mtaTax: this.#readFloat(this.#pickByName(rawRow, ["mta_tax"])),
      tipAmount: this.#readFloat(this.#pickByName(rawRow, ["tip_amount"])),
      tollsAmount: this.#readFloat(this.#pickByName(rawRow, ["tolls_amount"])),
      improvementSurcharge: this.#readFloat(this.#pickByName(rawRow, ["improvement_surcharge"])),
      totalAmount: this.#readFloat(this.#pickByName(rawRow, ["total_amount"])),
      congestionSurcharge: this.#readFloat(this.#pickByName(rawRow, ["congestion_surcharge"])),
    };
  }

  #pickByName(row, possibleNames) {
    for (const wanted of possibleNames) {
      for (const key of Object.keys(row)) {
        if (key.toLowerCase() === wanted.toLowerCase()) {
          return row[key];
        }
      }
    }
    return null;
  }

  #readInt(value) {
    if (value === null || value === undefined || value === "") {
      return null;
    }
    const n = Number.parseInt(String(value).trim(), 10);
    return Number.isNaN(n) ? null : n;
  }

  #readFloat(value) {
    if (value === null || value === undefined || value === "") {
      return null;
    }
    const n = Number.parseFloat(String(value).trim());
    return Number.isFinite(n) ? n : null;
  }

  #readUpperText(value) {
    if (value === null || value === undefined) {
      return null;
    }
    const txt = String(value).trim().toUpperCase();
    return txt || null;
  }

  #readTime(value) {
    if (value === null || value === undefined || value === "") {
      return null;
    }

    // parquet library can return Date object directly.
    if (value instanceof Date && !Number.isNaN(value.getTime())) {
      return this.#formatUtcDate(value);
    }

    const raw = String(value).trim();
    const simple = raw.replace("T", " ");
    const match = simple.match(
      /^(\d{4})-(\d{2})-(\d{2})[ ](\d{2}):(\d{2}):(\d{2})/
    );
    if (match) {
      return `${match[1]}-${match[2]}-${match[3]} ${match[4]}:${match[5]}:${match[6]}`;
    }

    const d = new Date(raw);
    if (Number.isNaN(d.getTime())) {
      return null;
    }
    return this.#formatUtcDate(d);
  }

  #formatUtcDate(date) {
    const y = String(date.getUTCFullYear());
    const m = String(date.getUTCMonth() + 1).padStart(2, "0");
    const d = String(date.getUTCDate()).padStart(2, "0");
    const hh = String(date.getUTCHours()).padStart(2, "0");
    const mm = String(date.getUTCMinutes()).padStart(2, "0");
    const ss = String(date.getUTCSeconds()).padStart(2, "0");
    return `${y}-${m}-${d} ${hh}:${mm}:${ss}`;
  }
}

module.exports = { CleanTripLine };
