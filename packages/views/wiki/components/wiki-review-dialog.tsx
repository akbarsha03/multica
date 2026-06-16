"use client";

import { AlertTriangle } from "lucide-react";
import { Dialog, DialogContent, DialogHeader, DialogTitle, DialogFooter } from "@multica/ui/components/ui/dialog";
import { Button } from "@multica/ui/components/ui/button";
import { useMergeWikiRevision, useRejectWikiRevision } from "@multica/core/wiki/mutations";
import type { WikiPage, WikiRevision } from "@multica/core/types";
import { WikiDiff } from "./wiki-diff";

interface WikiReviewDialogProps {
  proposal: WikiRevision;
  livePage: WikiPage;
  onClose: () => void;
}

export function WikiReviewDialog({ proposal, livePage, onClose }: WikiReviewDialogProps) {
  const merge = useMergeWikiRevision();
  const reject = useRejectWikiRevision();

  const isPending = merge.isPending || reject.isPending;
  const isStale = proposal.base_revision_id !== livePage.current_revision_id;

  const handleApprove = () => {
    merge.mutate(proposal.id, { onSuccess: onClose });
  };

  const handleReject = () => {
    reject.mutate(proposal.id, { onSuccess: onClose });
  };

  return (
    <Dialog open onOpenChange={(v) => { if (!v) onClose(); }}>
      <DialogContent className="max-w-3xl">
        <DialogHeader>
          <DialogTitle>
            {livePage.title || "Untitled"} — Proposed edit
          </DialogTitle>
          {proposal.summary && (
            <p className="text-sm text-muted-foreground mt-1">{proposal.summary}</p>
          )}
          {isStale && (
            <div className="flex items-center gap-1.5 text-sm text-amber-600 dark:text-amber-400 mt-1">
              <AlertTriangle className="h-3.5 w-3.5 shrink-0" />
              Based on an older version of this page.
            </div>
          )}
        </DialogHeader>

        <div className="max-h-[60vh] overflow-y-auto rounded-lg border bg-muted/30 p-3">
          <WikiDiff oldText={livePage.content} newText={proposal.content} />
        </div>

        <DialogFooter>
          <Button
            variant="outline"
            size="sm"
            onClick={handleReject}
            disabled={isPending}
          >
            Reject
          </Button>
          <Button
            size="sm"
            onClick={handleApprove}
            disabled={isPending}
          >
            Approve
          </Button>
        </DialogFooter>
      </DialogContent>
    </Dialog>
  );
}
