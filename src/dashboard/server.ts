import { loadState } from "../core/state";
import { EventBus } from "../core/events";
import type { WorkstreamEvent } from "../core/types";

const INDEX_HTML_PATH = new URL("public/index.html", import.meta.url).pathname;

export function createDashboardServer(eventBus: EventBus, port = 7890) {
  const sseClients = new Set<ReadableStreamDefaultController>();

  const server = Bun.serve({
    port,
    async fetch(req) {
      const url = new URL(req.url);

      // Serve index.html
      if (url.pathname === "/" || url.pathname === "/index.html") {
        const file = Bun.file(INDEX_HTML_PATH);
        return new Response(file, {
          headers: { "Content-Type": "text/html" },
        });
      }

      // API: current state
      if (url.pathname === "/api/state") {
        const state = await loadState();
        return Response.json(state);
      }

      // API: SSE events
      if (url.pathname === "/api/events") {
        const stream = new ReadableStream({
          start(controller) {
            sseClients.add(controller);

            // Replay buffered events
            for (const event of eventBus.replay()) {
              const data = `data: ${JSON.stringify(event)}\n\n`;
              controller.enqueue(new TextEncoder().encode(data));
            }
          },
          cancel(controller) {
            sseClients.delete(controller);
          },
        });

        return new Response(stream, {
          headers: {
            "Content-Type": "text/event-stream",
            "Cache-Control": "no-cache",
            Connection: "keep-alive",
            "Access-Control-Allow-Origin": "*",
          },
        });
      }

      // API: log file for a workstream
      if (url.pathname.startsWith("/api/log/")) {
        const name = url.pathname.slice("/api/log/".length);
        const logPath = `.workstreams/logs/${name}.log`;
        const file = Bun.file(logPath);
        if (!(await file.exists())) {
          return new Response("Not found", { status: 404 });
        }
        return new Response(file, {
          headers: { "Content-Type": "text/plain" },
        });
      }

      return new Response("Not found", { status: 404 });
    },
  });

  // Forward events to SSE clients
  eventBus.on("*", (event: WorkstreamEvent) => {
    const data = `data: ${JSON.stringify(event)}\n\n`;
    const encoded = new TextEncoder().encode(data);
    for (const client of sseClients) {
      try {
        client.enqueue(encoded);
      } catch {
        sseClients.delete(client);
      }
    }
  });

  return server;
}
