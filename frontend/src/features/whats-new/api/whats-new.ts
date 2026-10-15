import { useMutation, useQuery, useQueryClient } from '@tanstack/react-query';
import { api } from '@/lib/api';

/** Why the server removed an old cable instead of turning it into a power cable. */
export type DropReason =
  | 'no_power_input'
  | 'inputs_in_use'
  | 'already_connected'
  | 'loop'
  | 'no_socket';

/** One cable of a notice: `source` feeds, `target` is fed. */
export type NoticeCable = {
  source_id: string;
  source: string;
  target_id: string;
  target: string;
};

export type DroppedCable = NoticeCable & { reason: DropReason };

/** What the server changed in one build when it started a new version. */
export type WhatsNewNotice = {
  id: string;
  /** Only `power_cables` so far; a kind this app does not know is not shown. */
  kind: string;
  version: string;
  /** Null when the project was deleted since. */
  build_id: string | null;
  build_name: string;
  created_at: string;
  seen_at: string | null;
  details: { converted: NoticeCable[]; dropped: DroppedCable[] };
};

export type WhatsNewState = {
  /** The last release whose notes this account saw; "" when it never saw any. */
  seen: string;
  /** Newest first, seen ones included. */
  notices: WhatsNewNotice[];
};

export const WHATS_NEW_KEY = ['whats-new'];

/** What the signed-in account has seen. Without a user nothing is fetched (a visitor has no account). */
export function useWhatsNew(userId: string | undefined) {
  return useQuery({
    queryKey: [...WHATS_NEW_KEY, userId],
    queryFn: () => api.get<WhatsNewState>('/api/whats-new'),
    enabled: !!userId,
    // It changes only when this account marks something seen.
    staleTime: Infinity,
  });
}

/** Records a release as seen, and with it every notice of the account. */
export function useMarkWhatsNewSeen() {
  const qc = useQueryClient();
  return useMutation({
    mutationFn: (version: string) => api.post<void>('/api/whats-new/seen', { version }),
    onSuccess: () => qc.invalidateQueries({ queryKey: WHATS_NEW_KEY }),
  });
}
