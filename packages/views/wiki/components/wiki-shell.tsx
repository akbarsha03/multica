"use client";

import type { ReactNode } from "react";
import { BookOpen } from "lucide-react";
import { PageHeader } from "../../layout/page-header";
import { WikiSidebar } from "./wiki-sidebar";

// Persistent shell for the wiki section: the "Wiki" header + the page tree on
// the left, with the routed page (detail or empty state) in the right pane.
// Rendered from the Next.js wiki layout so the tree never remounts when you
// click between pages.
export function WikiShell({
  activeId,
  children,
}: {
  activeId?: string;
  children: ReactNode;
}) {
  return (
    <div className="flex flex-1 min-h-0 flex-col">
      <PageHeader className="gap-2">
        <BookOpen className="h-4 w-4 text-muted-foreground" />
        <h1 className="text-sm font-medium">Wiki</h1>
      </PageHeader>

      <div className="flex flex-1 min-h-0">
        <WikiSidebar activeId={activeId} />
        <div className="flex flex-1 min-h-0 min-w-0 flex-col overflow-auto">
          {children}
        </div>
      </div>
    </div>
  );
}
