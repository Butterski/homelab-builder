import { useEffect, useRef, useState } from 'react';
import { Link } from 'react-router-dom';
import { ArrowDown, Loader2, Settings, Sparkles, Trash2, X } from 'lucide-react';
import { toast } from 'sonner';
import { Button } from '@/components/ui/button';
import { ConfirmDialog } from '@/components/ui/confirm-dialog';
import { useSyncState, type ProposalSummary } from '@/features/builder/api/proposals';
import { useBuilderStore } from '@/features/builder/store/builder-store';
import { useAssistantSettings } from '@/features/settings/api/assistant-settings';
import type { BuildKind } from '@/types';
import { describeChanges } from '../lib/describe-changes';
import {
  currentActivity,
  useAssistantStore,
  type ChatItem,
  type ChatMessage,
  type ProposalCardStatus,
} from '../store/assistant-store';
import { Composer } from './composer';
import { MessageList } from './message-list';
import { ProposalCard, type ProposalReview } from './proposal-card';

type AssistantPanelProps = {
  buildId: string;
  /** True while a proposal review is being opened. */
  openingProposal: boolean;
  onReview: (proposalId: string) => void;
  /** Called when the assistant created a proposal, so the builder can show it at once. */
  onProposal: (proposal: ProposalSummary) => void;
  /** Which action on the proposal under review is running, if any. */
  reviewBusy: 'apply' | 'reject' | null;
  onApply: () => void;
  onReject: (reason: string) => void;
  /** Opens the full list of changes of the proposal under review. */
  onShowChanges: () => void;
  onClose: () => void;
};

const EXAMPLES: Record<BuildKind, string[]> = {
  homelab: [
    'Review this build and point out problems.',
    'Add a NAS and connect it to my switch.',
    'What hardware do I need to run Jellyfin and Home Assistant?',
    'Explain how the devices in this build are connected.',
  ],
  lan_party: [
    'Check this LAN party plan and tell me what to fix first.',
    'Add two more tables of 8 and spread them over the power circuits.',
    'Add a server with LANCache and a Counter-Strike 2 server for everyone.',
    'Do I have enough switch ports and addresses for 40 players?',
  ],
  game_server: [
    'Check this game server plan and tell me what to fix first.',
    'Add a Minecraft server for 12 players that my friends can join from outside.',
    'Which ports do I have to forward, and on which device?',
    'I am behind carrier-grade NAT. How can my friends still connect?',
  ],
};

/** How close to the end (px) the view must be to keep following new text. */
const FOLLOW_DISTANCE = 80;

const NO_MESSAGES: ChatMessage[] = [];

type ProposalItem = Extract<ChatItem, { kind: 'proposal' }>;

/**
 * The in-app assistant: a chat about the open build. The assistant reads the
 * build and can propose changes; a proposal shows up on the canvas, and only
 * the owner's Apply makes it part of the build.
 */
export function AssistantPanel({
  buildId,
  openingProposal,
  onReview,
  onProposal,
  reviewBusy,
  onApply,
  onReject,
  onShowChanges,
  onClose,
}: AssistantPanelProps) {
  const { data: settings, isLoading: settingsLoading } = useAssistantSettings();
  const { data: syncState, dataUpdatedAt } = useSyncState(buildId);
  // Suggestions fit what the open build is planned for.
  const examples = EXAMPLES[useBuilderStore.getState().buildKind] ?? EXAMPLES.homelab;

  const threadBuildId = useAssistantStore(state => state.buildId);
  const storedMessages = useAssistantStore(state => state.messages);
  const status = useAssistantStore(state => state.status);
  const full = useAssistantStore(state => state.full);
  const loadError = useAssistantStore(state => state.loadError);
  const draft = useAssistantStore(state => state.draft);
  const queued = useAssistantStore(state => state.queued);
  const proposalNotes = useAssistantStore(state => state.proposalNotes);
  const setDraft = useAssistantStore(state => state.setDraft);
  const loadThread = useAssistantStore(state => state.loadThread);
  const refreshThread = useAssistantStore(state => state.refreshThread);
  const sendMessage = useAssistantStore(state => state.send);
  const cancelQueued = useAssistantStore(state => state.cancelQueued);
  const stop = useAssistantStore(state => state.stop);
  const clear = useAssistantStore(state => state.clear);

  // The proposal that is open on the canvas, if any: its card can act on it.
  const reviewed = useBuilderStore(state => state.proposalPreview?.proposal);
  const reviewedNodes = useBuilderStore(state => state.proposalPreview?.changedNodeIds);
  const focusProposalNodes = useBuilderStore(state => state.focusProposalNodes);
  // What the next message can be about, and what is wrong with the build.
  const selected = useBuilderStore(state =>
    state.selectedNodeId
      ? state.hardwareNodes.find(node => node.id === state.selectedNodeId)
      : undefined,
  );
  const problems = useBuilderStore(state => state.validationIssues.length);

  const [confirmClear, setConfirmClear] = useState(false);
  // A selection the user took out of the message stays out until it changes.
  const [leftOut, setLeftOut] = useState<string | null>(null);
  const [away, setAway] = useState(false);
  const scroller = useRef<HTMLDivElement>(null);
  const content = useRef<HTMLDivElement>(null);
  const follow = useRef(true);

  // What is shown is what the server has: load it, and when the panel is
  // opened again later, look whether anything changed in the meantime.
  useEffect(() => {
    const seenBefore = useAssistantStore.getState().loadedBuildId === buildId;
    void loadThread(buildId);
    if (seenBefore) void refreshThread();
  }, [buildId, loadThread, refreshThread]);

  // The store may still hold another build's conversation for a moment.
  const mine = threadBuildId === buildId;
  const messages = mine ? storedMessages : NO_MESSAGES;
  const loading = !mine || status === 'loading';
  const busy = mine && status !== 'idle' && status !== 'loading';
  const activity = mine ? currentActivity({ status, messages }) : null;

  // Keep the newest text in view unless the user scrolled up to read.
  useEffect(() => {
    const element = scroller.current;
    if (element && follow.current) element.scrollTop = element.scrollHeight;
  }, [messages, activity]);

  // The conversation also grows without a new message: a proposal card opens
  // up when its review starts, and the panel itself changes height.
  useEffect(() => {
    const element = scroller.current;
    const inner = content.current;
    if (!element || !inner || typeof ResizeObserver === 'undefined') return;
    const observer = new ResizeObserver(() => {
      if (follow.current) element.scrollTop = element.scrollHeight;
    });
    observer.observe(inner);
    observer.observe(element);
    return () => observer.disconnect();
  }, []);

  const jumpToLatest = () => {
    const element = scroller.current;
    if (!element) return;
    follow.current = true;
    setAway(false);
    element.scrollTo({ top: element.scrollHeight, behavior: 'smooth' });
  };

  const ready = settings?.ready ?? false;
  const about = selected && selected.id !== leftOut ? selected : undefined;

  const send = async (text: string) => {
    const message = text.trim();
    if (!message || !ready) return;
    if (message === draft.trim()) setDraft('');
    follow.current = true;
    setAway(false);
    const accepted = await sendMessage(message, {
      selection: about ? [about.id] : undefined,
      prepare: async () => {
        // The assistant reads the saved build, so unsaved edits go first.
        const builder = useBuilderStore.getState();
        if (!builder.hasUnsavedChanges()) return;
        try {
          await builder.reassignAllIPs();
        } catch {
          toast.warning(
            'Your latest edits could not be saved, so the assistant sees the last saved version.',
          );
        }
      },
      onProposal,
    });
    // A refused message goes back into the box instead of being lost.
    if (!accepted && useAssistantStore.getState().draft === '') setDraft(message);
  };

  const clearChat = async () => {
    try {
      await clear();
    } catch (error) {
      toast.error(error instanceof Error && error.message ? error.message : 'Could not clear the chat.');
    }
  };

  const proposalStatus = (item: ProposalItem): { status: ProposalCardStatus; reason?: string } => {
    const { proposal, receivedAt } = item;
    // What was done here a moment ago is known before any poll says so.
    const note = proposalNotes[proposal.id];
    if (note && note.at >= dataUpdatedAt) return note;
    // Poll results fetched before the proposal arrived say nothing about it.
    if (!syncState || (receivedAt && dataUpdatedAt <= receivedAt)) {
      return note ?? { status: proposal.status };
    }
    if (syncState.pending?.id === proposal.id) return { status: 'pending' };
    const recent = syncState.recent.find(entry => entry.id === proposal.id);
    if (recent) return { status: recent.status, reason: recent.status_reason };
    if (note) return note;
    // A build has one open proposal at a time, so an older one has been settled.
    return { status: proposal.status === 'pending' ? 'closed' : proposal.status };
  };

  const renderProposal = (item: ProposalItem) => {
    const { status: cardStatus, reason } = proposalStatus(item);
    const open = reviewed?.id === item.proposal.id && reviewed.status === 'pending';
    const review: ProposalReview | undefined = open
      ? {
          changes: describeChanges(reviewed.diff),
          busy: reviewBusy,
          onApply,
          onReject,
          onLocate: () => focusProposalNodes(reviewedNodes ?? []),
          onShowAll: onShowChanges,
        }
      : undefined;
    return (
      <ProposalCard
        proposal={item.proposal}
        status={cardStatus}
        reason={reason}
        opening={openingProposal}
        onReview={onReview}
        review={cardStatus === 'pending' ? review : undefined}
      />
    );
  };

  const suggestions =
    ready && messages.length > 0 && problems > 0
      ? [`Fix ${problems} network ${problems === 1 ? 'problem' : 'problems'}`]
      : [];

  return (
    <div className="flex h-full min-h-0 flex-col" data-testid="assistant-panel">
      <header className="flex items-center gap-2 border-b px-3 py-2.5">
        <Sparkles className="size-4 shrink-0 text-primary" aria-hidden="true" />
        <div className="min-w-0 flex-1">
          <h2 className="text-sm font-semibold leading-tight">Assistant</h2>
          {settings?.model && (
            <p className="truncate text-xs text-muted-foreground" title={settings.model}>
              {settings.model}
            </p>
          )}
        </div>
        <Button
          variant="ghost"
          size="icon"
          className="size-8"
          onClick={() => setConfirmClear(true)}
          disabled={messages.length === 0 || status !== 'idle'}
          aria-label="Clear the chat"
          title="Clear the chat"
        >
          <Trash2 />
        </Button>
        <Button variant="ghost" size="icon" className="size-8" asChild>
          <Link to="/settings#assistant" aria-label="Assistant settings" title="Assistant settings">
            <Settings />
          </Link>
        </Button>
        <Button
          variant="ghost"
          size="icon"
          className="size-8"
          onClick={onClose}
          aria-label="Close the assistant"
          title="Close"
        >
          <X />
        </Button>
      </header>

      <div className="relative min-h-0 flex-1">
        <div
          ref={scroller}
          // Positioned, so that labels for screen readers inside the list (they are
          // absolutely positioned) scroll with it instead of sticking out of it.
          className="relative h-full overflow-y-auto px-3 py-3"
          onScroll={event => {
            const element = event.currentTarget;
            const near =
              element.scrollHeight - element.scrollTop - element.clientHeight < FOLLOW_DISTANCE;
            follow.current = near;
            if (away === near) setAway(!near);
          }}
        >
          <div ref={content}>
          {settingsLoading || (loading && !loadError) ? (
            <p className="flex items-center justify-center gap-2 py-8 text-sm text-muted-foreground">
              <Loader2 className="size-4 animate-spin" aria-hidden="true" />
              Loading…
            </p>
          ) : loadError ? (
            <div className="space-y-2 py-8 text-center text-sm">
              <p className="text-destructive">{loadError}</p>
              <Button size="sm" variant="outline" onClick={() => void loadThread(buildId, true)}>
                Try again
              </Button>
            </div>
          ) : (
            <>
              {!ready && (
                <div className="mb-4 space-y-2 rounded-md border border-amber-500/40 bg-amber-500/10 p-3 text-sm">
                  <p className="font-medium">Finish setting up the assistant</p>
                  <p className="text-xs text-muted-foreground">
                    Choose a provider and a model, and enter your API key. The key is stored
                    encrypted; the settings page shows exactly how.
                  </p>
                  <Button size="sm" asChild>
                    <Link to="/settings#assistant">Open assistant settings</Link>
                  </Button>
                </div>
              )}
              {messages.length === 0 ? (
                <div className="space-y-3 py-4">
                  <p className="text-sm text-muted-foreground">
                    Ask about this build or describe what you want to change. The assistant can
                    read the build and the catalogs. It cannot change anything by itself: what it
                    suggests appears on the canvas as a preview, and you apply or reject it.
                  </p>
                  {ready && (
                    <ul className="space-y-1.5">
                      {examples.map(example => (
                        <li key={example}>
                          <button
                            type="button"
                            onClick={() => setDraft(example)}
                            className="w-full rounded-md border px-3 py-2 text-left text-sm transition-colors hover:cursor-pointer hover:bg-accent focus-visible:outline-none focus-visible:ring-1 focus-visible:ring-ring"
                          >
                            {example}
                          </button>
                        </li>
                      ))}
                    </ul>
                  )}
                </div>
              ) : (
                <MessageList messages={messages} activity={activity} renderProposal={renderProposal} />
              )}
            </>
          )}
          </div>
        </div>
        {away && messages.length > 0 && (
          <Button
            size="sm"
            variant="secondary"
            onClick={jumpToLatest}
            className="absolute bottom-2 left-1/2 h-7 -translate-x-1/2 gap-1 rounded-full px-3 text-xs shadow-md"
          >
            <ArrowDown aria-hidden="true" />
            Jump to latest
          </Button>
        )}
      </div>

      {mine && full && (
        <p className="border-t bg-amber-500/10 px-3 py-2 text-xs">
          This conversation reached its length limit. Clear the chat to start a new one; your
          build and its proposals are not affected.
        </p>
      )}
      <Composer
        value={draft}
        onChange={setDraft}
        onSend={() => void send(draft)}
        onStop={stop}
        status={mine ? status : 'idle'}
        disabled={!ready || loading || (mine && full)}
        placeholder={ready ? 'Ask about this build…' : 'Set up the assistant to start chatting'}
        about={
          about && ready
            ? { label: about.name || about.type, onClear: () => setLeftOut(about.id) }
            : undefined
        }
        queued={busy && queued ? { text: queued.text, onCancel: cancelQueued } : undefined}
        suggestions={suggestions}
        onSuggestion={() =>
          void send('Check the network problems in this build and propose a fix for them.')
        }
      />

      <ConfirmDialog
        open={confirmClear}
        onOpenChange={setConfirmClear}
        title="Clear this chat?"
        description="The conversation about this build is deleted. The build and its proposals stay as they are."
        confirmLabel="Clear chat"
        onConfirm={() => void clearChat()}
      />
    </div>
  );
}
