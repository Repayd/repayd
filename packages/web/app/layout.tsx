import type { Metadata } from "next";
import "./globals.css";

const siteUrl = process.env.NEXT_PUBLIC_SITE_URL ?? "http://localhost:3001";

export const metadata: Metadata = {
  metadataBase: new URL(siteUrl),
  title: { default: "REPAYD — Autonomy, with accountability", template: "%s — REPAYD" },
  description: "Policy-bound spending, inspectable decisions, and covered-loss recovery for AI agents.",
  applicationName: "REPAYD",
  keywords: ["AI agents", "agent wallets", "payment safety", "Arc", "ERC-8004", "Hedera", "The Graph"],
  authors: [{ name: "REPAYD" }],
  creator: "REPAYD",
  alternates: { canonical: "/" },
  openGraph: { type: "website", siteName: "REPAYD", title: "Autonomy, with accountability", description: "Let intelligence move. Give risk a boundary.", url: siteUrl, images: [{ url: "/opengraph-image", width: 1200, height: 630, alt: "REPAYD — Autonomy, with accountability" }] },
  twitter: { card: "summary_large_image", title: "REPAYD — Autonomy, with accountability", description: "Policy-bound spending, inspectable decisions, and covered-loss recovery for AI agents.", images: ["/opengraph-image"] },
  icons: { icon: "/icon.svg", shortcut: "/icon.svg", apple: "/icon.svg" },
};

export default function RootLayout({ children }: Readonly<{ children: React.ReactNode }>) {
  return <html lang="en"><body>{children}</body></html>;
}
