import { NextResponse } from "next/server";

export const dynamic = "force-dynamic";
export const maxDuration = 10;

export async function GET() {
  const base = process.env.REPAYD_DASHBOARD_URL ?? "http://127.0.0.1:3000";
  try {
    const response = await fetch(`${base}/api/demo/state`, { cache: "no-store", signal: AbortSignal.timeout(8_000) });
    return NextResponse.json(await response.json(), { status: response.status });
  } catch {
    return NextResponse.json({ activeRunId: null, run: null, runs: [], error: "Demo backend unavailable." }, { status: 502 });
  }
}
