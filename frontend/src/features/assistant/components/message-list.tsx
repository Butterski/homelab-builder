import type { ReactNode } from 'react';
import { Link } from 'react-router-dom';
import { CircleAlert, Info } from 'lucide-react';
import type { ChatItem, ChatMessage, ToolStep } from '../store/assistant-store';
import { ActivityTimeline } from './activity-timeline';
import { MessageMarkdown } from './message-markdown';

type ProposalItem = Extract<ChatItem, { kind: 'proposal' }>;

type MessageListProps = {
  messages: ChatMessage[];
  /** What the assistant is doing right now; null when the last message is finished. */
  activity: string | null;
  renderProposal: (item: ProposalItem) => ReactNode;
};

/** Failures the user fixes in Settings rather than by asking again. */
const SETTINGS_CODES = new Set(['assistant_not_configured', 'assistant_disabled', 'auth', 'model']);

/** What a turn consists of, with the steps between two pieces of text taken together. */
type Block = { kind: 'steps'; steps: ToolStep[] } | { kind: 'item'; item: Exclude<ChatItem, { kind: 'tool' }> };

function blocksOf(items: ChatItem[]): Block[] {
  const blocks: Block[] = [];
  for (const item of items) {
    const last = blocks[blocks.length - 1];
    if (item.kind === 'tool') {
      if (last?.kind === 'steps') last.steps.push(item.step);
      else blocks.push({ kind: 'steps', steps: [item.step] });
    } else {
      blocks.push({ kind: 'item', item });
    }
  }
  return blocks;
}

function Item({
  item,
  renderProposal,
}: {
  item: Exclude<ChatItem, { kind: 'tool' }>;
  renderProposal: MessageListProps['renderProposal'];
}) {
  switch (item.kind) {
    case 'text':
      return <MessageMarkdown text={item.text} />;
    case 'proposal':
      return <>{renderProposal(item)}</>;
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
export function MessageList({ messages, activity, renderProposal }: MessageListProps) {
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
        const working = activity !== null && index === messages.length - 1;
        const blocks = blocksOf(message.items);
        return (
          <li key={message.id} className="space-y-2 text-sm" data-testid="assistant-message">
            {blocks.map((block, position) =>
              block.kind === 'steps' ? (
                <ActivityTimeline
                  key={`steps-${block.steps[0].key}`}
                  steps={block.steps}
                  // The last run of steps of a running turn may still grow.
                  live={working && position === blocks.length - 1}
                />
              ) : (
                <Item key={position} item={block.item} renderProposal={renderProposal} />
              ),
            )}
            {working && (
              <p className="flex items-center gap-1.5 text-xs text-muted-foreground" role="status">
                <span className="assistant-working-dot" aria-hidden="true" />
                {activity}
              </p>
            )}
          </li>
        );
      })}
    </ol>
  );
}
