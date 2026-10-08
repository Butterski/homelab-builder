import { AlertTriangle, CheckCircle2, Info, XCircle } from 'lucide-react';
import { formatMemory } from '../../../lib/format';
import { cn } from '../../../lib/utils';
import type { GamingIssue, GamingReport, IssueSeverity } from '../api/gaming';
import { EXPOSURES } from '../lib/sizing';

const SEVERITY: Record<IssueSeverity, { icon: typeof Info; className: string; label: string }> = {
  error: { icon: XCircle, className: 'text-destructive', label: 'Must fix' },
  warning: { icon: AlertTriangle, className: 'text-orange-500', label: 'Check' },
  info: { icon: Info, className: 'text-sky-500', label: 'Tip' },
};

const exposureLabel = (value: string) =>
  EXPOSURES.find(option => option.value === value)?.label ?? value;

function Section({ title, children }: { title: string; children: React.ReactNode }) {
  return (
    <section>
      <h3 className="mb-2 text-xs font-semibold uppercase tracking-wider text-muted-foreground">
        {title}
      </h3>
      {children}
    </section>
  );
}

function IssueRow({ issue, onSelect }: { issue: GamingIssue; onSelect?: (id: string) => void }) {
  const { icon: Icon, className, label } = SEVERITY[issue.severity];
  return (
    <li className="flex gap-2.5 rounded-md border border-border/70 bg-muted/20 p-3 text-sm">
      <Icon className={cn('mt-0.5 size-4 shrink-0', className)} aria-label={label} />
      <div className="min-w-0">
        <p>{issue.message}</p>
        {issue.fix && <p className="mt-1 text-muted-foreground">{issue.fix}</p>}
        {issue.node_id && onSelect && (
          <button
            type="button"
            className="mt-1.5 text-xs font-medium text-primary hover:underline"
            onClick={() => onSelect(issue.node_id!)}
          >
            Show on canvas
          </button>
        )}
      </div>
    </li>
  );
}

function LoadBar({ usedPct }: { usedPct: number }) {
  // Past 80% a breaker is beyond what it should carry for hours.
  const tone = usedPct > 100 ? 'bg-destructive' : usedPct > 80 ? 'bg-orange-500' : 'bg-primary';
  return (
    <div
      className="h-1.5 w-full overflow-hidden rounded-full bg-muted"
      role="progressbar"
      aria-valuenow={Math.round(usedPct)}
      aria-valuemin={0}
      aria-valuemax={100}
    >
      <div className={cn('h-full', tone)} style={{ width: `${Math.min(100, usedPct)}%` }} />
    </div>
  );
}

const cell = 'px-2 py-1.5 text-left align-top';
const head = cn(cell, 'text-xs font-medium text-muted-foreground');

export function GamingReportView({
  report,
  onSelectNode,
}: {
  report: GamingReport;
  onSelectNode?: (nodeId: string) => void;
}) {
  const { party, uplink } = report;
  const games = report.servers.filter(server => server.role === 'game');
  const tools = report.servers.filter(server => server.role === 'tool');

  return (
    <div className="space-y-6">
      <Section title="What to fix">
        {report.issues.length === 0 ? (
          <p className="flex items-center gap-2 rounded-md border border-border/70 bg-muted/20 p-3 text-sm">
            <CheckCircle2 className="size-4 text-emerald-500" />
            Nothing to fix. The plan holds together.
          </p>
        ) : (
          <ul className="space-y-2">
            {report.issues.map((issue, index) => (
              <IssueRow key={`${issue.code}-${index}`} issue={issue} onSelect={onSelectNode} />
            ))}
          </ul>
        )}
      </Section>

      {report.servers.length > 0 && (
        <Section title="Servers">
          <div className="overflow-x-auto rounded-md border border-border/70">
            <table className="w-full min-w-[34rem] text-sm">
              <thead className="border-b border-border/70 bg-muted/30">
                <tr>
                  <th className={head}>Server</th>
                  <th className={head}>Players</th>
                  <th className={head}>Needs</th>
                  <th className={head}>Reachable</th>
                  <th className={head}>Friends connect to</th>
                </tr>
              </thead>
              <tbody>
                {[...games, ...tools].map(server => (
                  <tr key={server.vm_id} className="border-b border-border/50 last:border-0">
                    <td className={cell}>
                      <div className="font-medium">{server.name}</div>
                      <div className="text-xs text-muted-foreground">on {server.host_name}</div>
                    </td>
                    <td className={cell}>{server.role === 'game' ? server.players : '-'}</td>
                    <td className={cell}>
                      {formatMemory(server.needed.ram_mb)}, {server.needed.cpu_cores} cores
                    </td>
                    <td className={cell}>{exposureLabel(server.exposure)}</td>
                    <td className={cn(cell, 'font-mono text-xs')}>{server.address || '-'}</td>
                  </tr>
                ))}
              </tbody>
            </table>
          </div>
        </Section>
      )}

      {report.port_forwards.length > 0 && (
        <Section title="Port forwards to add">
          <div className="overflow-x-auto rounded-md border border-border/70">
            <table className="w-full min-w-[30rem] text-sm">
              <thead className="border-b border-border/70 bg-muted/30">
                <tr>
                  <th className={head}>On</th>
                  <th className={head}>Port</th>
                  <th className={head}>Forward to</th>
                  <th className={head}>For</th>
                </tr>
              </thead>
              <tbody>
                {report.port_forwards.map(forward => (
                  <tr
                    key={`${forward.router_id}-${forward.vm_id}-${forward.proto}-${forward.external_port}`}
                    className="border-b border-border/50 last:border-0"
                  >
                    <td className={cell}>{forward.router_name}</td>
                    <td className={cn(cell, 'font-mono text-xs')}>
                      {forward.external_port}/{forward.proto.toUpperCase()}
                    </td>
                    <td className={cn(cell, 'font-mono text-xs')}>
                      {forward.target_ip || 'address not assigned yet'}:{forward.target_port}
                    </td>
                    <td className={cell}>
                      {forward.server} ({forward.port_name})
                    </td>
                  </tr>
                ))}
              </tbody>
            </table>
          </div>
        </Section>
      )}

      {uplink && (
        <Section title="Internet line">
          <div className="rounded-md border border-border/70 bg-muted/20 p-3 text-sm">
            <div className="flex items-baseline justify-between gap-3">
              <span>Upload for remote players</span>
              <span className="font-medium">
                {uplink.needed_up_mbps} Mbps
                {uplink.up_mbps > 0 && ` of ${uplink.up_mbps} Mbps`}
              </span>
            </div>
            {uplink.up_mbps > 0 && (
              <div className="mt-2">
                <LoadBar usedPct={uplink.used_pct} />
              </div>
            )}
          </div>
        </Section>
      )}

      {party && (
        <>
          <Section title="Seats and addresses">
            <div className="grid grid-cols-2 gap-2 sm:grid-cols-4">
              {[
                ['Seats', party.seats],
                ['On Wi-Fi only', party.wifi_players],
                ['Other Wi-Fi devices', party.wifi_clients],
                ['Total power', `${Math.round(party.total_watts)} W`],
              ].map(([label, value]) => (
                <div key={label} className="rounded-md border border-border/70 bg-muted/20 p-3">
                  <div className="text-lg font-semibold tracking-tight">{value}</div>
                  <div className="text-xs text-muted-foreground">{label}</div>
                </div>
              ))}
            </div>
            {party.dhcp.map(pool => (
              <p key={pool.router_id} className="mt-2 text-sm text-muted-foreground">
                {pool.enabled
                  ? `${pool.router_name} hands out ${pool.start} to ${pool.end}: ${pool.size} addresses for ${pool.needed} expected devices.`
                  : `${pool.router_name} has DHCP off; ${pool.needed} devices expect an address.`}
              </p>
            ))}
            {party.energy_kwh > 0 && (
              <p className="mt-1 text-sm text-muted-foreground">
                The event uses about {party.energy_kwh} kWh.
              </p>
            )}
          </Section>

          {party.circuits.length > 0 && (
            <Section title="Power circuits">
              <ul className="space-y-2">
                {party.circuits.map(circuit => (
                  <li
                    key={circuit.id}
                    className="rounded-md border border-border/70 bg-muted/20 p-3 text-sm"
                  >
                    <div className="flex items-baseline justify-between gap-3">
                      <span className="font-medium">{circuit.label || circuit.id}</span>
                      <span>
                        {Math.round(circuit.watts)} W
                        {circuit.capacity_watts > 0 &&
                          ` of ${Math.round(circuit.capacity_watts)} W (${circuit.breaker_amps} A)`}
                      </span>
                    </div>
                    {circuit.capacity_watts > 0 && (
                      <div className="mt-2">
                        <LoadBar usedPct={circuit.used_pct} />
                        <p className="mt-1 text-xs text-muted-foreground">
                          Safe for hours up to {Math.round(circuit.continuous_watts)} W.
                        </p>
                      </div>
                    )}
                  </li>
                ))}
              </ul>
            </Section>
          )}

          {party.switches.length > 0 && (
            <Section title="Switch ports">
              <ul className="grid gap-2 sm:grid-cols-2">
                {party.switches.map(hub => (
                  <li
                    key={hub.id}
                    className="flex items-baseline justify-between gap-3 rounded-md border border-border/70 bg-muted/20 p-3 text-sm"
                  >
                    <span className="truncate">{hub.name}</span>
                    <span className="shrink-0 text-muted-foreground">
                      {hub.free} of {hub.total} free
                    </span>
                  </li>
                ))}
              </ul>
            </Section>
          )}
        </>
      )}
    </div>
  );
}
