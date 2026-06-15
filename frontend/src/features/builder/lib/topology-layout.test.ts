import { describe, expect, it } from 'vitest';
import type { HardwareNode, HardwareType } from '../../../types';
import { computeTopologyLayout } from './topology-layout';

describe('computeTopologyLayout', () => {
  it('places connected nodes in gateway-rooted columns', () => {
    const positions = computeTopologyLayout(
      [
        node('router-1', 'router', 'Gateway'),
        node('switch-1', 'switch', 'Switch'),
        node('server-1', 'server_v2', 'Compute'),
      ],
      [
        edge('router-1', 'switch-1'),
        edge('switch-1', 'server-1'),
      ],
      { startX: 0, startY: 0, columnGap: 100, rowGap: 50 },
    );

    expect(positions).toEqual([
      { id: 'router-1', x: 0, y: 0 },
      { id: 'switch-1', x: 100, y: 0 },
      { id: 'server-1', x: 200, y: 0 },
    ]);
  });

  it('moves disconnected top-level nodes into a final review column', () => {
    const positions = computeTopologyLayout(
      [
        node('router-1', 'router', 'Gateway'),
        node('switch-1', 'switch', 'Switch'),
        node('nas-1', 'nas', 'NAS'),
      ],
      [edge('router-1', 'switch-1')],
      { startX: 10, startY: 20, columnGap: 100, rowGap: 50 },
    );

    expect(positions.find(position => position.id === 'nas-1')).toEqual({
      id: 'nas-1',
      x: 210,
      y: 0 + 20,
    });
  });

  it('leaves rack-contained children out of the top-level layout', () => {
    const positions = computeTopologyLayout(
      [
        node('rack-1', 'rack', 'Rack'),
        node('server-1', 'server_v2', 'Racked Server', 'rack-1'),
        node('router-1', 'router', 'Gateway'),
      ],
      [edge('router-1', 'server-1')],
    );

    expect(positions.map(position => position.id)).toEqual(['router-1', 'rack-1']);
  });
});

function node(id: string, type: HardwareType, name: string, parentID?: string): HardwareNode {
  return {
    id,
    type,
    name,
    x: 0,
    y: 0,
    parent_id: parentID,
  };
}

function edge(source: string, target: string) {
  return { source, target };
}

