const { TableClient } = require("@azure/data-tables");

const TABLE_NAME = "downloads";

// Simple in-memory cache (5 min TTL)
let cache = { count: null, ts: 0 };
const CACHE_TTL = 5 * 60 * 1000;

function getTableClient() {
  const connStr = process.env.AZURE_STORAGE_CONNECTION_STRING;
  if (!connStr) return null;
  return TableClient.fromConnectionString(connStr, TABLE_NAME);
}

module.exports = async function (context, req) {
  const headers = {
    "Access-Control-Allow-Origin": "*",
    "Access-Control-Allow-Methods": "GET, OPTIONS",
    "Content-Type": "application/json",
  };

  if (req.method === "OPTIONS") {
    context.res = { status: 204, headers };
    return;
  }

  // Check cache
  if (cache.count !== null && Date.now() - cache.ts < CACHE_TTL) {
    context.res = {
      status: 200,
      headers,
      body: JSON.stringify({ total: cache.count }),
    };
    return;
  }

  let total = 0;

  // Count from Azure Table Storage
  const client = getTableClient();
  if (client) {
    try {
      let count = 0;
      const entities = client.listEntities({
        queryOptions: { filter: "PartitionKey eq 'download'" },
      });
      for await (const _ of entities) {
        count++;
      }
      total += count;
    } catch (err) {
      context.log.warn("Failed to count downloads:", err.message);
    }
  }

  cache = { count: total, ts: Date.now() };

  context.res = {
    status: 200,
    headers,
    body: JSON.stringify({ total }),
  };
};
