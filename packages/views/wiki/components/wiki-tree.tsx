"use client";

import { useMemo } from "react";
import type { WikiPage } from "@multica/core/types";
import { useWorkspacePaths } from "@multica/core/paths";
import { AppLink } from "../../navigation";
import { cn } from "@multica/ui/lib/utils";
import { FileText } from "lucide-react";

interface WikiTreeNodeProps {
  pages: WikiPage[];
  parentId: string | null;
  activeId?: string;
  depth: number;
}

function WikiTreeNode({ pages, parentId, activeId, depth }: WikiTreeNodeProps) {
  const paths = useWorkspacePaths();

  const children = useMemo(() => {
    return pages
      .filter((p) => p.parent_id === parentId && !p.archived_at)
      .sort((a, b) => {
        if (a.position !== b.position) return a.position - b.position;
        return a.created_at.localeCompare(b.created_at);
      });
  }, [pages, parentId]);

  if (children.length === 0) return null;

  return (
    <ul className="flex flex-col gap-0.5">
      {children.map((page) => (
        <li key={page.id}>
          <AppLink
            href={paths.wikiPage(page.id)}
            className={cn(
              "flex items-center gap-2 rounded-md px-2 py-1.5 text-sm transition-colors hover:bg-accent",
              activeId === page.id
                ? "bg-accent text-accent-foreground font-medium"
                : "text-muted-foreground hover:text-foreground",
            )}
            style={{ paddingLeft: `${(depth + 1) * 0.75}rem` }}
          >
            <FileText className="h-3.5 w-3.5 shrink-0" />
            <span className="truncate">{page.title || "Untitled"}</span>
          </AppLink>
          <WikiTreeNode
            pages={pages}
            parentId={page.id}
            activeId={activeId}
            depth={depth + 1}
          />
        </li>
      ))}
    </ul>
  );
}

interface WikiTreeProps {
  pages: WikiPage[];
  activeId?: string;
}

export function WikiTree({ pages, activeId }: WikiTreeProps) {
  return (
    <nav className="flex flex-col gap-0.5 overflow-y-auto">
      <WikiTreeNode pages={pages} parentId={null} activeId={activeId} depth={0} />
    </nav>
  );
}
