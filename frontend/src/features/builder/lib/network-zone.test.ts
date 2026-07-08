import { describe, expect, it } from 'vitest';
import { isNatDownstreamEdge } from './network-zone';

describe('isNatDownstreamEdge', () => {
  it('treats a switch connected from a firewall LAN port as downstream', () => {
    expect(
      isNatDownstreamEdge(
        {
          source: 'firewall',
          target: 'switch',
          sourceHandle: 'eth2',
          targetHandle: 'target-0',
          data: { direction: 'auto' },
        },
        'firewall',
        false,
      ),
    ).toBe(true);
  });

  it('treats a connection into the firewall target port as upstream', () => {
    expect(
      isNatDownstreamEdge(
        {
          source: 'switch',
          target: 'firewall',
          sourceHandle: 'eth0',
          targetHandle: 'target-0',
          data: { direction: 'auto' },
        },
        'firewall',
        false,
      ),
    ).toBe(false);
  });

  it('keeps upstream anchors outside auto-detected protection zones', () => {
    expect(
      isNatDownstreamEdge(
        {
          source: 'firewall',
          target: 'router',
          sourceHandle: 'eth1',
          targetHandle: 'target-0',
          data: { direction: 'auto' },
        },
        'firewall',
        true,
      ),
    ).toBe(false);
  });

  it('honors an explicit LAN direction regardless of endpoint orientation', () => {
    expect(
      isNatDownstreamEdge(
        {
          source: 'switch',
          target: 'firewall',
          sourceHandle: 'eth0',
          targetHandle: 'target-0',
          data: { direction: 'lan' },
        },
        'firewall',
        false,
      ),
    ).toBe(true);
  });
});
