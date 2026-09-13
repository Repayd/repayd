import { NextResponse } from "next/server";

export const dynamic = "force-dynamic";

export async function GET(request: Request) {
  const base = process.env.REPAYD_DASHBOARD_URL ?? "http://127.0.0.1:3000";
  const runId = new URL(request.url).searchParams.get("runId");
  const query = runId ? `?runId=${encodeURIComponent(runId)}` : "";
  const headers: Record<string, string> = { accept: "text/event-stream" };
  if (process.env.REPAYD_RUNNER_TOKEN) headers.authorization = `Bearer ${process.env.REPAYD_RUNNER_TOKEN}`;
  try {
    const upstream = await fetch(`${base}/api/demo/stream${query}`, { headers, cache: "no-store" });
    if (!upstream.ok || !upstream.body) return NextResponse.json({ error: "Live stream unavailable." }, { status: 502 });
    return new Response(upstream.body, {
      headers: {
        "content-type": "text/event-stream",
        "cache-control": "no-store",
        connection: "keep-alive",
        "x-accel-buffering": "no",
      },
    });
  } catch {
    return NextResponse.json({ error: "Live stream unavailable." }, { status: 502 });
  }
}
