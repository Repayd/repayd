import { NextResponse } from "next/server";

export const dynamic = "force-dynamic";
export const maxDuration = 10;

export async function GET(request: Request) {
  const base = process.env.REPAYD_DASHBOARD_URL ?? "http://127.0.0.1:3000";
  const runId = new URL(request.url).searchParams.get("runId");
  const query = runId ? `?runId=${encodeURIComponent(runId)}` : "";
  try {
    const response = await fetch(`${base}/api/demo/state${query}`, { cache: "no-store", headers: process.env.REPAYD_RUNNER_TOKEN ? { authorization: `Bearer ${process.env.REPAYD_RUNNER_TOKEN}` } : {}, signal: AbortSignal.timeout(8_000) });
    return NextResponse.json(await response.json(), { status: response.status });
  } catch {
    return NextResponse.json({ activeRunId: null, run: null, runs: [], error: "Demo backend unavailable." }, { status: 502 });
  }
}
