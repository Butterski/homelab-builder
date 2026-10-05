import { Link } from 'react-router-dom';
import { CircleAlert, Info } from 'lucide-react';
import type { ChatItem, ChatMessage } from '../store/assistant-store';
import { MessageMarkdown } from './message-markdown';
import { ProposalCard, type ProposalCardStatus } from './proposal-card';
import { ToolCallChip } from './tool-call-chip';

type ProposalItem = Extract<ChatItem, { kind: 'proposal' }>;

type MessageListProps = {
  messages: ChatMessage[];
  /** True while the last message is still being written. */
  streaming: boolean;
  proposalStatus: (item: ProposalItem) => ProposalCardStatus;
  /** True while a proposal review is being opened. */
  openingProposal: boolean;
  onReview: (proposalId: string) => void;
};

/** Failures the user fixes in Settings rather than by asking again. */
const SETTINGS_CODES = new Set(['assistant_not_configured', 'assistant_disabled', 'auth', 'model']);

function Item({
  item,
  proposalStatus,
  openingProposal,
  onReview,
}: { item: ChatItem } & Pick<MessageListProps, 'proposalStatus' | 'openingProposal' | 'onReview'>) {
  switch (item.kind) {
    case 'text':
      return <MessageMarkdown text={item.text} />;
    case 'tool':
      return <ToolCallChip step={item.step} />;
    case 'proposal':
      return (
        <ProposalCard
          proposal={item.proposal}
          status={proposalStatus(item)}
          opening={openingProposal}
          onReview={onReview}
        />
      );
    case 'notice':
      return (
        <p className="flex items-start gap-1.5 text-xs text-muted-foreground">
          <Info className="mt-px size-3.5 shrink-0" aria-hidden="true" />
          <span>{item.text}</span>
        </p>
      );
    case 'error':
      return (
        <div
          role="alert"
          className="flex items-start gap-2 rounded-md border border-destructive/40 bg-destructive/10 px-2.5 py-2 text-xs"
        >
          <CircleAlert className="mt-px size-3.5 shrink-0 text-destructive" aria-hidden="true" />
          <span>
            {item.text}
            {item.code && SETTINGS_CODES.has(item.code) && (
              <>
                {' '}
                <Link to="/settings#assistant" className="text-primary underline underline-offset-2">
                  Open assistant settings
                </Link>
              </>
            )}
          </span>
        </div>
      );
  }
}

/** The conversation: the user's messages and, per turn, everything the assistant did. */
export function MessageList({
  messages,
  streaming,
  proposalStatus,
  openingProposal,
  onReview,
}: MessageListProps) {
  return (
    <ol className="space-y-4" aria-label="Conversation">
      {messages.map((message, index) => {
        if (message.role === 'user') {
          const text = message.items.map(item => ('text' in item ? item.text : '')).join('\n\n');
          return (
            <li key={message.id} className="flex justify-end">
              <p className="max-w-[88%] whitespace-pre-wrap break-words rounded-lg bg-primary/15 px-3 py-2 text-sm">
                {text}
              </p>
            </li>
          );
        }
        const working = streaming && index === messages.length - 1;
        return (
          <li key={message.id} className="space-y-2 text-sm" data-testid="assistant-message">
            {message.items.map((item, position) => (
              <Item
                key={item.kind === 'tool' ? `tool-${item.step.id}` : position}
                item={item}
                proposalStatus={proposalStatus}
                openingProposal={openingProposal}
                onReview={onReview}
              />
            ))}
            {working && (
              <p className="flex items-center gap-1.5 text-xs text-muted-foreground" role="status">
                <span className="assistant-working-dot" aria-hidden="true" />
                Working…
              </p>
            )}
          </li>
        );
      })}
    </ol>
  );
}
