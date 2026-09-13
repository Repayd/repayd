import { NextResponse } from "next/server";

export const dynamic = "force-dynamic";
export const maxDuration = 10;

export async function GET(_request: Request, context: { params: Promise<{ name: string }> }) {
  const { name } = await context.params;
  if (!/^[a-z0-9-]+$/.test(name)) return NextResponse.json({ error: "Invalid platform slug." }, { status: 400 });
  const base = process.env.REPAYD_API_URL ?? "http://127.0.0.1:8787";
  try {
    const response = await fetch(`${base}/v1/platforms/${encodeURIComponent(name)}`, { cache: "no-store", signal: AbortSignal.timeout(8_000) });
    return NextResponse.json(await response.json(), { status: response.status });
  } catch {
    return NextResponse.json({ error: "Platform API unavailable." }, { status: 502 });
  }
}
