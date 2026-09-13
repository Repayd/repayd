import type { MetadataRoute } from "next";

export default function manifest(): MetadataRoute.Manifest {
  return {
    name: "REPAYD — Autonomy, with accountability",
    short_name: "REPAYD",
    description: "Policy-bound spending, inspectable decisions, and covered-loss recovery for AI agents.",
    start_url: "/",
    display: "standalone",
    background_color: "#171b15",
    theme_color: "#d1fc70",
    icons: [{ src: "/icon.svg", sizes: "any", type: "image/svg+xml", purpose: "any" }],
  };
}
