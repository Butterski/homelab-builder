import { describe, expect, it } from 'vitest';
import type { HardwareNode, HardwareType } from '../../../types';
import { checkConnection, requiredConnectionType, type LinkEnd } from './connection-rules';

const node = (id: string, type: HardwareType): HardwareNode => ({ id, type, name: id, x: 0, y: 0 });

const nodes = [
  node('router', 'router'),
  node('switch', 'switch'),
  node('switch-2', 'switch'),
  node('ap', 'access_point'),
  node('pc', 'pc'),
  node('server', 'server'),
  node('ps5', 'console'),
  node('deck', 'console'),
  node('table', 'lan_table'),
  node('ups', 'ups'),
];

const link = (
  source: string,
  target: string,
  sourceHandle = 'eth0',
  targetHandle = 'target-0',
): LinkEnd => ({ source, target, sourceHandle, targetHandle });

const message = (result: ReturnType<typeof checkConnection>) =>
  result.ok ? null : (result.message ?? '');

describe('checkConnection', () => {
  it('keeps the rules a homelab already had', () => {
    expect(checkConnection(link('router', 'switch'), nodes, []).ok).toBe(true);
    // Self links and unknown nodes are refused without a message.
    expect(checkConnection(link('router', 'router'), nodes, [])).toEqual({ ok: false });
    expect(checkConnection(link('router', 'ghost'), nodes, [])).toEqual({ ok: false });
    // Two endpoints need a hub between them.
    expect(message(checkConnection(link('pc', 'server'), nodes, []))).toMatch(/network hub/);
    // One cable per port.
    expect(
      message(
        checkConnection(link('router', 'switch-2'), nodes, [link('router', 'switch', 'eth0')]),
      ),
    ).toBe('Source port is already in use.');
    // A second path between two devices is a loop, unless the user turned the check off.
    const existing = [link('router', 'switch', 'eth0'), link('switch', 'switch-2', 'eth0')];
    const closing = link('router', 'switch-2', 'eth1', 'eth1');
    expect(message(checkConnection(closing, nodes, existing))).toBe(
      'Connection would create a loop.',
    );
    expect(checkConnection(closing, nodes, existing, { ignoreLoops: true }).ok).toBe(true);
  });

  it('lets Wi-Fi clients join an access point without a hub and without taking its port', () => {
    const uplink = link('switch', 'ap', 'eth0', 'target-0');
    const first = link('ap', 'deck', 'eth0', 'target-0');
    expect(checkConnection(first, nodes, [uplink]).ok).toBe(true);
    // A second client uses the same access point port as the first.
    expect(checkConnection(link('ap', 'pc', 'eth0', 'target-0'), nodes, [uplink, first]).ok).toBe(
      true,
    );
    // Drawn from the client's side it is the same link.
    expect(checkConnection(link('ps5', 'ap', 'eth0', 'eth0'), nodes, [uplink, first]).ok).toBe(
      true,
    );
    // The client still has one network link.
    expect(
      message(checkConnection(link('switch', 'deck', 'eth1', 'target-0'), nodes, [uplink, first])),
    ).toBe('Target port is already in use.');
  });

  it("does not let Wi-Fi clients block the access point's own uplink", () => {
    const clients = [link('ap', 'deck', 'eth0'), link('ap', 'pc', 'eth0')];
    // Cabling the switch into the port the clients are drawn on is fine.
    expect(checkConnection(link('switch', 'ap', 'eth0', 'eth0'), nodes, clients).ok).toBe(true);
  });

  it('still refuses two clients wired to each other', () => {
    expect(message(checkConnection(link('ps5', 'pc'), nodes, []))).toMatch(/network hub/);
    expect(message(checkConnection(link('ps5', 'deck'), nodes, []))).toMatch(/network hub/);
  });

  it('gives a LAN table exactly one cabled uplink to a hub', () => {
    expect(checkConnection(link('switch', 'table'), nodes, []).ok).toBe(true);
    expect(
      message(
        checkConnection(link('switch-2', 'table', 'eth0', 'eth0'), nodes, [
          link('switch', 'table'),
        ]),
      ),
    ).toMatch(/one uplink/);
    expect(message(checkConnection(link('pc', 'table'), nodes, []))).toBe(
      'A LAN table plugs into a switch or router.',
    );
    expect(message(checkConnection(link('ap', 'table'), nodes, []))).toBe(
      'A LAN table plugs into a switch or router.',
    );
    // A UPS feed is power, not a second uplink.
    expect(
      checkConnection(link('ups', 'table', 'eth0', 'target-0'), nodes, [link('switch', 'table')])
        .ok,
    ).toBe(true);
    expect(
      checkConnection(link('switch', 'table'), nodes, [link('ups', 'table', 'eth0', 'eth0')]).ok,
    ).toBe(true);
  });
});

describe('requiredConnectionType', () => {
  it('fixes the medium only where there is no choice', () => {
    expect(requiredConnectionType('access_point', 'console')).toBe('wireless');
    expect(requiredConnectionType('pc', 'access_point')).toBe('wireless');
    expect(requiredConnectionType('switch', 'lan_table')).toBe('ethernet');
    // An access point's uplink may be a cable or a mesh hop.
    expect(requiredConnectionType('switch', 'access_point')).toBeNull();
    expect(requiredConnectionType('router', 'switch')).toBeNull();
    expect(requiredConnectionType('ups', 'lan_table')).toBeNull();
    expect(requiredConnectionType(undefined, 'switch')).toBeNull();
  });
});
