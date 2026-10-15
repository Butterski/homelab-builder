import type { DropReason, WhatsNewNotice } from '../api/whats-new';

/** Why a cable was removed, said after "removed, ". */
const REASON_TEXT: Record<DropReason, (source: string, target: string) => string> = {
  no_power_input: (_, target) => `${target} takes no power cable`,
  inputs_in_use: (_, target) => `every power input of ${target} was already plugged in`,
  already_connected: () => 'a power cable already joins the two',
  loop: () => 'it would have closed a power loop',
  no_socket: source => `${source} has no free socket`,
};

/** The kinds of notice this app can show. */
const KNOWN_KINDS: Record<string, true> = { power_cables: true };

/** One line per cable of a notice: the converted ones first, then the removed ones with why. */
export function noticeLines(notice: WhatsNewNotice): string[] {
  const { converted, dropped } = notice.details;
  return [
    ...converted.map(cable => `${cable.source} to ${cable.target}: now a power cable`),
    ...dropped.map(cable => {
      const reason = REASON_TEXT[cable.reason]?.(cable.source, cable.target);
      return `${cable.source} to ${cable.target}: removed${reason ? `, ${reason}` : ''}`;
    }),
  ];
}

/**
 * The devices to bring into view for a notice: both ends of its converted
 * cables, or of the removed ones when nothing was converted.
 */
export function noticeFocusIds(notice: WhatsNewNotice): string[] {
  const { converted, dropped } = notice.details;
  const cables = converted.length > 0 ? converted : dropped;
  return [...new Set(cables.flatMap(cable => [cable.source_id, cable.target_id]))];
}

/**
 * The notices the dialog lists: those of a kind it knows that say something,
 * and of those only the unseen ones unless the dialog was opened by hand.
 */
export function noticesToShow(notices: WhatsNewNotice[], all: boolean): WhatsNewNotice[] {
  return notices.filter(
    notice =>
      KNOWN_KINDS[notice.kind] &&
      (all || notice.seen_at === null) &&
      notice.details.converted.length + notice.details.dropped.length > 0,
  );
}
