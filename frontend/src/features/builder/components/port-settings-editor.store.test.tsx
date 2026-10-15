import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import { act, fireEvent, render, screen } from '@testing-library/react';
import { QueryClient, QueryClientProvider } from '@tanstack/react-query';
import type { Edge } from '@xyflow/react';
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

const router: HardwareNode = { id: 'r', type: 'router', name: 'Edge', x: 0, y: 0, details: {} };
const pc: HardwareNode = { id: 'pc', type: 'pc', name: 'Desk', x: 0, y: 0 };

const stored = (id: string) => useBuilderStore.getState().hardwareNodes.find(node => node.id === id);

function show(nodes: HardwareNode[], edges: Edge[] = []) {
  useBuilderStore.setState({ hardwareNodes: nodes, edges, selectedNodeId: null });
  render(
    <QueryClientProvider client={new QueryClient()}>
      <NodePropertiesPanel />
    </QueryClientProvider>,
  );
  act(() => useBuilderStore.getState().selectNode(nodes[0].id));
}

// The editor and the panel both write the details of the selected device: the
// editor at once, the panel half a second after its form changes. These tests
// run both on the real store, so a write of one that drops the other shows.
describe('PortSettingsEditor on the builder store', () => {
  beforeEach(() => {
    vi.useFakeTimers();
    useBuilderStore.getState().clearCurrentBuild();
  });

  afterEach(() => {
    vi.useRealTimers();
  });

  it('saves the role and address of a router port', () => {
    show([router]);
    fireEvent.change(screen.getByLabelText('Role of eth1'), { target: { value: 'wan' } });
    fireEvent.change(screen.getByLabelText('Role of eth1'), { target: { value: 'lan' } });
    const address = screen.getByLabelText('Address of eth1');
    fireEvent.change(address, { target: { value: '192.168.10.1/24' } });
    fireEvent.blur(address);

    expect(stored('r')?.details?.port_config).toEqual({
      eth1: { role: 'lan', address: '192.168.10.1/24' },
    });
    expect(screen.getByText('eth1 · LAN · 192.168.10.1/24')).toBeInTheDocument();
  });

  it('writes nothing for an address that is not a port address', () => {
    show([router]);
    const address = screen.getByLabelText('Address of eth1');
    fireEvent.change(address, { target: { value: '192.168.10.0/24' } });
    fireEvent.blur(address);

    expect(stored('r')?.details?.port_config).toBeUndefined();
    expect(screen.getByText('Enter an address like 192.168.10.1/24')).toBeInTheDocument();
  });

  it('adds a port', () => {
    show([router]);
    fireEvent.click(screen.getByRole('button', { name: 'Add port' }));

    expect(stored('r')?.details?.ports).toBe(5);
    expect(screen.getByLabelText('Number of Ports')).toHaveValue(5);
    expect(screen.getByLabelText('Address of eth4')).toBeInTheDocument();
  });

  it('removes a deleted VLAN from the ports of the switch', () => {
    const sw: HardwareNode = {
      id: 'sw',
      type: 'switch',
      name: 'Core',
      x: 0,
      y: 0,
      details: {
        vlans: [
          { id: 10, name: 'Office', color: '#ef4444' },
          { id: 20, name: 'Lab' },
        ],
        port_config: {
          eth0: { untagged_vlan: 10 },
          eth1: { untagged_vlan: 20, tagged_vlans: [10] },
          eth2: { tagged_vlans: [10, 20], comment: 'trunk' },
        },
      },
    };
    show([sw]);
    fireEvent.click(screen.getByRole('button', { name: 'Delete VLAN 10' }));

    expect(stored('sw')?.details).toMatchObject({
      vlans: [{ id: 20, name: 'Lab' }],
      port_config: {
        eth1: { untagged_vlan: 20 },
        eth2: { tagged_vlans: [20], comment: 'trunk' },
      },
    });
    expect(stored('sw')?.details?.port_config?.eth0).toBeUndefined();
    expect(stored('sw')?.details?.port_config?.eth1?.tagged_vlans).toBeUndefined();
  });

  it('keeps the port settings when the panel saves its form', () => {
    show([
      {
        ...router,
        details: { port_config: { eth2: { role: 'dmz', address: '172.16.0.1/30', dhcp: true } } },
      },
    ]);
    // Selecting the device and waiting past the panel's delay keeps its port settings.
    act(() => vi.advanceTimersByTime(1000));
    expect(stored('r')?.details?.port_config?.eth2).toEqual({
      role: 'dmz',
      address: '172.16.0.1/30',
      dhcp: true,
    });
    fireEvent.change(screen.getByDisplayValue('Edge'), { target: { value: 'Gateway' } });
    act(() => vi.advanceTimersByTime(1000));
    const comment = screen.getByLabelText('Comment of eth0');
    fireEvent.change(comment, { target: { value: 'to the lab' } });
    fireEvent.blur(comment);
    act(() => vi.advanceTimersByTime(1000));

    expect(stored('r')).toMatchObject({
      name: 'Gateway',
      details: {
        port_config: {
          eth0: { comment: 'to the lab' },
          eth2: { role: 'dmz', address: '172.16.0.1/30', dhcp: true },
        },
      },
    });
  });

  it('keeps the port count above a cabled port', () => {
    show(
      [{ ...router, details: { ports: 6 } }, pc],
      [{ id: 'e1', source: 'r', sourceHandle: 'eth5', target: 'pc', targetHandle: 'target-0' }],
    );
    const ports = screen.getByLabelText('Number of Ports');
    fireEvent.change(ports, { target: { value: '2' } });
    fireEvent.blur(ports);

    expect(stored('r')?.details?.ports).toBe(6);
    expect(ports).toHaveValue(6);
    expect(screen.getByText('Ports up to eth5 carry cables.')).toBeInTheDocument();
  });

  it('drops the settings of ports that are removed', () => {
    show([{ ...router, details: { ports: 4, port_config: { eth3: { comment: 'spare' } } } }]);
    const ports = screen.getByLabelText('Number of Ports');
    fireEvent.change(ports, { target: { value: '3' } });
    fireEvent.keyDown(ports, { key: 'Enter' });

    expect(stored('r')?.details?.ports).toBe(3);
    expect(stored('r')?.details?.port_config).toBeUndefined();
    expect(screen.queryByText('Ports up to eth2 carry cables.')).not.toBeInTheDocument();
  });
});
