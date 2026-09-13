import Link from "next/link";
import { Shield } from "./shield";

const ecosystem = [
  ["Circle", "https://www.circle.com/en/developer"],
  ["The Graph", "https://thegraph.com/studio/"],
  ["Hedera", "https://hashscan.io/testnet"],
  ["ENS", "https://sepolia.app.ens.domains/name/atlasrepayd.eth"],
] as const;

export function Footer() {
  return (
    <footer className="site-footer">
      <div className="shell">
        <div className="footer-top">
          <div>
            <p className="footer-brand">
              <Shield />
              <span>
                repayd<span className="brand-period">.</span>
              </span>
            </p>
            <p className="section-label">THE CONTROL PLANE FOR AGENTS</p>
            <p className="footer-lead">
              Let intelligence move.
              <br />
              Give risk a boundary.
            </p>
          </div>
          <nav className="footer-nav" aria-label="Ecosystem links">
            <span className="section-label">Ecosystem</span>
            {ecosystem.map(([label, href]) => (
              <a
                key={href}
                href={href}
                target="_blank"
                rel="noopener noreferrer"
                aria-label={`${label} (opens in a new tab)`}
              >
                {label} ↗
              </a>
            ))}
          </nav>
          <nav className="footer-nav" aria-label="Repository links">
            <span className="section-label">Source</span>
            <a
              href="https://github.com/Repayd/repayd"
              target="_blank"
              rel="noopener noreferrer"
              aria-label="REPAYD repository (opens in a new tab)"
            >
              Repository ↗
            </a>
            <Link href="/record">Agent record ↗</Link>
            <Link href="/flow">Receipt flow ↗</Link>
          </nav>
        </div>
        <div className="footer-bottom">
          <span>ETHOnline 2026 · Arc testnet · 5042002</span>
          <span>Testnet prototype · Not a real-money insurance product.</span>
          <Link href="/demo">Run the live demo ↗</Link>
        </div>
        <div className="footer-watermark" aria-hidden="true">
          repayd<span>.</span>
        </div>
      </div>
    </footer>
  );
}
