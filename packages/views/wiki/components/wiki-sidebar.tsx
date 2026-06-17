"use client";

import { Plus } from "lucide-react";
import { useQuery } from "@tanstack/react-query";
import { useWorkspaceId } from "@multica/core/hooks";
import { useWorkspacePaths } from "@multica/core/paths";
import { wikiPagesOptions } from "@multica/core/wiki/queries";
import { useCreateWikiPage } from "@multica/core/wiki/mutations";
import { Button } from "@multica/ui/components/ui/button";
import { useNavigation } from "../../navigation";
import { WikiTree } from "./wiki-tree";

// Left column of the wiki master-detail layout: the page tree + "New page".
// `activeId` (the page currently open in the right pane) is supplied by the
// app layout, which reads it from the route — packages/views stays
// framework-agnostic (mirrors how app-sidebar takes `pathname` as a prop).
export function WikiSidebar({ activeId }: { activeId?: string }) {
  const wsId = useWorkspaceId();
  const paths = useWorkspacePaths();
  const router = useNavigation();

  const { data: pages = [] } = useQuery(wikiPagesOptions(wsId));
  const createPage = useCreateWikiPage();

  const handleNewPage = () => {
    createPage.mutate(
      { title: "Untitled", content: "" },
      {
        onSuccess: (created) => {
          router.push(paths.wikiPage(created.id));
        },
      },
    );
  };

  return (
    <div className="flex w-56 shrink-0 flex-col border-r">
      <div className="flex items-center justify-between px-3 py-2">
        <span className="text-xs font-medium text-muted-foreground uppercase tracking-wide">
          Pages
        </span>
        <Button
          variant="ghost"
          size="icon"
          className="h-6 w-6"
          onClick={handleNewPage}
          disabled={createPage.isPending}
          aria-label="New page"
        >
          <Plus className="h-3.5 w-3.5" />
        </Button>
      </div>
      <div className="flex-1 overflow-y-auto px-2 pb-4">
        <WikiTree pages={pages} activeId={activeId} />
      </div>
    </div>
  );
}
