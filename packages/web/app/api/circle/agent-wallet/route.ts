import { NextResponse } from "next/server";

export const dynamic = "force-dynamic";
export const maxDuration = 10;

export async function POST() {
  const base = process.env.REPAYD_API_URL ?? "http://127.0.0.1:8787";
  try {
    const response = await fetch(`${base}/v1/circle/agent-wallet`, { method: "GET", cache: "no-store", signal: AbortSignal.timeout(9_000) });
    return NextResponse.json(await response.json(), { status: response.status });
  } catch {
    return NextResponse.json({ error: "Circle backend unavailable." }, { status: 502 });
  }
}
