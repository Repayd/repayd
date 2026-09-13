"use client";

import { useEffect, type ReactNode } from "react";

export type PageContentData = {
  page: string;
  mainClass: string;
  main: string;
  mainBefore?: string;
  mainAfter?: string;
  scripts: string[];
};

/**
 * Renders the authored page body inside the shared shell.
 *
 * The markup is reused verbatim so the page stays identical to the authored
 * one. Its scripts are injected after hydration: they mutate the DOM, and
 * running them before React hydrates causes hydration mismatches.
 *
 * When `slot` is supplied the body is split around one section, which is then
 * rendered by a React component instead.
 */
/** Pages whose scripts this document has already evaluated. */
const evaluated: Record<string, true> = {};

export function PageContent({
  content,
  slot,
}: {
  content: PageContentData;
  slot?: ReactNode;
}) {
  useEffect(() => {
    document.body.dataset.page = content.page;
  }, [content.page]);

  useEffect(() => {
    const added = content.scripts.map((src) => {
      const script = document.createElement("script");
      script.type = "module";
      script.src = src;
      script.dataset.repaydPageScript = content.page;
      document.body.appendChild(script);
      return script;
    });
    // The browser's module map caches by URL per document, so a re-injected
    // script never runs again. React, meanwhile, has just rebuilt the page
    // body from markup — every listener the module attached to the previous
    // nodes is gone with them. Tell the live modules to rebind to the new
    // nodes; on the first visit the module initialises itself and must not
    // get a second, duplicated pass.
    if (evaluated[content.page]) {
      document.dispatchEvent(
        new CustomEvent("repayd:remount", { detail: { page: content.page } }),
      );
    } else {
      evaluated[content.page] = true;
    }
    return () => {
      for (const script of added) script.remove();
    };
  }, [content.page, content.scripts]);

  if (slot) {
    return (
      <main id="main" className={content.mainClass}>
        <div dangerouslySetInnerHTML={{ __html: content.mainBefore ?? "" }} />
        {slot}
        <div dangerouslySetInnerHTML={{ __html: content.mainAfter ?? "" }} />
      </main>
    );
  }

  return (
    <main
      id="main"
      className={content.mainClass}
      dangerouslySetInnerHTML={{ __html: content.main }}
    />
  );
}
