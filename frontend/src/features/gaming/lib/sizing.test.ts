import { describe, expect, it } from 'vitest';
import type { GameProfile } from '../../../types';
import {
  maxPortOffset,
  newGameInstance,
  readGameInstance,
  resolvePorts,
  sizeServer,
} from './sizing';

const valheim: GameProfile = {
  slug: 'valheim',
  service_id: 'svc',
  name: 'Valheim Server',
  role: 'game',
  default_players: 5,
  max_players: 10,
  base_ram_mb: 3072,
  ram_mb_per_player: 150,
  base_cpu_cores: 1.5,
  cpu_cores_per_player: 0.1,
  storage_gb: 5,
  upload_kbps_per_player: 150,
  single_thread: true,
  ports: [
    { name: 'game', port: 2456, proto: 'udp', forward: true, env: 'SERVER_PORT' },
    { name: 'query', port: 2457, proto: 'udp', forward: true },
  ],
  image: '',
  notes: '',
};

// The same vectors are asserted in backend/internal/gaming/gaming_test.go.
describe('sizeServer', () => {
  it('matches the backend for Valheim', () => {
    // 3072 + 10 x 150 = 4572 MB -> 4608; 1.5 + 10 x 0.1 = 2.5 cores; 10 x 150 kbps.
    expect(sizeServer(valheim, 10)).toEqual({
      cpu_cores: 2.5,
      ram_mb: 4608,
      storage_gb: 5,
      upload_kbps: 1500,
    });
    // 3072 + 5 x 150 = 3822 MB -> 4096; 2 cores.
    expect(sizeServer(valheim, 5)).toMatchObject({ ram_mb: 4096, cpu_cores: 2 });
  });

  it('sizes for the usual group when no player count is given', () => {
    expect(sizeServer(valheim)).toEqual(sizeServer(valheim, 5));
    expect(sizeServer(valheim, 0)).toEqual(sizeServer(valheim, 5));
  });

  it('never goes below half a core and 512 MB', () => {
    const tiny = { ...valheim, base_ram_mb: 64, ram_mb_per_player: 0, base_cpu_cores: 0.1, cpu_cores_per_player: 0 };
    expect(sizeServer(tiny, 1)).toMatchObject({ ram_mb: 512, cpu_cores: 0.5 });
  });
});

describe('ports and instances', () => {
  it('moves every port by the offset', () => {
    expect(resolvePorts(valheim, 10).map(port => port.port)).toEqual([2466, 2467]);
    expect(maxPortOffset(valheim)).toBe(1000);
    // Mumble listens on 64738: only 797 ports are left above it.
    expect(maxPortOffset({ ...valheim, ports: [{ ...valheim.ports[0], port: 64738 }] })).toBe(797);
  });

  it('starts a server for the usual group on the LAN only', () => {
    expect(newGameInstance(valheim)).toEqual({
      profile: 'valheim',
      players: 5,
      exposure: 'lan',
      port_offset: 0,
    });
    expect(newGameInstance(valheim, { players: 8, exposure: 'vpn' })).toMatchObject({
      players: 8,
      exposure: 'vpn',
    });
  });

  it('reads stored game settings and ignores guests without any', () => {
    expect(
      readGameInstance({ game: { profile: 'valheim', players: 8, exposure: 'relay', port_offset: 2 } }),
    ).toEqual({ profile: 'valheim', players: 8, exposure: 'relay', port_offset: 2 });
    expect(readGameInstance({ game: { profile: 'valheim' } })).toEqual({
      profile: 'valheim',
      players: 0,
      exposure: 'lan',
      port_offset: 0,
    });
    expect(readGameInstance({ catalog_service_id: 'x' })).toBeNull();
    expect(readGameInstance({ game: 'valheim' })).toBeNull();
    expect(readGameInstance(undefined)).toBeNull();
  });
});
