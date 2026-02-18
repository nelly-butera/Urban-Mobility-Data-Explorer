/**
 * - Start Express API server for dashboard.
 * - Use read-only endpoints.
 */
require("dotenv").config();

const express = require("express");
const cors = require("cors");
const helmet = require("helmet");
const rateLimit = require("express-rate-limit");
const { ReadSetup } = require("./setup_files/ReadSetup");
const { ReadApiFilters } = require("./api_helpers/ReadApiFilters");
const { MakeApiReply } = require("./api_helpers/MakeApiReply");
const { ReadAnalyticsData } = require("./api_helpers/ReadAnalyticsData");
const { TopZonePicker } = require("./work_steps/TopZonePicker");

const app = express();
const port = Number.parseInt(process.env.PORT || "3001", 10);
const filterReader = new ReadApiFilters();
const topPicker = new TopZonePicker();

let setup;
try {
  setup = ReadSetup.fromUserInput([], process.env);
} catch (err) {
  console.error(err.message);
  process.exit(1);
}

const analyticsDb = new ReadAnalyticsData(setup.dbUrl, filterReader);

// Security + frontend support middleware.
app.use(helmet());
app.use(cors({ origin: "*" }));
app.use(
  rateLimit({
    windowMs: 60 * 1000,
    max: 300,
    standardHeaders: true,
    legacyHeaders: false,
  })
);
app.use(express.json({ limit: "100kb" }));

function withFilters(handler) {
  return async (req, res, next) => {
    let filters;
    try {
      filters = filterReader.readFromQuery(req.query);
    } catch (err) {
      return res.status(400).json(MakeApiReply.ok({ error: err.message }, 0, 0));
    }

    try {
      await handler(req, res, filters);
    } catch (err) {
      next(err);
    }
  };
}

function readPositiveInt(value, fallback, max) {
  const n = Number.parseInt(String(value || ""), 10);
  if (!Number.isFinite(n) || n <= 0) {
    return fallback;
  }
  return Math.min(n, max);
}

// Overview endpoints
app.get("/api/overview/kpis", withFilters(async (_req, res, filters) => {
  const result = await analyticsDb.readOverviewKpis(filters);
  res.json(MakeApiReply.ok(result.data, result.total, result.filtered));
}));

app.get("/api/overview/trips-over-time", withFilters(async (_req, res, filters) => {
  const result = await analyticsDb.readTripsOverTime(filters);
  res.json(MakeApiReply.ok(result.data, result.total, result.filtered));
}));

app.get("/api/overview/trips-by-borough", withFilters(async (_req, res, filters) => {
  const result = await analyticsDb.readTripsByBorough(filters);
  res.json(MakeApiReply.ok(result.data, result.total, result.filtered));
}));

app.get("/api/overview/pickup-density", withFilters(async (_req, res, filters) => {
  const result = await analyticsDb.readPickupDensity(filters);
  res.json(MakeApiReply.ok(result.data, result.total, result.filtered));
}));

// Profitability endpoints
app.get("/api/profitability/top-zones", withFilters(async (req, res, filters) => {
  const limit = readPositiveInt(req.query.limit, 10, 100);
  const metric = String(req.query.sort_by || "revenue_per_minute");
  const rows = await analyticsDb.readProfitZoneRows(filters);
  const topRows = topPicker.pick(rows.data, metric, limit);
  res.json(MakeApiReply.ok(topRows, rows.total, topRows.length));
}));

app.get("/api/profitability/zone-map", withFilters(async (_req, res, filters) => {
  const result = await analyticsDb.readProfitZoneMap(filters);
  res.json(MakeApiReply.ok(result.data, result.total, result.filtered));
}));

app.get("/api/profitability/revenue-by-hour", withFilters(async (_req, res, filters) => {
  const result = await analyticsDb.readRevenueByHour(filters);
  res.json(MakeApiReply.ok(result.data, result.total, result.filtered));
}));

// Congestion endpoints
app.get("/api/congestion/zone-speeds", withFilters(async (_req, res, filters) => {
  const result = await analyticsDb.readZoneSpeeds(filters);
  res.json(MakeApiReply.ok(result.data, result.total, result.filtered));
}));

app.get("/api/congestion/speed-by-hour", withFilters(async (_req, res, filters) => {
  const result = await analyticsDb.readSpeedByHour(filters);
  res.json(MakeApiReply.ok(result.data, result.total, result.filtered));
}));

app.get("/api/congestion/speed-by-borough", withFilters(async (_req, res, filters) => {
  const result = await analyticsDb.readSpeedByBorough(filters);
  res.json(MakeApiReply.ok(result.data, result.total, result.filtered));
}));

// Flow endpoints
app.get("/api/flow/borough-matrix", withFilters(async (_req, res, filters) => {
  const result = await analyticsDb.readBoroughMatrix(filters);
  res.json(MakeApiReply.ok(result.data, result.total, result.filtered));
}));

app.get("/api/flow/top-routes", withFilters(async (req, res, filters) => {
  const limit = readPositiveInt(req.query.limit, 10, 100);
  const result = await analyticsDb.readTopRoutes(filters);

  // Reuse same custom top-k heap for route count ranking.
  const topRows = topPicker
    .pick(
      result.data.map((row) => ({ ...row, revenue_per_minute: Number(row.trip_count) })),
      "revenue_per_minute",
      limit
    )
    .map((row) => ({
      pickup_zone: row.pickup_zone,
      dropoff_zone: row.dropoff_zone,
      trip_count: row.trip_count,
      avg_fare: row.avg_fare,
    }));

  res.json(MakeApiReply.ok(topRows, result.total, topRows.length));
}));

// Anomaly endpoints
app.get("/api/anomalies/kpis", withFilters(async (_req, res, filters) => {
  const result = await analyticsDb.readAnomalyKpis(filters);
  res.json(MakeApiReply.ok(result.data, result.total, result.filtered));
}));

app.get("/api/anomalies/trips", withFilters(async (req, res, filters) => {
  const page = readPositiveInt(req.query.page, 1, 100000);
  const limit = readPositiveInt(req.query.limit, 20, 100);
  const result = await analyticsDb.readAnomalyTrips(filters, page, limit);
  res.json(MakeApiReply.ok(result.data, result.total, result.filtered));
}));

app.get("/api/anomalies/by-type", withFilters(async (_req, res, filters) => {
  const result = await analyticsDb.readAnomalyByType(filters);
  res.json(MakeApiReply.ok(result.data, result.total, result.filtered));
}));

// Tip endpoints
app.get("/api/tips/by-borough", withFilters(async (_req, res, filters) => {
  const result = await analyticsDb.readTipsByBorough(filters);
  res.json(MakeApiReply.ok(result.data, result.total, result.filtered));
}));

app.get("/api/tips/by-hour", withFilters(async (_req, res, filters) => {
  const result = await analyticsDb.readTipsByHour(filters);
  res.json(MakeApiReply.ok(result.data, result.total, result.filtered));
}));

app.get("/api/tips/cash-vs-card", withFilters(async (_req, res, filters) => {
  const result = await analyticsDb.readTipsCashVsCard(filters);
  res.json(MakeApiReply.ok(result.data, result.total, result.filtered));
}));

app.get("/api/tips/insight", withFilters(async (_req, res, filters) => {
  const result = await analyticsDb.readTipInsight(filters);
  res.json(MakeApiReply.ok(result.data, result.total, result.filtered));
}));

app.get("/health", (_req, res) => {
  res.json(MakeApiReply.ok({ status: "ok" }, 1, 1));
});

app.use((err, _req, res, _next) => {
  console.error(err);
  res.status(500).json(MakeApiReply.ok({ error: "Internal server error" }, 0, 0));
});

const server = app.listen(port, () => {
  console.log(`UrbanPulse NYC API running at http://localhost:${port}`);
});

async function stopServer() {
  server.close(async () => {
    await analyticsDb.closePool();
    process.exit(0);
  });
}

process.on("SIGINT", stopServer);
process.on("SIGTERM", stopServer);
