import { useQuery, useQueryClient } from '@tanstack/react-query';
import { useCallback } from 'react';
import { buildApi, type Build } from './builds';

/** The one cache entry for the user's projects. */
export const buildsKey = ['builds'] as const;

/**
 * The user's projects. Every place that lists them (the Projects page, the
 * sidebar's switcher, Settings, the profile) reads this one query, so a
 * project that is created, renamed or deleted in one place is right in all of
 * them without another request.
 *
 * `fresh` asks the server again whenever the caller mounts; without it a list
 * younger than half a minute is used as it is.
 */
export function useBuilds({ enabled = true, fresh = false }: { enabled?: boolean; fresh?: boolean } = {}) {
  return useQuery({
    queryKey: buildsKey,
    queryFn: () => buildApi.list(),
    enabled,
    staleTime: 30_000,
    refetchOnMount: fresh ? 'always' : true,
  });
}

/** Changes the cached list in place, after a project was created, changed or deleted. */
export function useUpdateBuilds() {
  const queryClient = useQueryClient();
  return useCallback(
    (update: (builds: Build[]) => Build[]) =>
      queryClient.setQueryData<Build[]>(buildsKey, current => update(current ?? [])),
    [queryClient],
  );
}
