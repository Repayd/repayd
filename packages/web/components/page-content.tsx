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
