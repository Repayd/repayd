"use client";

import { animate } from "animejs";
import { useEffect } from "react";

/**
 * Ecosystem boxes: hovering widens the box slightly and its points fade in.
 * anime.js drives both the width and the reveal; it stays small and quick.
 */
export function EcosystemCards() {
  useEffect(() => {
    const grid = document.querySelector<HTMLElement>(".ecosystem-grid");
    if (!grid) return;
    const cards = Array.from(grid.querySelectorAll<HTMLElement>(".ecosystem-card"));
    if (cards.length < 2) return;

    let shown: HTMLElement | null = null;

    const hideDetail = (fade: boolean) => {
      const detail = shown;
      if (!detail) return;
      shown = null;
      if (!fade) {
        detail.style.display = "none";
        return;
      }
      animate(detail, {
        opacity: 0,
        translateY: 6,
        duration: 150,
        ease: "outQuad",
        onComplete: () => {
          detail.style.display = "none";
        },
      });
    };

    const showDetail = (card: HTMLElement) => {
      const detail = card.querySelector<HTMLElement>(".ecosystem-detail");
      if (!detail) return;
      shown = detail;
      detail.style.display = "block";
      animate(detail, {
        opacity: [0, 1],
        translateY: [8, 0],
        duration: 300,
        delay: 120,
        ease: "outQuad",
      });
    };

    const reduced = window.matchMedia("(prefers-reduced-motion: reduce)").matches;

    const setActive = (card: HTMLElement | null) => {
      hideDetail(!reduced);
      for (const item of cards) {
        animate(item, {
          flexGrow: card ? (item === card ? 1.45 : 1) : 1,
          duration: 320,
          ease: "outQuad",
        });
      }
      if (card) showDetail(card);
    };

    const enter = (event: Event) => setActive(event.currentTarget as HTMLElement);
    const leave = () => setActive(null);

    for (const card of cards) {
      card.addEventListener("mouseenter", enter);
      card.addEventListener("focusin", enter);
    }
    grid.addEventListener("mouseleave", leave);
    grid.addEventListener("focusout", leave);

    return () => {
      for (const card of cards) {
        card.removeEventListener("mouseenter", enter);
        card.removeEventListener("focusin", enter);
      }
      grid.removeEventListener("mouseleave", leave);
      grid.removeEventListener("focusout", leave);
    };
  }, []);

  return null;
}
