/**
 * File: src/work_steps/TopZonePicker.js
 * Why file exist:
 * - Use our custom heap to pick top zone rows.
 * - Metric can change by API query.
 */
const { TinyTopHeap } = require("../basic_ds/TinyTopHeap");

class TopZonePicker {
  pick(rows, metric, limit) {
    const metricKey = this.#getMetricKey(metric);
    const heap = new TinyTopHeap(limit, (row) => Number(row[metricKey]));

    for (const row of rows) {
      heap.add(row);
    }
    return heap.getHighToLow();
  }

  #getMetricKey(metric) {
    if (metric === "fare_per_mile") {
      return "fare_per_mile";
    }
    if (metric === "tip_percentage") {
      return "avg_tip_pct";
    }
    return "revenue_per_minute";
  }
}

module.exports = { TopZonePicker };
