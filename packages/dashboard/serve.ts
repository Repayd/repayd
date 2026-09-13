import { readFileSync } from "node:fs";
import { join, resolve } from "node:path";
import { ARC_CHAIN_ID } from "../demo/src/run-types.ts";
import { scanFlow, type FlowResult } from "./src/flow.ts";
import { RunError, RunManager } from "./src/run-manager.ts";

// `??` would keep an empty string, and Number("") is 0, which asks Bun for a
// random free port — the platform then routes to a port nothing is listening on.
const PORT = Number(process.env.REPAYD_DASH_PORT || 3000);
const HOST = process.env.REPAYD_DASH_HOST ?? "127.0.0.1";
const ALLOW_REMOTE = process.env.REPAYD_ALLOW_REMOTE === "1";
const RUNNER_TOKEN = process.env.REPAYD_RUNNER_TOKEN;
if (ALLOW_REMOTE && !RUNNER_TOKEN)
  throw new Error("REPAYD_RUNNER_TOKEN is required when remote dashboard access is enabled.");
const API = process.env.REPAYD_API_URL ?? "http://localhost:8787";
const ROOT = resolve(import.meta.dir, "../..");
const runs = new RunManager(ROOT);
const pages: Record<string, string> = {
  "/": "landing",
  "/index.html": "landing",
  "/app": "app",
  "/owner": "app",
  "/demo": "demo",
  "/theater": "demo",
  "/capital": "capital",
  "/record": "record",
  "/flow": "flow",
};
const headers = {
  "cache-control": "no-store",
  "x-content-type-options": "nosniff",
  "referrer-policy": "strict-origin-when-cross-origin",
};

const server = Bun.serve({
  port: PORT,
  hostname: HOST,
  idleTimeout: 255,
  async fetch(req): Promise<Response> {
    const url = new URL(req.url);
    // Funded testnet mutations stay loopback-only by default. Remote mode is
    // explicit and requires the server-only runner token below.
    if (
      !ALLOW_REMOTE &&
      !["localhost", "127.0.0.1", "[::1]"].includes(url.hostname)
    )
      return json(403, { error: "Use the local dashboard address." });
    if (
      ALLOW_REMOTE &&
      url.pathname.startsWith("/api/") &&
      req.headers.get("authorization") !== `Bearer ${RUNNER_TOKEN}`
    )
      return json(401, { error: "Remote dashboard API requires authorization." });
    try {
      if (req.method === "GET" && pages[url.pathname])
        return html(pages[url.pathname]!);
      if (req.method === "GET" && url.pathname === "/theatre")
        return Response.redirect(new URL("/theater", url), 302);
      if (req.method === "GET" && url.pathname.startsWith("/assets/")) {
        const name = url.pathname.slice("/assets/".length);
        if (
          !/^[a-zA-Z\d][a-zA-Z\d._-]*\.(?:css|js|svg|woff2?|ttf|png|ico)$/.test(
            name,
          )
        )
          return json(404, { error: "Asset not found." });
        const file = Bun.file(join(import.meta.dir, "src", name));
        if (!(await file.exists()))
          return json(404, { error: "Asset not found." });
        return new Response(file, { headers });
      }
      if (req.method === "GET" && url.pathname === "/api/health") {
        return json(200, {
          ok: true,
          service: "repayd-dashboard",
          chainId: ARC_CHAIN_ID,
          activeRunId: runs.state().activeRunId,
        });
      }
      if (req.method === "GET" && url.pathname === "/api/demo/state") {
        return json(
          200,
          runs.state(url.searchParams.get("runId") || undefined),
        );
      }
      if (req.method === "GET" && url.pathname === "/api/demo/stream") {
        const id = url.searchParams.get("runId") || undefined;
        runs.state(id); // Validate historical selection before starting SSE headers.
        return stream(req, id);
      }
      if (req.method === "POST" && url.pathname === "/api/demo/run") {
        await mutation(req, url);
        const run = runs.start();
        return json(202, { runId: run.id, run });
      }
      if (req.method === "POST" && url.pathname === "/api/demo/reset") {
        await mutation(req, url);
        return json(200, runs.reset());
      }
      if (req.method === "GET" && url.pathname === "/api/flow") {
        const state = runs.state(url.searchParams.get("runId") || undefined);
        if (!state.run) return json(200, emptyFlow());
        return json(200, await scanFlow(state.run));
      }
      if (req.method === "GET" && url.pathname === "/api/atlas/overview") {
        return await proxy("/v1/atlas/overview");
      }
      if (
        req.method === "GET" &&
        /^\/api\/platforms\/[a-zA-Z\d_-]+$/.test(url.pathname)
      ) {
        return await proxy(url.pathname.replace(/^\/api\//, "/v1/"));
      }
      // The legacy Circle endpoint may provision a wallet or spend when enabled.
      // It must never be called just because someone loaded/navigated a page.
      if (url.pathname === "/api/circle/agent-wallet") {
        if (req.method !== "POST")
          return json(405, {
            error:
              "Circle may create a wallet or send a configured test payment. Use the explicit integration action (POST).",
          });
        await mutation(req, url);
        return await proxy("/v1/circle/agent-wallet");
      }
      // The coverage API runs beside this process; expose it on the same public
      // port so a single deployment serves both surfaces.
      if (url.pathname.startsWith("/v1/")) {
        const upstream = await fetch(`${API}${url.pathname}${url.search}`, {
          method: req.method,
          headers: {
            "content-type":
              req.headers.get("content-type") ?? "application/json",
          },
          body: ["GET", "HEAD"].includes(req.method)
            ? undefined
            : await req.text(),
        });
        return new Response(upstream.body, {
          status: upstream.status,
          headers: {
            ...headers,
            "content-type": "application/json; charset=utf-8",
          },
        });
      }
      return json(404, { error: "Not found." });
    } catch (error) {
      if (error instanceof RunError)
        return json(error.status, {
          error: error.message,
          activeRunId: runs.state().activeRunId,
        });
      console.error(
        "Dashboard request failed:",
        error instanceof Error ? error.message : error,
      );
      return json(503, {
        error:
          error instanceof Error
            ? error.message
            : "Unable to read the requested state.",
      });
    }
  },
});

function html(page: string): Response {
  return new Response(
    readFileSync(join(import.meta.dir, "src", `${page}.html`), "utf8"),
    {
      headers: { ...headers, "content-type": "text/html; charset=utf-8" },
    },
  );
}
function json(status: number, body: unknown): Response {
  return new Response(JSON.stringify(body), {
    status,
    headers: { ...headers, "content-type": "application/json; charset=utf-8" },
  });
}
async function mutation(req: Request, url: URL): Promise<void> {
  if (
    ALLOW_REMOTE &&
    req.headers.get("authorization") !== `Bearer ${RUNNER_TOKEN}`
  )
    throw new RunError(401, "Remote demo control requires a valid runner token.");
  const origin = req.headers.get("origin");
  if (
    (origin && origin !== url.origin) ||
    req.headers.get("sec-fetch-site") === "cross-site"
  ) {
    throw new RunError(403, "Cross-site demo control is not allowed.");
  }
  if (
    !req.headers
      .get("content-type")
      ?.toLowerCase()
      .startsWith("application/json")
  ) {
    throw new RunError(415, "Send an application/json request.");
  }
  const body = await req.text();
  if (body.length > 4_096)
    throw new RunError(413, "Request body is too large.");
  try {
    const value = JSON.parse(body);
    if (!value || typeof value !== "object" || Array.isArray(value))
      throw new Error();
  } catch {
    throw new RunError(400, "Send a JSON object.");
  }
}
async function proxy(path: string): Promise<Response> {
  try {
    const res = await fetch(`${API}${path}`, {
      signal: AbortSignal.timeout(12_000),
    });
    return json(res.status, await res.json());
  } catch {
    return json(502, {
      error:
        "Coverage API is unavailable. Saved demo evidence remains available in Theater and Flow.",
    });
  }
}
function emptyFlow(): FlowResult {
  return {
    runId: null,
    chain: {
      id: String(ARC_CHAIN_ID),
      name: "Arc testnet",
      head: 0,
      rpc: "https://rpc.testnet.arc.io",
    },
    scanned: { fromBlock: 0, toBlock: 0, truncated: false },
    wallets: [],
    txs: [],
    message:
      "Run a demo in Theater or select a saved run to inspect its exact transactions.",
  };
}
function stream(req: Request, id?: string): Response {
  let dispose: () => void = () => {};
  const body = new ReadableStream<Uint8Array>({
    start(controller) {
      const encoder = new TextEncoder();
      let closed = false;
      let unsubscribe: () => void = () => {};
      let heartbeat: ReturnType<typeof setInterval> | undefined;
      dispose = () => {
        if (closed) return;
        closed = true;
        unsubscribe();
        clearInterval(heartbeat);
        req.signal.removeEventListener("abort", dispose);
        try {
          controller.close();
        } catch {
          /* canceled by browser */
        }
      };
      const send = (event: string, data: unknown) => {
        if (closed) return;
        try {
          if ((controller.desiredSize ?? 0) < -2) {
            dispose();
            return;
          }
          controller.enqueue(
            encoder.encode(
              `event: ${event}\ndata: ${JSON.stringify(data)}\n\n`,
            ),
          );
        } catch {
          dispose();
        }
      };
      unsubscribe = runs.subscribe(() => send("snapshot", runs.state(id)));
      heartbeat = setInterval(
        () =>
          send("heartbeat", {
            serverTime: Date.now(),
            activeRunId: runs.state().activeRunId,
          }),
        10_000,
      );
      heartbeat.unref();
      req.signal.addEventListener("abort", dispose, { once: true });
      send("snapshot", runs.state(id));
    },
    cancel() {
      dispose();
    },
  });
  return new Response(body, {
    headers: {
      ...headers,
      "content-type": "text/event-stream",
      connection: "keep-alive",
      "x-accel-buffering": "no",
    },
  });
}

let closing = false;
async function shutdown(): Promise<void> {
  if (closing) return;
  closing = true;
  await runs.close();
  await server.stop(true);
  process.exit(0);
}
process.on("SIGINT", () => {
  void shutdown();
});
process.on("SIGTERM", () => {
  void shutdown();
});
console.log(
  `REPAYD dashboard ready at http://localhost:${server.port} · Arc testnet · persistent run journal`,
);
