import { NextResponse } from "next/server";

export const dynamic = "force-dynamic";
export const maxDuration = 10;

export async function GET() {
  const base = process.env.REPAYD_API_URL ?? process.env.REPAYD_DASHBOARD_URL ?? "http://127.0.0.1:8787";
  try {
    const response = await fetch(`${base}/v1/atlas/overview`, { cache: "no-store", signal: AbortSignal.timeout(8_000) });
    return NextResponse.json(await response.json(), { status: response.status });
  } catch {
    return NextResponse.json({ error: "Live overview backend unavailable." }, { status: 502 });
  }
}
