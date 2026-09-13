import { readFileSync } from "node:fs";
import { join } from "node:path";
import type { ReactNode } from "react";
import { PageContent, type PageContentData } from "./page-content";

/** Server-side loader for the authored page body. */
export function AuthoredPage({ name, slot }: { name: string; slot?: ReactNode }) {
  const content = JSON.parse(
    readFileSync(join(process.cwd(), "content", `${name}.json`), "utf8"),
  ) as PageContentData;
  return <PageContent content={content} slot={slot} />;
}
