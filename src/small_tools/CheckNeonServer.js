/**
 * - Fast check that DB URL can connect.
 * - Makes tiny HTTP page with SELECT version().
 */
require("dotenv").config();

const http = require("http");
const { neon } = require("@neondatabase/serverless");

if (!process.env.DATABASE_URL) {
  throw new Error("Missing DATABASE_URL in .env");
}

const sql = neon(process.env.DATABASE_URL);
const port = Number.parseInt(process.env.PORT || "3000", 10);

const serverHandler = async (_req, res) => {
  try {
    const result = await sql`SELECT version()`;
    const dbVersion = result[0]?.version || "unknown";
    res.writeHead(200, { "Content-Type": "text/plain" });
    res.end(dbVersion);
  } catch (err) {
    res.writeHead(500, { "Content-Type": "text/plain" });
    res.end(`DB connect failed: ${err.message}`);
  }
};

http.createServer(serverHandler).listen(port, () => {
  console.log(`Neon check running on http://localhost:${port}`);
});
