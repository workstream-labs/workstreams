const { TableClient } = require("@azure/data-tables");

const REPO = "workstream-labs/workstreams";
const TABLE_NAME = "downloads";

function getTableClient() {
  const connStr = process.env.AZURE_STORAGE_CONNECTION_STRING;
  if (!connStr) return null;
  return TableClient.fromConnectionString(connStr, TABLE_NAME);
}

module.exports = async function (context, req) {
  // CORS
  const headers = {
    "Access-Control-Allow-Origin": "*",
    "Access-Control-Allow-Methods": "POST, OPTIONS",
    "Access-Control-Allow-Headers": "Content-Type",
    "Content-Type": "application/json",
  };

  if (req.method === "OPTIONS") {
    context.res = { status: 204, headers };
    return;
  }

  const body = req.body || {};
  const arch = body.architecture === "x64" ? "x64" : "arm64";

  // Log to Azure Table Storage
  const client = getTableClient();
  if (client) {
    try {
      await client.createEntity({
        partitionKey: "download",
        rowKey: `${Date.now()}-${Math.random().toString(36).slice(2, 8)}`,
        architecture: arch,
        userAgent: body.userAgent || "",
        ip:
          req.headers["x-forwarded-for"] ||
          req.headers["x-real-ip"] ||
          "",
        timestamp: body.timestamp || new Date().toISOString(),
      });

      // Increment the pre-aggregated counter so download-count can read
      // a single entity instead of iterating all rows.
      try {
        const counter = await client.getEntity("meta", "totalCount");
        await client.updateEntity(
          {
            partitionKey: "meta",
            rowKey: "totalCount",
            count: (counter.count || 0) + 1,
          },
          "Merge",
          { etag: counter.etag }
        );
      } catch (counterErr) {
        if (counterErr.statusCode === 404) {
          await client.createEntity({
            partitionKey: "meta",
            rowKey: "totalCount",
            count: 1,
          });
        }
        // Silently swallow conflicts — the counter is best-effort.
      }
    } catch (err) {
      context.log.warn("Failed to log download:", err.message);
    }
  }

  // Fetch latest release tag to build download URL
  let tag = "v0.2.8";
  try {
    const res = await fetch(
      `https://api.github.com/repos/${REPO}/releases/latest`
    );
    if (res.ok) {
      const data = await res.json();
      tag = data.tag_name || tag;
    }
  } catch {
    // use fallback
  }

  const downloadUrl = `https://github.com/${REPO}/releases/download/${tag}/Workstreams-darwin-${arch}.dmg`;

  context.res = {
    status: 200,
    headers,
    body: JSON.stringify({ downloadUrl, tag, architecture: arch }),
  };
};
