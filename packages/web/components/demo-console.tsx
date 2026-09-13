"use client";
import { useEffect, useState } from "react";
import { Pill } from "./site-shell";

type DemoState = { activeRunId: string | null; run: { status: string; phase: string; progress: number; events: unknown[]; transactions: unknown[] } | null };

export function DemoConsole() {
  const [state, setState] = useState<DemoState | null>(null);
  const [busy, setBusy] = useState(false);
  const [message, setMessage] = useState("Ready when you are.");
  const refresh = async () => {
    const response = await fetch("/api/demo/state", { cache: "no-store" });
    if (response.ok) setState(await response.json());
  };
  useEffect(() => {
    void refresh();
    if (!state?.activeRunId) return;
    const timer = window.setInterval(() => void refresh(), 10000);
    return () => window.clearInterval(timer);
  }, [state?.activeRunId]);
  const run = async () => {
    setBusy(true); setMessage("Submitting one server-owned run…");
    try {
      const response = await fetch("/api/demo/run", { method: "POST", headers: { "content-type": "application/json" }, body: "{}" });
      if (!response.ok) throw new Error(await response.text());
      setMessage("Run accepted. This page can be left safely while the server executes.");
      await refresh();
    } catch (error) { setMessage(error instanceof Error ? error.message : "Run could not be started."); }
    finally { setBusy(false); }
  };
  const active = Boolean(state?.activeRunId);
  const runState = state?.run;
  return <section className="card"><div className="section-head"><div><p className="eyebrow">THE PERSISTENT RUNNER</p><h2>Watch the boundary hold.</h2></div><Pill tone={active ? "positive" : ""}>{active ? "Running" : runState?.status ?? "Ready"}</Pill></div><div className="trace"><div className="trace-row"><div className="trace-node">Agent<small>PROPOSES</small></div><div className="trace-line" /><div className="trace-node guard">Guard<small>ENFORCES</small></div><div className="trace-line" /><div className="trace-node">World<small>SETTLES</small></div></div><div className="trace-amount"><span>{runState ? `${Math.round(runState.progress ?? 0)}%` : "—"}</span><small>{runState?.phase ?? "NO RUN SELECTED"}</small></div></div><div className="actions"><button className="button lime" disabled={busy || active} onClick={run}>{busy ? "Starting…" : active ? "Run in progress" : "Run the live story ↗"}</button><a className="button" href="/flow">Inspect receipts</a></div><p className="fine-print">{message} Real testnet receipts are preserved by the Bun backend; local judgments remain explicitly labeled.</p></section>;
}
