import { useCallback, useEffect } from 'react';
import { ApiError } from '../../../lib/api';
import type { BuildKind } from '../../../types';
import { useBuilderStore } from '../store/builder-store';

export type CurrentProject = {
  /** The open project, or null when there is none. */
  id: string | null;
  name: string;
  kind: BuildKind;
  /** The project's canvas is in the store and can be read. */
  ready: boolean;
  /** A project is open but its canvas is still being fetched. */
  loading: boolean;
  /** The canvas could not be fetched; `retry` tries again. */
  failed: boolean;
  retry: () => void;
};

/** Builds being fetched right now, so two pages asking at once cause one request. */
const opening = new Set<string>();

function open(id: string) {
  if (opening.has(id)) return;
  opening.add(id);
  useBuilderStore
    .getState()
    .openBuild(id)
    .catch(error => {
      // Deleted elsewhere, or not ours: then there is no current project.
      const gone = error instanceof ApiError && (error.status === 404 || error.status === 403);
      if (gone && useBuilderStore.getState().currentBuildId === id) {
        useBuilderStore.getState().clearCurrentBuild();
      }
    })
    .finally(() => opening.delete(id));
}

/**
 * The project the user is working on, for pages outside the builder.
 *
 * Which project is open survives a page reload; its canvas does not, because
 * a copy kept in the browser goes stale. With `load` (the default) this fetches
 * the canvas when it is missing.
 */
export function useCurrentProject({ load = true }: { load?: boolean } = {}): CurrentProject {
  const id = useBuilderStore(state => state.currentBuildId);
  const status = useBuilderStore(state => state.buildStatus);
  const name = useBuilderStore(state => state.projectName);
  const kind = useBuilderStore(state => state.buildKind);

  useEffect(() => {
    if (load && id && status === 'idle') open(id);
  }, [load, id, status]);

  const retry = useCallback(() => {
    if (id) open(id);
  }, [id]);

  return {
    id,
    name,
    kind,
    ready: !!id && status === 'ready',
    loading: !!id && (status === 'loading' || (load && status === 'idle')),
    failed: !!id && status === 'error',
    retry,
  };
}
