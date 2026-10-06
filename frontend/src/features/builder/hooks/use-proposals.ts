import { useCallback, useEffect, useRef, useState } from 'react';
import { useNavigate, useSearchParams } from 'react-router-dom';
import { useQueryClient } from '@tanstack/react-query';
import { toast } from 'sonner';
import { ApiError } from '../../../lib/api';
import { proposalApi, syncStateKey, useSyncState, type ProposalSummary } from '../api/proposals';
import { polishCanvas } from '../lib/polish';
import { useBuilderStore } from '../store/builder-store';

type Busy = 'open' | 'apply' | 'reject' | null;

function messageOf(error: unknown, fallback: string): string {
  return error instanceof Error && error.message ? error.message : fallback;
}

/**
 * Connects the builder to LLM proposals: it polls for new ones, shows them on
 * the canvas for review, and applies or rejects them. It also reloads the build
 * when a newer revision was saved from another session.
 */
export function useProposals(buildId: string | undefined) {
  const queryClient = useQueryClient();
  const navigate = useNavigate();
  const [searchParams, setSearchParams] = useSearchParams();
  const currentBuildId = useBuilderStore(s => s.currentBuildId);
  const currentRevision = useBuilderStore(s => s.currentRevision);
  const buildStatus = useBuilderStore(s => s.buildStatus);
  const saveState = useBuilderStore(s => s.saveState);
  const preview = useBuilderStore(s => s.proposalPreview);
  // Only a build whose graph is loaded can be compared with the server or reviewed.
  const ready = !!buildId && currentBuildId === buildId && buildStatus === 'ready';

  const {
    data: syncState,
    dataUpdatedAt,
    error: syncError,
    errorUpdateCount,
  } = useSyncState(buildId, ready);
  const [busy, setBusy] = useState<Busy>(null);
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

  /** Applies the proposal under review. Resolves to whether it was applied. */
  const apply = useCallback(async (): Promise<boolean> => {
    const current = useBuilderStore.getState().proposalPreview;
    if (!current || !buildId) return false;
    setBusy('apply');
    try {
      await useBuilderStore.getState().applyProposal(current.proposal.id);
      // New devices were put where there was room, not where they look best.
      const added = current.proposal.diff.counts.nodes_added;
      toast.success('Proposal applied', {
        description: 'It is one undo step (Ctrl+Z).',
        action: { label: 'Undo', onClick: () => useBuilderStore.getState().undo() },
        ...(added > 0 ? { cancel: { label: 'Polish layout', onClick: () => polishCanvas() } } : {}),
      });
      return true;
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
      return false;
    } finally {
      setBusy(null);
      void refreshSyncState();
    }
  }, [buildId, closeReview, refreshSyncState]);

  /** Rejects the proposal under review. Resolves to whether it was rejected. */
  const reject = useCallback(
    async (reason: string): Promise<boolean> => {
      const current = useBuilderStore.getState().proposalPreview;
      if (!current || !buildId) return false;
      setBusy('reject');
      try {
        await proposalApi.reject(buildId, current.proposal.id, reason);
        toast.success('Proposal rejected.');
        closeReview();
        return true;
      } catch (error) {
        toast.error(messageOf(error, 'Could not reject the proposal.'));
        if (error instanceof ApiError && error.status === 409) closeReview();
        return false;
      } finally {
        setBusy(null);
        void refreshSyncState();
      }
    },
    [buildId, closeReview, refreshSyncState],
  );

  // Another session saved a newer revision: load it once nothing local is pending.
  // This runs again on every poll and whenever the save state changes, so a
  // reload that had to wait (unsaved edits, a failed request) is not forgotten.
  const serverRevision = syncState?.revision ?? 0;
  useEffect(() => {
    if (!ready || preview || serverRevision <= currentRevision) return;
    if (saveState === 'saving') return;
    const previousNodes = useBuilderStore.getState().nodes;
    void useBuilderStore
      .getState()
      .syncWithServer(serverRevision)
      .then(reloaded => {
        if (!reloaded) return;
        const describe = (node: { position: unknown; data: unknown }) =>
          JSON.stringify([node.position, node.data]);
        const before = new Map(previousNodes.map(node => [node.id, describe(node)]));
        const changed = useBuilderStore
          .getState()
          .nodes.filter(node => before.get(node.id) !== describe(node))
          .map(node => node.id);
        toast.info('Loaded changes made in another session.', {
          action:
            changed.length > 0
              ? {
                  label: 'Show',
                  onClick: () => useBuilderStore.getState().requestCanvasFocus(changed),
                }
              : undefined,
        });
      })
      .catch(() => undefined);
  }, [ready, serverRevision, dataUpdatedAt, currentRevision, preview, saveState]);

  // The poll is the only sign of life from the server while nothing is edited.
  const failedPolls = useRef({ count: 0, seenErrors: 0, seenData: 0 });
  useEffect(() => {
    const tally = failedPolls.current;
    if (dataUpdatedAt !== tally.seenData) {
      tally.seenData = dataUpdatedAt;
      tally.count = 0;
      useBuilderStore.getState().setServerReachable(true);
    }
    if (errorUpdateCount === tally.seenErrors) return;
    tally.seenErrors = errorUpdateCount;
    if (!ready) return;
    if (syncError instanceof ApiError && syncError.status === 404) {
      // Deleted in another session: nothing here can be saved any more.
      useBuilderStore.getState().clearCurrentBuild();
      toast.error('This project was deleted.');
      navigate('/');
      return;
    }
    tally.count += 1;
    if (tally.count >= 3) useBuilderStore.getState().setServerReachable(false);
  }, [dataUpdatedAt, errorUpdateCount, syncError, ready, navigate]);

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

  const pending: ProposalSummary | null = !preview && syncState?.pending ? syncState.pending : null;

  return {
    /** A proposal waiting for review that is not open on the canvas. */
    pending,
    busy,
    openReview,
    closeReview,
    apply,
    reject,
    refreshSyncState,
  };
}
