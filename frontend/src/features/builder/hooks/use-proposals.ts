import { useCallback, useEffect, useRef, useState } from 'react';
import { useSearchParams } from 'react-router-dom';
import { useQueryClient } from '@tanstack/react-query';
import { toast } from 'sonner';
import { ApiError } from '../../../lib/api';
import { proposalApi, syncStateKey, useSyncState, type ProposalSummary } from '../api/proposals';
import { useBuilderStore } from '../store/builder-store';

type Busy = 'open' | 'apply' | 'reject' | null;

function messageOf(error: unknown, fallback: string): string {
  return error instanceof Error && error.message ? error.message : fallback;
}

/**
 * Connects the builder to LLM proposals: it polls for new ones, opens them on
 * the preview canvas, and applies or rejects them. It also reloads the build
 * when a newer revision was saved from another session.
 */
export function useProposals(buildId: string | undefined) {
  const queryClient = useQueryClient();
  const [searchParams, setSearchParams] = useSearchParams();
  const currentBuildId = useBuilderStore(s => s.currentBuildId);
  const currentRevision = useBuilderStore(s => s.currentRevision);
  const preview = useBuilderStore(s => s.proposalPreview);
  const ready = !!buildId && currentBuildId === buildId;

  const { data: syncState, dataUpdatedAt } = useSyncState(buildId, ready);
  const [busy, setBusy] = useState<Busy>(null);
  const [dismissedId, setDismissedId] = useState<string | null>(null);
  // Poll results fetched before the preview was opened say nothing about it.
  const openedAt = useRef(0);

  const refreshSyncState = useCallback(
    () => queryClient.invalidateQueries({ queryKey: syncStateKey(buildId) }),
    [queryClient, buildId],
  );

  const openReview = useCallback(
    async (proposalId: string) => {
      if (!buildId) return;
      setBusy('open');
      try {
        // Save what is on screen first so the preview is computed against it.
        const store = useBuilderStore.getState();
        if (store.hasUnsavedChanges()) await store.reassignAllIPs();
        const proposal = await proposalApi.get(buildId, proposalId);
        openedAt.current = Date.now();
        useBuilderStore.getState().startProposalPreview(proposal);
      } catch (error) {
        toast.error(messageOf(error, 'Could not open the proposal.'));
      } finally {
        setBusy(null);
      }
    },
    [buildId],
  );

  const closeReview = useCallback(() => {
    useBuilderStore.getState().endProposalPreview();
  }, []);

  const apply = useCallback(async () => {
    const current = useBuilderStore.getState().proposalPreview;
    if (!current || !buildId) return;
    setBusy('apply');
    try {
      await useBuilderStore.getState().applyProposal(current.proposal.id);
      toast.success('Proposal applied. Press Ctrl+Z to undo it.');
    } catch (error) {
      toast.error(messageOf(error, 'Could not apply the proposal.'));
      if (error instanceof ApiError && error.status === 409) {
        // It was settled elsewhere or no longer fits: show its current state.
        try {
          const latest = await proposalApi.get(buildId, current.proposal.id);
          openedAt.current = Date.now();
          useBuilderStore.getState().startProposalPreview(latest);
        } catch {
          closeReview();
        }
      }
    } finally {
      setBusy(null);
      void refreshSyncState();
    }
  }, [buildId, closeReview, refreshSyncState]);

  const reject = useCallback(
    async (reason: string) => {
      const current = useBuilderStore.getState().proposalPreview;
      if (!current || !buildId) return;
      setBusy('reject');
      try {
        await proposalApi.reject(buildId, current.proposal.id, reason);
        toast.success('Proposal rejected.');
        closeReview();
      } catch (error) {
        toast.error(messageOf(error, 'Could not reject the proposal.'));
        if (error instanceof ApiError && error.status === 409) closeReview();
      } finally {
        setBusy(null);
        void refreshSyncState();
      }
    },
    [buildId, closeReview, refreshSyncState],
  );

  // Another session saved a newer revision: load it once nothing local is pending.
  useEffect(() => {
    if (!ready || !syncState || preview) return;
    if (syncState.revision <= currentRevision) return;
    void useBuilderStore
      .getState()
      .syncWithServer(syncState.revision)
      .then(reloaded => {
        if (reloaded) toast.info('Loaded changes made in another session.');
      })
      .catch(() => undefined);
  }, [ready, syncState, currentRevision, preview]);

  // While a pending proposal is open, follow what happens to it elsewhere.
  const previewId = preview?.proposal.id;
  const previewPending = preview?.proposal.status === 'pending';
  const pendingId = syncState?.pending?.id ?? null;
  useEffect(() => {
    if (!buildId || !previewId || !previewPending || busy) return;
    if (!syncState || dataUpdatedAt <= openedAt.current) return;
    if (pendingId === previewId) return;
    if (pendingId) {
      toast.info('The proposal was updated. Showing the new version.');
      void openReview(pendingId);
      return;
    }
    openedAt.current = Date.now();
    void proposalApi
      .get(buildId, previewId)
      .then(latest => {
        if (useBuilderStore.getState().proposalPreview?.proposal.id === latest.id) {
          useBuilderStore.getState().startProposalPreview(latest);
        }
      })
      .catch(() => closeReview());
  }, [buildId, previewId, previewPending, pendingId, syncState, dataUpdatedAt, busy, openReview, closeReview]);

  // A review link from an MCP client: /builder/<id>?proposal=<proposal id>.
  const linkedProposal = searchParams.get('proposal');
  useEffect(() => {
    if (!ready || !linkedProposal) return;
    const next = new URLSearchParams(searchParams);
    next.delete('proposal');
    setSearchParams(next, { replace: true });
    void openReview(linkedProposal);
  }, [ready, linkedProposal, searchParams, setSearchParams, openReview]);

  // Leaving the builder ends any open review.
  useEffect(() => () => useBuilderStore.getState().endProposalPreview(), []);

  const pending: ProposalSummary | null =
    !preview && syncState?.pending && syncState.pending.id !== dismissedId ? syncState.pending : null;

  return {
    /** A proposal waiting for review that is not open or dismissed. */
    pending,
    busy,
    openReview,
    closeReview,
    apply,
    reject,
    dismiss: () => setDismissedId(syncState?.pending?.id ?? null),
    refreshSyncState,
  };
}
