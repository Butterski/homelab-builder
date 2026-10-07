import { afterEach, describe, expect, it, vi } from 'vitest';
import { WORKSPACE_STORAGE_KEY, forgetWorkspace, workspaceStorage } from './workspace-storage';

const remembered = (projectName: string) => ({
  state: { currentBuildId: 'build-1', projectName, buildKind: 'homelab' },
  version: 0,
});

describe('workspace storage', () => {
  afterEach(() => {
    vi.restoreAllMocks();
    localStorage.clear();
  });

  it('writes what the store remembers', () => {
    workspaceStorage!.setItem(WORKSPACE_STORAGE_KEY, remembered('Lab'));

    expect(JSON.parse(localStorage.getItem(WORKSPACE_STORAGE_KEY)!)).toEqual(remembered('Lab'));
    expect(workspaceStorage!.getItem(WORKSPACE_STORAGE_KEY)).toEqual(remembered('Lab'));
  });

  it('does not write again what is already there', () => {
    // The store saves after every change of anything in it: every frame of a drag.
    const write = vi.spyOn(localStorage, 'setItem');

    for (let frame = 0; frame < 60; frame++) {
      workspaceStorage!.setItem(WORKSPACE_STORAGE_KEY, remembered('Lab'));
    }
    expect(write).toHaveBeenCalledTimes(1);

    workspaceStorage!.setItem(WORKSPACE_STORAGE_KEY, remembered('Lab, renamed'));
    expect(write).toHaveBeenCalledTimes(2);
  });

  it('writes again after the workspace was forgotten', () => {
    workspaceStorage!.setItem(WORKSPACE_STORAGE_KEY, remembered('Lab'));
    forgetWorkspace();
    expect(localStorage.getItem(WORKSPACE_STORAGE_KEY)).toBeNull();

    workspaceStorage!.setItem(WORKSPACE_STORAGE_KEY, remembered('Lab'));
    expect(localStorage.getItem(WORKSPACE_STORAGE_KEY)).not.toBeNull();
  });
});
