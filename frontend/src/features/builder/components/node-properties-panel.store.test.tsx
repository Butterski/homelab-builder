import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import { act, fireEvent, render, screen } from '@testing-library/react';
import { QueryClient, QueryClientProvider } from '@tanstack/react-query';
import type { HardwareNode } from '../../../types';

// Requests never answer: the panel's lists stay empty, the form is what is tested.
vi.mock('@/lib/api', () => ({
  api: { get: () => new Promise(() => {}) },
  ApiError: class ApiError extends Error {},
  authHeaders: () => ({}),
}));
vi.mock('@/features/builder/api/builds', () => ({ buildApi: {} }));
vi.mock('@/features/builder/api/proposals', () => ({ proposalApi: {} }));

import { useBuilderStore } from '../store/builder-store';
import { NodePropertiesPanel } from './node-properties-panel';

const nas: HardwareNode = {
  id: 'nas',
  type: 'nas',
  name: 'Storage NAS',
  ip: '192.168.1.100',
  x: 0,
  y: 0,
  details: { model: 'Synology DS923+', ram: 4, storage: 12000 },
};

const stored = () => useBuilderStore.getState().hardwareNodes.find(node => node.id === 'nas');

// The form writes itself back to the store half a second after it changes. It
// changes when a device is selected too, and that write must carry the
// device's own values: selecting a device once wrote the empty form over it.
describe('NodePropertiesPanel on the builder store', () => {
  beforeEach(() => {
    vi.useFakeTimers();
    useBuilderStore.getState().clearCurrentBuild();
    useBuilderStore.setState({ hardwareNodes: [nas], selectedNodeId: null });
    render(
      <QueryClientProvider client={new QueryClient()}>
        <NodePropertiesPanel />
      </QueryClientProvider>,
    );
  });

  afterEach(() => {
    vi.useRealTimers();
  });

  it('leaves a device as it is when it is only selected', () => {
    act(() => useBuilderStore.getState().selectNode('nas'));
    act(() => vi.advanceTimersByTime(1000));

    expect(stored()).toMatchObject({
      name: 'Storage NAS',
      ip: '192.168.1.100',
      details: { model: 'Synology DS923+', ram: 4, storage: 12000 },
    });
  });

  it('saves an edit of the form to the selected device', () => {
    act(() => useBuilderStore.getState().selectNode('nas'));
    fireEvent.change(screen.getByDisplayValue('Storage NAS'), { target: { value: 'Backup NAS' } });
    act(() => vi.advanceTimersByTime(1000));

    expect(stored()).toMatchObject({
      name: 'Backup NAS',
      ip: '192.168.1.100',
      details: { model: 'Synology DS923+', storage: 12000 },
    });
  });
});
