"use client";

import { BookOpen, Plus } from "lucide-react";
import { useQuery } from "@tanstack/react-query";
import { useWorkspaceId } from "@multica/core/hooks";
import { useWorkspacePaths } from "@multica/core/paths";
import { wikiPagesOptions } from "@multica/core/wiki/queries";
import { useCreateWikiPage } from "@multica/core/wiki/mutations";
import { Button } from "@multica/ui/components/ui/button";
import { useNavigation } from "../../navigation";
import { PageHeader } from "../../layout/page-header";
import { WikiTree } from "./wiki-tree";

export function WikiPage() {
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
    <div className="flex flex-1 min-h-0 flex-col">
      <PageHeader className="gap-2">
        <BookOpen className="h-4 w-4 text-muted-foreground" />
        <h1 className="text-sm font-medium">Wiki</h1>
      </PageHeader>

      <div className="flex flex-1 min-h-0">
        {/* Left sidebar: page tree */}
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
            <WikiTree pages={pages} />
          </div>
        </div>

        {/* Main area: empty state */}
        <div className="flex flex-1 min-h-0 flex-col items-center justify-center gap-3 text-muted-foreground">
          <BookOpen className="h-10 w-10 text-muted-foreground/40" />
          <p className="text-sm">Select a page or create one</p>
          <Button
            variant="outline"
            size="sm"
            onClick={handleNewPage}
            disabled={createPage.isPending}
          >
            <Plus className="mr-1.5 h-3.5 w-3.5" />
            New page
          </Button>
        </div>
      </div>
    </div>
  );
}
