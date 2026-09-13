import { ImageResponse } from "next/og";

export const runtime = "nodejs";
export const revalidate = 86400;
export const alt = "REPAYD — Autonomy, with accountability";
export const size = { width: 1200, height: 630 };
export const contentType = "image/png";

export default function OpenGraphImage() {
  return new ImageResponse(<div style={{ width: "100%", height: "100%", display: "flex", flexDirection: "column", justifyContent: "space-between", padding: "64px 72px", background: "#171b15", color: "#f2f6e9", fontFamily: "Arial" }}><div style={{ display: "flex", justifyContent: "space-between", alignItems: "center", fontSize: 30, fontWeight: 800 }}><span style={{ display: "flex" }}>repayd<span style={{ color: "#d1fc70" }}>.</span></span><span style={{ fontSize: 17, fontWeight: 400, color: "#aeb9a2" }}>AGENT SAFETY INFRASTRUCTURE · ARC TESTNET</span></div><div style={{ display: "flex", alignItems: "center", justifyContent: "space-between" }}><div style={{ display: "flex", flexDirection: "column", gap: 18, maxWidth: 760 }}><div style={{ display: "flex", flexDirection: "column", fontSize: 76, fontWeight: 800, lineHeight: 1.02, letterSpacing: -4 }}>Autonomy is<br /><span style={{ color: "#d1fc70" }}>earned.</span></div><div style={{ fontSize: 24, color: "#aeb9a2" }}>Spending boundaries. Replayable decisions. Recovery when something slips through.</div></div><div style={{ width: 190, height: 220, display: "flex", alignItems: "center", justifyContent: "center", background: "#d1fc70", color: "#20251d", borderRadius: 45, transform: "rotate(8deg)", fontSize: 130, fontWeight: 800 }}>R</div></div><div style={{ display: "flex", justifyContent: "space-between", fontSize: 17, color: "#aeb9a2" }}><span>POLICY · EVIDENCE · RECOVERY</span><span>REPAYD</span></div></div>, { ...size });
}
