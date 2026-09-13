import type { Metadata } from "next";
import { Footer } from "../components/footer";
import { Navbar } from "../components/navbar";
import { SmoothScroll } from "../components/smooth-scroll";

const siteUrl = process.env.NEXT_PUBLIC_SITE_URL ?? "http://localhost:3001";

export const metadata: Metadata = {
  metadataBase: new URL(siteUrl),
  title: { default: "REPAYD — The safety layer for agent money", template: "%s — REPAYD" },
  description: "Autonomy is earned. Policy-bound spending, inspectable decisions, and covered-loss recovery for AI agents.",
  applicationName: "REPAYD",
  keywords: ["AI agents", "agent wallets", "payment safety", "Arc", "ERC-8004", "Hedera", "The Graph"],
  alternates: { canonical: "/" },
  openGraph: {
    type: "website",
    siteName: "REPAYD",
    title: "The safety layer for agent money",
    description: "Autonomy is earned. Policy-bound spending, inspectable decisions, and covered-loss recovery for AI agents.",
    url: siteUrl,
    images: [{ url: "/opengraph-image", width: 1200, height: 630, alt: "REPAYD — Autonomy, with accountability" }],
  },
  twitter: {
    card: "summary_large_image",
    title: "The safety layer for agent money",
    description: "Autonomy is earned. Policy-bound spending, inspectable decisions, and covered-loss recovery for AI agents.",
    images: ["/opengraph-image"],
  },
  icons: { icon: "/icon.svg", shortcut: "/icon.svg", apple: "/icon.svg" },
};

export default function RootLayout({ children }: Readonly<{ children: React.ReactNode }>) {
  return (
    <html lang="en" suppressHydrationWarning>
      <head>
        <link rel="preload" href="/assets/manrope-bold.ttf" as="font" type="font/ttf" crossOrigin="anonymous" />
        <link rel="stylesheet" href="/assets/dashboard.css" precedence="default" />
        <script src="/assets/theme.js" />
      </head>
      <body>
        <a className="skip-link" href="#main">
          Skip to content
        </a>
        <Navbar />
        <SmoothScroll />
        {children}
        <Footer />
      </body>
    </html>
  );
}
