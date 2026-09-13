"use client";

import Link from "next/link";
import { useCallback, useEffect, useState } from "react";
import { NAV } from "./nav";
import { Shield } from "./shield";

type Theme = "light" | "dark";

export function Navbar() {
  const [theme, setTheme] = useState<Theme>("light");
  const [menuOpen, setMenuOpen] = useState(false);
  const [pathname, setPathname] = useState("");

  // theme.js applies the stored theme before paint; mirror it into React state
  // so the toggle's attributes are owned by React after hydration.
  useEffect(() => {
    const current = document.documentElement.dataset.theme;
    if (current === "dark" || current === "light") setTheme(current);
    setPathname(window.location.pathname);
  }, []);

  useEffect(() => {
    document.documentElement.dataset.theme = theme;
    try {
      localStorage.setItem("repayd.theme", theme);
    } catch {}
  }, [theme]);

  useEffect(() => {
    const header = document.querySelector(".site-header");
    header?.classList.toggle("menu-open", menuOpen);
  }, [menuOpen]);

  const toggleTheme = useCallback(
    () => setTheme((current) => (current === "dark" ? "light" : "dark")),
    [],
  );

  return (
    <header className="site-header">
      <div className="shell header-inner">
        <Link
          className="brand"
          href="/"
          aria-label="Repayd home"
          onClick={(event) => {
            if (window.location.pathname !== "/") return;
            event.preventDefault();
            const lenis = window.__repaydLenis;
            if (lenis) lenis.scrollTo(0, { duration: 0.7 });
            else window.scrollTo({ top: 0, behavior: "smooth" });
          }}
        >
          <Shield />
          <span>
            repayd<span className="brand-period">.</span>
          </span>
        </Link>
        <nav className="primary-nav" id="primary-nav" aria-label="Primary navigation">
          {NAV.map(([label, href]) => (
            <Link key={href} href={href} aria-current={pathname === href ? "page" : undefined}>
              {label}
            </Link>
          ))}
        </nav>
        <div className="header-tools">
          <button
            className="theme-toggle icon-button"
            type="button"
            onClick={toggleTheme}
            aria-label={`Switch to ${theme === "dark" ? "light" : "dark"} theme`}
            aria-pressed={theme === "dark"}
          >
            <svg viewBox="0 0 24 24" fill="none" aria-hidden="true">
              <path
                d="M20 15A8 8 0 1 1 9 4a8 8 0 0 0 11 11Z"
                stroke="currentColor"
                strokeWidth="1.6"
              />
            </svg>
          </button>
          <button
            className="menu-toggle icon-button"
            type="button"
            onClick={() => setMenuOpen((open) => !open)}
            aria-controls="primary-nav"
            aria-expanded={menuOpen}
            aria-label={menuOpen ? "Close navigation" : "Open navigation"}
          >
            <span />
            <span />
          </button>
        </div>
      </div>
    </header>
  );
}
