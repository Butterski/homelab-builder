import { useId, useRef, useState, useEffect, type KeyboardEvent } from 'react';
import { useNavigate } from 'react-router-dom';
import { Button } from '@/components/ui/button';
import {
  Dialog,
  DialogContent,
  DialogDescription,
  DialogFooter,
  DialogHeader,
  DialogTitle,
} from '@/components/ui/dialog';
import { useAuth } from '@/features/auth/hooks/use-auth';
import { useBuilderStore } from '@/features/builder/store/builder-store';
import { APP_VERSION } from '@/lib/version';
import { cn } from '@/lib/utils';
import {
  useMarkWhatsNewSeen,
  useWhatsNew,
  type WhatsNewNotice,
  type WhatsNewState,
} from '../api/whats-new';
import { noticeFocusIds, noticeLines, noticesToShow } from '../lib/notices';
import {
  currentRelease,
  releasesToShow,
  type Release,
  type ReleaseEntry,
} from '../lib/releases';
import { useWhatsNewStore } from '../store/whats-new-store';

/** Stands in while the account's state is on its way, or could not be read. */
const NOTHING_NEW: WhatsNewState = { seen: APP_VERSION, notices: [] };

/** A release this account has not seen, or a change in one of its projects it was not shown. */
function hasNews(state: WhatsNewState): boolean {
  return state.seen !== APP_VERSION || state.notices.some(notice => notice.seen_at === null);
}

/**
 * The What's new dialog, mounted once in the app shell for a signed-in user.
 * It opens by itself once the account's state has loaded and something is new
 * to it, and from the account menu. Whichever way it closes, the running
 * version is recorded as seen, once, if anything shown was new.
 */
export function WhatsNew() {
  const { user } = useAuth();
  const userId = user?.id;
  const { data, isError } = useWhatsNew(userId);
  const openedBy = useWhatsNewStore(state => state.openedBy);
  const open = useWhatsNewStore(state => state.open);
  const close = useWhatsNewStore(state => state.close);
  const markSeen = useMarkWhatsNewSeen();
  // Per account: it opens by itself once a page load, and posts once.
  const checkedFor = useRef<string | null>(null);
  const postedFor = useRef<string | null>(null);

  useEffect(() => {
    if (!data || !userId || checkedFor.current === userId) return;
    checkedFor.current = userId;
    const somethingToShow =
      releasesToShow(data.seen, APP_VERSION).length > 0 ||
      noticesToShow(data.notices, false).length > 0;
    if (hasNews(data) && somethingToShow) open('auto');
  }, [data, open, userId]);

  // Opened by hand, it waits for the account's state, so "In your projects"
  // does not appear under the reader; without it, it shows the notes alone.
  if (!openedBy || !userId || (!data && !isError)) return null;

  const state = data ?? NOTHING_NEW;
  const finish = () => {
    if (hasNews(state) && postedFor.current !== userId) {
      postedFor.current = userId;
      markSeen.mutate(APP_VERSION, {
        onError: () => {
          postedFor.current = null;
        },
      });
    }
    close();
  };

  const byHand = openedBy === 'hand';
  return (
    <WhatsNewDialog
      releases={byHand ? currentRelease(APP_VERSION) : releasesToShow(state.seen, APP_VERSION)}
      notices={noticesToShow(state.notices, byHand)}
      onClose={finish}
    />
  );
}

type RailItem =
  | { id: string; label: string; kind: 'projects' }
  | { id: string; label: string; kind: 'entry'; entry: ReleaseEntry; release: Release };

/** major.minor of a release: "1.4.0" is 1.4. */
const shortVersion = (version: string) => version.split('.').slice(0, 2).join('.');

function WhatsNewDialog({
  releases,
  notices,
  onClose,
}: {
  releases: Release[];
  notices: WhatsNewNotice[];
  onClose: () => void;
}) {
  const headline = releases[0] ?? currentRelease(APP_VERSION)[0];
  const several = releases.length > 1;
  const items: RailItem[] = [
    ...(notices.length > 0
      ? [{ id: 'projects', label: 'In your projects', kind: 'projects' as const }]
      : []),
    ...releases.flatMap(release =>
      release.entries.map(entry => ({
        id: `${release.version}:${entry.id}`,
        label: entry.title,
        kind: 'entry' as const,
        entry,
        release,
      })),
    ),
  ];
  const [index, setIndex] = useState(0);
  const buttons = useRef<(HTMLButtonElement | null)[]>([]);
  const headingId = useId();
  const shown = items[Math.min(index, items.length - 1)];
  const last = items.length - 1;

  const go = (next: number, focus: boolean) => {
    const target = Math.max(0, Math.min(last, next));
    setIndex(target);
    if (focus) buttons.current[target]?.focus();
  };

  const onRailKey = (event: KeyboardEvent<HTMLDivElement>) => {
    const moves: Record<string, number> = {
      ArrowDown: index + 1,
      ArrowRight: index + 1,
      ArrowUp: index - 1,
      ArrowLeft: index - 1,
      Home: 0,
      End: last,
    };
    if (!Object.hasOwn(moves, event.key)) return;
    event.preventDefault();
    go(moves[event.key], true);
  };

  return (
    <Dialog open onOpenChange={open => !open && onClose()}>
      <DialogContent className="max-h-[92vh] max-w-4xl overflow-y-auto">
        <DialogHeader className="pr-8">
          <DialogTitle className="text-xl">
            {headline ? `What's new in ${shortVersion(headline.version)}` : "What's new"}
          </DialogTitle>
          {headline && <DialogDescription>{headline.lead}</DialogDescription>}
        </DialogHeader>

        {shown && (
          <div className="grid gap-5 border-t pt-5 md:grid-cols-[12rem_minmax(0,1fr)] md:gap-8">
            <div
              role="group"
              aria-label="Entries"
              onKeyDown={onRailKey}
              className="-mx-1 flex gap-2 overflow-x-auto px-1 pb-1 md:mx-0 md:grid md:content-start md:gap-0.5 md:overflow-visible md:px-0 md:pb-0"
            >
              {items.map((item, at) => {
                const selected = item === shown;
                const opensRelease =
                  several && item.kind === 'entry' && item.release.entries[0] === item.entry;
                return (
                  <div key={item.id} className="contents">
                    {opensRelease && (
                      <p
                        className={cn(
                          'hidden px-2.5 pb-1 text-xs text-muted-foreground md:block',
                          at > 0 && 'pt-3',
                        )}
                      >
                        {shortVersion(item.release.version)}
                      </p>
                    )}
                    <button
                      ref={element => {
                        buttons.current[at] = element;
                      }}
                      type="button"
                      aria-pressed={selected}
                      aria-current={selected ? 'true' : undefined}
                      onClick={() => go(at, false)}
                      className={cn(
                        'app-filter md:min-h-9 md:w-full md:justify-between md:whitespace-normal md:border-transparent md:px-2.5 md:text-left md:text-sm',
                        selected ? 'md:bg-muted md:font-medium' : 'md:hover:bg-muted/50',
                      )}
                    >
                      {item.label}
                      {item.kind === 'projects' && (
                        <span className="app-count">{notices.length}</span>
                      )}
                    </button>
                  </div>
                );
              })}
            </div>

            <section aria-labelledby={headingId} className="grid min-w-0 content-start gap-3 md:min-h-72">
              {shown.kind === 'projects' ? (
                <InYourProjects headingId={headingId} notices={notices} onClose={onClose} />
              ) : (
                <Entry
                  headingId={headingId}
                  entry={shown.entry}
                  version={several ? shortVersion(shown.release.version) : null}
                  onClose={onClose}
                />
              )}
            </section>
          </div>
        )}

        <DialogFooter className="gap-2 border-t pt-4 sm:space-x-0">
          <Button variant="outline" onClick={() => go(index - 1, false)} disabled={index <= 0}>
            Previous
          </Button>
          <Button variant="outline" onClick={() => go(index + 1, false)} disabled={index >= last}>
            Next
          </Button>
          <Button onClick={onClose}>Done</Button>
        </DialogFooter>
      </DialogContent>
    </Dialog>
  );
}

/** A paragraph of the notes; what stands between backticks is a command, set as typed. */
function Paragraph({ text }: { text: string }) {
  return (
    <p className="text-sm leading-relaxed">
      {text.split('`').map((part, at) =>
        at % 2 === 1 ? (
          <code key={at} className="app-figure">
            {part}
          </code>
        ) : (
          part
        ),
      )}
    </p>
  );
}

function Entry({
  headingId,
  entry,
  version,
  onClose,
}: {
  headingId: string;
  entry: ReleaseEntry;
  /** Said when the dialog shows more than one release. */
  version: string | null;
  onClose: () => void;
}) {
  const navigate = useNavigate();
  const currentBuildId = useBuilderStore(state => state.currentBuildId);
  const show = entry.show;
  // The canvas is offered only when there is a project to show it in.
  const canShow = !!show && (show.kind === 'route' || !!currentBuildId);

  const showMe = () => {
    if (!show) return;
    if (show.kind === 'route') {
      onClose();
      navigate(show.to);
      return;
    }
    if (!currentBuildId) return;
    if (show.types.length > 0) {
      useBuilderStore
        .getState()
        .setPendingFocus({ buildId: currentBuildId, types: show.types, select: true });
    }
    onClose();
    navigate(`/builder/${currentBuildId}`);
  };

  return (
    <>
      <div>
        {version && <p className="text-xs text-muted-foreground">In {version}</p>}
        <h3 id={headingId} className="text-lg font-semibold">
          {entry.title}
        </h3>
      </div>
      <Paragraph text={entry.body} />
      {canShow && (
        <div>
          <Button variant="secondary" size="sm" onClick={showMe}>
            Show me
          </Button>
        </div>
      )}
    </>
  );
}

function InYourProjects({
  headingId,
  notices,
  onClose,
}: {
  headingId: string;
  notices: WhatsNewNotice[];
  onClose: () => void;
}) {
  const navigate = useNavigate();

  const showNotice = (buildId: string, notice: WhatsNewNotice) => {
    useBuilderStore.getState().setPendingFocus({ buildId, ids: noticeFocusIds(notice) });
    onClose();
    navigate(`/builder/${buildId}`);
  };

  return (
    <>
      <h3 id={headingId} className="text-lg font-semibold">
        In your projects
      </h3>
      <p className="text-sm leading-relaxed">
        Cables from before power wiring were turned into power cables when this version started.
        A UPS used to take a network cable that stood for its power feed; it has sockets now.
      </p>
      <div className="grid gap-4 pt-1">
        {notices.map(notice => {
          const buildId = notice.build_id;
          return (
            <section
              key={notice.id}
              aria-label={notice.build_name}
              className="grid gap-2 border-t pt-3"
            >
              <div className="flex items-center justify-between gap-3">
                <h4 className="min-w-0 truncate text-sm font-medium">
                  {notice.build_name}
                  {!buildId && (
                    <span className="font-normal text-muted-foreground"> (project deleted)</span>
                  )}
                </h4>
                {buildId && (
                  <Button
                    variant="secondary"
                    size="sm"
                    aria-label={`Show ${notice.build_name}`}
                    onClick={() => showNotice(buildId, notice)}
                  >
                    Show
                  </Button>
                )}
              </div>
              <ul className="grid gap-1 text-sm text-muted-foreground">
                {noticeLines(notice).map((line, at) => (
                  <li key={at}>{line}</li>
                ))}
              </ul>
            </section>
          );
        })}
      </div>
    </>
  );
}
