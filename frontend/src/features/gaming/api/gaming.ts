import { useQuery } from '@tanstack/react-query';
import { api } from '../../../lib/api';
import type { BuildKind, GameExposure, GamePort } from '../../../types';

// Mirrors backend/internal/gaming/report.go.

export type IssueSeverity = 'error' | 'warning' | 'info';

export interface GamingIssue {
  /** Stable identifier of the finding, e.g. "dhcp_pool_short". */
  code: string;
  severity: IssueSeverity;
  node_id?: string;
  vm_id?: string;
  message: string;
  fix?: string;
}

interface GamingSizing {
  cpu_cores: number;
  ram_mb: number;
  storage_gb: number;
  upload_kbps: number;
}

export interface ServerReport {
  vm_id: string;
  name: string;
  profile: string;
  game: string;
  role: 'game' | 'tool';
  host_id: string;
  host_name: string;
  players: number;
  exposure: GameExposure;
  needed: GamingSizing;
  allocated_cpu: number;
  allocated_ram_mb: number;
  ports: Array<GamePort & { base: number }>;
  target_ip: string;
  address: string;
}

export interface PortForward {
  router_id: string;
  router_name: string;
  vm_id: string;
  server: string;
  port_name: string;
  proto: 'tcp' | 'udp';
  external_port: number;
  target_ip: string;
  target_port: number;
  hop: number;
}

export interface UplinkReport {
  up_mbps: number;
  down_mbps: number;
  needed_up_mbps: number;
  used_pct: number;
  cgnat: '' | 'yes' | 'no';
}

export interface PartyReport {
  seats: number;
  wifi_players: number;
  wifi_clients: number;
  dhcp: Array<{
    router_id: string;
    router_name: string;
    enabled: boolean;
    start: string;
    end: string;
    size: number;
    needed: number;
  }>;
  switches: Array<{ id: string; name: string; total: number; used: number; free: number }>;
  tables: Array<{
    id: string;
    name: string;
    seats: number;
    switch_ports: number;
    uplink_gbps: number;
    uplink_to: string;
    watts: number;
    circuit: string;
  }>;
  circuits: Array<{
    id: string;
    label: string;
    breaker_amps: number;
    watts: number;
    capacity_watts: number;
    continuous_watts: number;
    used_pct: number;
  }>;
  total_watts: number;
  unassigned_watts: number;
  energy_kwh: number;
  has_lancache: boolean;
}

export interface GamingReport {
  kind: BuildKind;
  revision: number;
  status: 'ok' | 'warning' | 'error';
  servers: ServerReport[];
  port_forwards: PortForward[];
  uplink?: UplinkReport;
  party?: PartyReport;
  issues: GamingIssue[];
}

const gamingApi = {
  report: (buildId: string) => api.get<GamingReport>(`/api/builds/${buildId}/gaming-report`),
};

/**
 * The report of the saved build. It is keyed by the revision, so it is fetched
 * again after every save and never shows figures for an older state.
 */
export function useGamingReport(buildId: string | null, revision: number, enabled = true) {
  return useQuery({
    queryKey: ['gaming-report', buildId, revision],
    queryFn: () => gamingApi.report(buildId!),
    enabled: enabled && !!buildId && revision > 0,
    staleTime: Infinity,
  });
}
