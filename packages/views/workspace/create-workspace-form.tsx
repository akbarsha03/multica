"use client";

import { useRef, useState } from "react";
import { toast } from "sonner";
import { useQuery } from "@tanstack/react-query";
import { Input } from "@multica/ui/components/ui/input";
import { Label } from "@multica/ui/components/ui/label";
import { Button } from "@multica/ui/components/ui/button";
import { Card, CardContent } from "@multica/ui/components/ui/card";
import { Checkbox } from "@multica/ui/components/ui/checkbox";
import {
  Select,
  SelectContent,
  SelectItem,
  SelectTrigger,
  SelectValue,
} from "@multica/ui/components/ui/select";
import { useCreateWorkspace, useCopyWorkspace } from "@multica/core/workspace/mutations";
import type { Workspace, CopySelections } from "@multica/core/types";
import { workspaceListOptions } from "@multica/core/workspace/queries";
import { isImeComposing } from "@multica/core/utils";
import {
  WORKSPACE_SLUG_REGEX,
  isWorkspaceSlugConflict,
  nameToWorkspaceSlug,
} from "./slug";
import { useT } from "../i18n";
import { isReservedSlug } from "@multica/core/paths";
import { useConfigStore } from "@multica/core/config";
import { workspaceUrlHost } from "@multica/core/workspace/workspace-url";

export interface CreateWorkspaceFormProps {
  onSuccess: (workspace: Workspace) => void | Promise<void>;
}

const ALL_COPY_SELECTIONS: CopySelections = {
  agents: true,
  squads: true,
  autopilots: true,
  wiki: true,
  issues: true,
};

const COPY_SELECTION_KEYS: (keyof CopySelections)[] = [
  "agents",
  "squads",
  "autopilots",
  "wiki",
  "issues",
];

export function CreateWorkspaceForm({ onSuccess }: CreateWorkspaceFormProps) {
  const { t } = useT("workspace");
  const createWorkspace = useCreateWorkspace();
  const copyWorkspace = useCopyWorkspace();
  const urlHost = workspaceUrlHost(useConfigStore((s) => s.daemonAppUrl));
  const [name, setName] = useState("");
  const [slug, setSlug] = useState("");
  const [slugServerError, setSlugServerError] = useState<string | null>(null);
  const slugTouched = useRef(false);

  // Copy mode state
  const [copyMode, setCopyMode] = useState(false);
  const [sourceWorkspaceId, setSourceWorkspaceId] = useState<string>("");
  const [copySelections, setCopySelections] = useState<CopySelections>(ALL_COPY_SELECTIONS);

  const { data: workspaces = [] } = useQuery(workspaceListOptions());

  const slugValidationError =
    slug.length > 0 && !WORKSPACE_SLUG_REGEX.test(slug)
      ? t(($) => $.create_form.errors.slug_format)
      : null;
  const slugReservedError =
    slug.length > 0 && isReservedSlug(slug)
      ? t(($) => $.create_form.errors.slug_reserved)
      : null;
  const slugError = slugValidationError ?? slugReservedError ?? slugServerError;

  const copyModeReady = !copyMode || (copyMode && sourceWorkspaceId !== "");
  const canSubmit =
    name.trim().length > 0 &&
    slug.trim().length > 0 &&
    !slugError &&
    copyModeReady;

  const handleNameChange = (value: string) => {
    setName(value);
    if (!slugTouched.current) {
      setSlug(nameToWorkspaceSlug(value));
      setSlugServerError(null);
    }
  };

  const handleSlugChange = (value: string) => {
    slugTouched.current = true;
    setSlug(value);
    setSlugServerError(null);
  };

  const toggleSelection = (key: keyof CopySelections) => {
    setCopySelections((prev) => ({ ...prev, [key]: !prev[key] }));
  };

  const handleError = (error: unknown) => {
    if (isWorkspaceSlugConflict(error)) {
      setSlugServerError(t(($) => $.create_form.errors.slug_taken));
      toast.error(t(($) => $.create_form.errors.slug_conflict_toast));
      return;
    }
    toast.error(
      error instanceof Error && error.message
        ? error.message
        : t(($) => $.create_form.errors.create_failed),
    );
  };

  const handleSubmit = () => {
    if (!canSubmit) return;

    if (copyMode && sourceWorkspaceId) {
      copyWorkspace.mutate(
        {
          name: name.trim(),
          slug: slug.trim(),
          source_workspace_id: sourceWorkspaceId,
          copy: copySelections,
        },
        { onSuccess, onError: handleError },
      );
    } else {
      createWorkspace.mutate(
        { name: name.trim(), slug: slug.trim() },
        { onSuccess, onError: handleError },
      );
    }
  };

  const isPending = createWorkspace.isPending || copyWorkspace.isPending;

  return (
    <Card className="w-full">
      <CardContent className="space-y-4 pt-6">
        <div className="space-y-1.5">
          <Label htmlFor="ws-name">{t(($) => $.create_form.name_label)}</Label>
          <Input
            id="ws-name"
            autoFocus
            type="text"
            value={name}
            onChange={(e) => handleNameChange(e.target.value)}
            placeholder={t(($) => $.create_form.name_placeholder)}
            onKeyDown={(e) => {
              if (isImeComposing(e)) return;
              if (e.key === "Enter") handleSubmit();
            }}
          />
        </div>
        <div className="space-y-1.5">
          <Label htmlFor="ws-slug">{t(($) => $.create_form.url_label)}</Label>
          <div className="flex items-center gap-0 rounded-md border bg-background focus-within:ring-2 focus-within:ring-ring">
            <span className="pl-3 text-sm text-muted-foreground select-none">
              {`${urlHost}/`}
            </span>
            <Input
              id="ws-slug"
              type="text"
              value={slug}
              onChange={(e) => handleSlugChange(e.target.value)}
              placeholder={t(($) => $.create_form.url_placeholder)}
              className="border-0 shadow-none focus-visible:ring-0"
              onKeyDown={(e) => {
                if (isImeComposing(e)) return;
                if (e.key === "Enter") handleSubmit();
              }}
            />
          </div>
          {slugError && (
            <p className="text-xs text-destructive">{slugError}</p>
          )}
        </div>

        {/* Copy mode toggle */}
        <div className="flex items-center gap-2">
          <Checkbox
            id="copy-mode"
            checked={copyMode}
            onCheckedChange={(v) => {
              setCopyMode(!!v);
              if (!v) setSourceWorkspaceId("");
            }}
          />
          <Label htmlFor="copy-mode" className="cursor-pointer font-normal">
            Copy from existing workspace
          </Label>
        </div>

        {copyMode && (
          <div className="space-y-3 pl-6">
            <div className="space-y-1.5">
              <Label>Source workspace</Label>
              <Select value={sourceWorkspaceId} onValueChange={(v) => setSourceWorkspaceId(v ?? "")}>
                <SelectTrigger>
                  <SelectValue placeholder="Select a workspace…" />
                </SelectTrigger>
                <SelectContent>
                  {workspaces.map((ws) => (
                    <SelectItem key={ws.id} value={ws.id}>
                      {ws.name}
                    </SelectItem>
                  ))}
                </SelectContent>
              </Select>
            </div>

            <div className="space-y-2">
              <Label className="text-sm text-muted-foreground">What to copy</Label>
              {COPY_SELECTION_KEYS.map((key) => (
                <div key={key} className="flex items-center gap-2">
                  <Checkbox
                    id={`copy-${key}`}
                    checked={copySelections[key]}
                    onCheckedChange={() => toggleSelection(key)}
                  />
                  <Label
                    htmlFor={`copy-${key}`}
                    className="cursor-pointer font-normal capitalize"
                  >
                    {key}
                  </Label>
                </div>
              ))}
            </div>
          </div>
        )}

        <Button
          className="w-full"
          size="lg"
          onClick={handleSubmit}
          disabled={isPending || !canSubmit}
        >
          {isPending
            ? t(($) => $.create_form.submitting)
            : t(($) => $.create_form.submit)}
        </Button>
      </CardContent>
    </Card>
  );
}
