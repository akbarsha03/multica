import { useMutation, useQueryClient } from "@tanstack/react-query";
import { api } from "../api";
import { wikiKeys } from "./queries";
import { useWorkspaceId } from "../hooks";

export function useCreateWikiPage() {
  const qc = useQueryClient();
  const wsId = useWorkspaceId();
  return useMutation({
    mutationFn: ({ parent_id, ...rest }: { title: string; content?: string; parent_id?: string | null }) =>
      api.createWikiPage({ ...rest, ...(parent_id != null ? { parent_id } : {}) }),
    onSettled: () => qc.invalidateQueries({ queryKey: wikiKeys.pages(wsId) }),
  });
}

export function useUpdateWikiPage() {
  const qc = useQueryClient();
  const wsId = useWorkspaceId();
  return useMutation({
    mutationFn: ({ id, ...d }: { id: string; title: string; content: string; summary?: string }) =>
      api.updateWikiPage(id, d),
    onSettled: (_r, _e, v) => {
      qc.invalidateQueries({ queryKey: wikiKeys.page(wsId, v.id) });
      qc.invalidateQueries({ queryKey: wikiKeys.revisions(wsId, v.id) });
      qc.invalidateQueries({ queryKey: wikiKeys.pages(wsId) });
    },
  });
}

export function useArchiveWikiPage() {
  const qc = useQueryClient();
  const wsId = useWorkspaceId();
  return useMutation({
    mutationFn: (id: string) => api.archiveWikiPage(id),
    onSettled: () => qc.invalidateQueries({ queryKey: wikiKeys.pages(wsId) }),
  });
}

export function useProposeWikiRevision() {
  const qc = useQueryClient();
  const wsId = useWorkspaceId();
  return useMutation({
    mutationFn: ({ pageId, ...d }: { pageId: string; title: string; content: string; summary?: string }) =>
      api.proposeWikiRevision(pageId, d),
    onSettled: () => qc.invalidateQueries({ queryKey: wikiKeys.proposals(wsId) }),
  });
}

export function useMergeWikiRevision() {
  const qc = useQueryClient();
  const wsId = useWorkspaceId();
  return useMutation({
    mutationFn: (revId: string) => api.mergeWikiRevision(revId),
    onSettled: () => qc.invalidateQueries({ queryKey: wikiKeys.all(wsId) }),
  });
}

export function useRejectWikiRevision() {
  const qc = useQueryClient();
  const wsId = useWorkspaceId();
  return useMutation({
    mutationFn: (revId: string) => api.rejectWikiRevision(revId),
    onSettled: () => qc.invalidateQueries({ queryKey: wikiKeys.proposals(wsId) }),
  });
}
