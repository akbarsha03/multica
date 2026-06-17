"use client";

import { BookOpen, Plus } from "lucide-react";
import { useWorkspacePaths } from "@multica/core/paths";
import { useCreateWikiPage } from "@multica/core/wiki/mutations";
import { Button } from "@multica/ui/components/ui/button";
import { useNavigation } from "../../navigation";

// Right-pane placeholder shown at /wiki (no page selected). The tree lives in
// the persistent shell on the left.
export function WikiEmptyState() {
  const paths = useWorkspacePaths();
  const router = useNavigation();
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
  );
}
