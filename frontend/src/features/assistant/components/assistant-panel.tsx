import { useEffect, useRef, useState } from 'react';
import { Link } from 'react-router-dom';
import { Loader2, Settings, Sparkles, Trash2, X } from 'lucide-react';
import { toast } from 'sonner';
import { Button } from '@/components/ui/button';
import { ConfirmDialog } from '@/components/ui/confirm-dialog';
import { useSyncState } from '@/features/builder/api/proposals';
import { useBuilderStore } from '@/features/builder/store/builder-store';
import { useAssistantSettings } from '@/features/settings/api/assistant-settings';
import type { BuildKind } from '@/types';
import { useAssistantStore, type ChatItem, type ChatMessage } from '../store/assistant-store';
import { Composer } from './composer';
import { MessageList } from './message-list';
import type { ProposalCardStatus } from './proposal-card';

type AssistantPanelProps = {
  buildId: string;
  /** True while a proposal review is being opened. */
  openingProposal: boolean;
  onReview: (proposalId: string) => void;
  /** Called when the assistant created a proposal, so the builder can pick it up at once. */
  onProposal: () => void;
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

/**
 * The in-app assistant: a chat about the open build. The assistant reads the
 * build and can propose changes; applying one always goes through the review.
 */
export function AssistantPanel({
  buildId,
  openingProposal,
  onReview,
  onProposal,
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
  const setDraft = useAssistantStore(state => state.setDraft);
  const loadThread = useAssistantStore(state => state.loadThread);
  const sendMessage = useAssistantStore(state => state.send);
  const stop = useAssistantStore(state => state.stop);
  const clear = useAssistantStore(state => state.clear);

  const [confirmClear, setConfirmClear] = useState(false);
  const scroller = useRef<HTMLDivElement>(null);
  const follow = useRef(true);

  useEffect(() => {
    void loadThread(buildId);
  }, [buildId, loadThread]);

  // The store may still hold another build's conversation for a moment.
  const mine = threadBuildId === buildId;
  const messages = mine ? storedMessages : NO_MESSAGES;
  const streaming = mine && status === 'streaming';
  const loading = !mine || status === 'loading';

  // Keep the newest text in view unless the user scrolled up to read.
  useEffect(() => {
    const element = scroller.current;
    if (element && follow.current) element.scrollTop = element.scrollHeight;
  }, [messages]);

  const ready = settings?.ready ?? false;

  const send = async () => {
    const text = draft.trim();
    if (!text || !ready) return;
    setDraft('');
    follow.current = true;
    const accepted = await sendMessage(text, {
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
    if (!accepted && useAssistantStore.getState().draft === '') setDraft(text);
  };

  const clearChat = async () => {
    try {
      await clear();
    } catch (error) {
      toast.error(error instanceof Error && error.message ? error.message : 'Could not clear the chat.');
    }
  };

  const proposalStatus = (item: Extract<ChatItem, { kind: 'proposal' }>): ProposalCardStatus => {
    const { proposal, receivedAt } = item;
    // Poll results fetched before the proposal arrived say nothing about it.
    if (!syncState || (receivedAt && dataUpdatedAt <= receivedAt)) return proposal.status;
    if (syncState.pending?.id === proposal.id) return 'pending';
    const recent = syncState.recent.find(entry => entry.id === proposal.id);
    if (recent) return recent.status;
    // A build has one open proposal at a time, so an older one has been settled.
    return proposal.status === 'pending' ? 'closed' : proposal.status;
  };

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

      <div
        ref={scroller}
        className="min-h-0 flex-1 overflow-y-auto px-3 py-3"
        onScroll={event => {
          const element = event.currentTarget;
          follow.current =
            element.scrollHeight - element.scrollTop - element.clientHeight < FOLLOW_DISTANCE;
        }}
      >
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
                  Ask about this build or describe what you want to change. The assistant can read
                  the build and the catalogs. It cannot change anything by itself: it sends a
                  proposal, and you apply or reject it.
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
              <MessageList
                messages={messages}
                streaming={streaming}
                proposalStatus={proposalStatus}
                openingProposal={openingProposal}
                onReview={onReview}
              />
            )}
          </>
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
        onSend={() => void send()}
        onStop={stop}
        streaming={streaming}
        disabled={!ready || loading || (mine && full)}
        placeholder={ready ? 'Ask about this build…' : 'Set up the assistant to start chatting'}
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
