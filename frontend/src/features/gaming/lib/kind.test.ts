import { describe, expect, it } from 'vitest';
import { BUILD_KINDS, buildKindInfo, completePlan, isGamingKind } from './kind';

describe('build kinds', () => {
  it('lists the three kinds the backend accepts, homelab first', () => {
    expect(BUILD_KINDS.map(entry => entry.kind)).toEqual(['homelab', 'lan_party', 'game_server']);
  });

  it('treats a build without a kind as a homelab', () => {
    expect(buildKindInfo(undefined).kind).toBe('homelab');
    expect(buildKindInfo('game_server').label).toBe('Game server');
    expect(isGamingKind(undefined)).toBe(false);
    expect(isGamingKind('homelab')).toBe(false);
    expect(isGamingKind('lan_party')).toBe(true);
    expect(isGamingKind('game_server')).toBe(true);
  });
});

describe('completePlan', () => {
  it('turns an empty stored plan into a complete, blank one', () => {
    expect(completePlan({})).toEqual({
      uplink: { down_mbps: 0, up_mbps: 0, cgnat: '', public_host: '' },
      power: { mains_voltage: 0, circuits: [] },
      event: { date: '', hours: 0 },
    });
    expect(completePlan(undefined).power.circuits).toEqual([]);
  });

  it('keeps what is filled in', () => {
    const plan = completePlan({
      uplink: { down_mbps: 300, up_mbps: 30, cgnat: 'yes', public_host: 'play.example.org' },
    });
    expect(plan.uplink).toEqual({
      down_mbps: 300,
      up_mbps: 30,
      cgnat: 'yes',
      public_host: 'play.example.org',
    });
    expect(plan.event).toEqual({ date: '', hours: 0 });
  });
});
