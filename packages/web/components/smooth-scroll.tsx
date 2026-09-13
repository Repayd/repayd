"use client";

import Lenis from "lenis";
import { useEffect } from "react";

declare global {
  interface Window {
    __repaydLenis?: Lenis;
  }
}

/**
 * Subtle smooth scrolling.
 *
 * Deliberately restrained: a short lerp so the page still feels immediate, and
 * it is skipped entirely when the visitor prefers reduced motion.
 */
export function SmoothScroll() {
  useEffect(() => {
    if (window.matchMedia("(prefers-reduced-motion: reduce)").matches) return;

    const lenis = new Lenis({
      lerp: 0.09,
      wheelMultiplier: 0.9,
      touchMultiplier: 1.4,
      smoothWheel: true,
    });
    window.__repaydLenis = lenis;

    let frame = 0;
    const raf = (time: number) => {
      lenis.raf(time);
      frame = requestAnimationFrame(raf);
    };
    frame = requestAnimationFrame(raf);

    return () => {
      cancelAnimationFrame(frame);
      lenis.destroy();
      delete window.__repaydLenis;
    };
  }, []);

  return null;
}
