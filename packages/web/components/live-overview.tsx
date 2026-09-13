"use client";
import { useEffect, useState } from "react";
import { Pill } from "./site-shell";

type Overview = { guard?: { usdc?: string; nextHoldId?: string }; pool?: { junior?: string; senior?: string }; payout?: { amaraUsdc?: string }; agent?: { erc8004AgentId?: number } };
const money = (value?: string) => value ? (Number(value) / 1_000_000).toLocaleString("en-US", { maximumFractionDigits: 0 }) : "—";

export function LiveOverview() {
  const [data, setData] = useState<Overview | null>(null);
  const [state, setState] = useState("Reading live deployment…");
  useEffect(() => { fetch("/api/overview", { cache: "no-store" }).then((r) => r.ok ? r.json() : Promise.reject()).then((value) => { setData(value); setState("Live Arc testnet read"); }).catch(() => setState("Live read unavailable")); }, []);
  return <section className="live-box"><div className="section-head"><div><p className="eyebrow">LIVE DEPLOYMENT</p><h2>One protected account. Clear boundaries.</h2></div><Pill tone={data ? "positive" : ""}>{state}</Pill></div><dl className="metric-grid"><div className="metric"><dt>Guard balance</dt><dd>{money(data?.guard?.usdc)}<small>Demo USDC</small></dd></div><div className="metric"><dt>Junior capital</dt><dd>{money(data?.pool?.junior)}<small>first-loss tranche</small></dd></div><div className="metric"><dt>Next hold</dt><dd>{data?.guard?.nextHoldId ?? "—"}<small>sequence ID</small></dd></div><div className="metric"><dt>Last recovery</dt><dd>{money(data?.payout?.amaraUsdc)}<small>Demo USDC</small></dd></div></dl><p className="fine-print">Agent {data?.agent?.erc8004AgentId ?? 894341} · values read through the configured backend proxy · no static balance is substituted when the API is unavailable.</p></section>;
}
