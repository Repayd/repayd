import { NextResponse } from "next/server";

export const maxDuration = 10;

export async function POST(request: Request) {
  const base = process.env.REPAYD_DASHBOARD_URL ?? "http://127.0.0.1:3000";
  try {
    const response = await fetch(`${base}/api/demo/run`, { method: "POST", headers: { "content-type": "application/json", ...(process.env.REPAYD_RUNNER_TOKEN ? { authorization: `Bearer ${process.env.REPAYD_RUNNER_TOKEN}` } : {}) }, body: await request.text(), signal: AbortSignal.timeout(8_000) });
    return NextResponse.json(await response.json(), { status: response.status });
  } catch {
    return NextResponse.json({ error: "Demo backend unavailable." }, { status: 502 });
  }
}
