import { ImageResponse } from "next/og";

export const runtime = "nodejs";
export const revalidate = 86400;
export const alt = "REPAYD — Autonomy, with accountability";
export const size = { width: 1200, height: 630 };
export const contentType = "image/png";

const SHIELD_SVG = `<svg xmlns="http://www.w3.org/2000/svg" viewBox="0 0 64 72"><path d="M32 2 60 12v22c0 17-11 30-28 38C15 64 4 51 4 34V12L32 2Z" fill="#d1fc70" stroke="#20251d" stroke-width="3"/><path d="M32 14 50 21v13c0 11-7 20-18 26-11-6-18-15-18-26V21l18-7Z" fill="#20251d"/><path d="M32 22v25m-8-16 8-3 8 3" stroke="#d1fc70" stroke-width="3.5" stroke-linecap="round"/></svg>`;
const SHIELD_URI = `data:image/svg+xml;base64,${Buffer.from(SHIELD_SVG).toString("base64")}`;

export default function OpenGraphImage() {
  return new ImageResponse(
    (
      <div style={{ width: "100%", height: "100%", display: "flex", flexDirection: "column", justifyContent: "space-between", padding: "64px 72px", background: "#171b15", color: "#f2f6e9", fontFamily: "Arial" }}>
        <div style={{ display: "flex", justifyContent: "space-between", alignItems: "center" }}>
          <div style={{ display: "flex", alignItems: "center", gap: 16, fontSize: 34, fontWeight: 800 }}>
            {/* eslint-disable-next-line @next/next/no-img-element */}
            <img src={SHIELD_URI} width={44} height={50} alt="" />
            <span style={{ display: "flex" }}>repayd<span style={{ color: "#d1fc70" }}>.</span></span>
          </div>
          <span style={{ fontSize: 17, color: "#aeb9a2" }}>AGENT SAFETY INFRASTRUCTURE · ARC TESTNET</span>
        </div>
        <div style={{ display: "flex", alignItems: "center", justifyContent: "space-between" }}>
          <div style={{ display: "flex", flexDirection: "column", gap: 18, maxWidth: 780 }}>
            <div style={{ display: "flex", flexDirection: "column", fontSize: 76, fontWeight: 800, lineHeight: 1.02, letterSpacing: -4 }}>
              Autonomy is
              <span style={{ color: "#d1fc70" }}>earned.</span>
            </div>
            <div style={{ fontSize: 24, color: "#aeb9a2" }}>Spending boundaries. Replayable decisions. Recovery when something slips through.</div>
          </div>
          {/* eslint-disable-next-line @next/next/no-img-element */}
          <img src={SHIELD_URI} width={190} height={214} alt="" />
        </div>
        <div style={{ display: "flex", justifyContent: "space-between", fontSize: 17, color: "#aeb9a2" }}>
          <span>POLICY · EVIDENCE · RECOVERY</span>
          <span>REPAYD</span>
        </div>
      </div>
    ),
    { ...size },
  );
}
