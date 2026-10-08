import { useId, useMemo, useState } from 'react';
import { Loader2 } from 'lucide-react';
import { toast } from 'sonner';
import { Button } from '@/components/ui/button';
import { Input } from '@/components/ui/input';
import { TickBox } from '@/components/ui/tick-box';
import { formatMemory } from '@/lib/format';
import { cn, errorMessage } from '@/lib/utils';
import { useBuilds } from '@/features/builder/api/use-builds';
import { hardwareTypeName } from '@/lib/hardware-taxonomy';
import {
  useImportFromIntegration,
  useImportPlan,
  type Figure,
  type GuestRow,
  type ImportHost,
  type ImportPlan,
  type ImportResult,
  type Integration,
  type Load,
} from '../api/integrations';
import {
  changeSentence,
  countChanges,
  decisionOf,
  freeShare,
  guestChosen,
  guestKey,
  share,
  specsChosen,
  specsDiffer,
  specsKey,
  totalChanges,
  type Overrides,
} from '../lib/import-selection';

const SELECT_CLASS =
  'h-9 min-w-0 rounded-md border border-input bg-transparent px-3 text-sm focus-visible:outline-none focus-visible:ring-1 focus-visible:ring-ring disabled:opacity-50';

const NEW_PROJECT = 'new';

const GUEST_KIND: Record<string, string> = { vm: 'VM', lxc: 'LXC', container: 'Container' };

const cores = (value: number) => (value > 0 ? `${value} vCPU` : '');
const memory = (value: number) => (value > 0 ? formatMemory(value) : '');

/** A planned figure beside the real one, and whether they agree. */
function FigureCells({ figure, format }: { figure: Figure; format: (value: number) => string }) {
  return (
    <>
      <td className="is-figure">
        {figure.planned > 0 ? (
          format(figure.planned)
        ) : (
          <span className="text-muted-foreground">Not set</span>
        )}
      </td>
      <td className={cn('is-figure', figure.state === 'differs' && 'text-status-warn')}>
        {figure.actual > 0 ? (
          format(figure.actual)
        ) : (
          <span className="text-muted-foreground">Not read</span>
        )}
      </td>
      <td
        className={cn(
          'text-xs',
          figure.state === 'same' ? 'text-status-ok' : 'text-muted-foreground',
        )}
      >
        {figure.state === 'same' ? 'Same' : figure.state === 'differs' ? 'Differs' : ''}
      </td>
    </>
  );
}

/** How full a host is: what the plan gives its guests, and what runs. */
function LoadBar({
  label,
  load,
  format,
}: {
  label: string;
  load: Load;
  format: (value: number) => string;
}) {
  if (load.capacity <= 0) return null;
  const over = Math.max(load.planned, load.actual) > load.capacity;
  return (
    <div className="grid gap-1">
      <div className="flex items-baseline justify-between gap-3 text-xs">
        <span className="text-muted-foreground">{label}</span>
        <span className="app-figure">
          planned {format(load.planned)}, running {format(load.actual)} of {format(load.capacity)}
        </span>
      </div>
      {/* Two thin bars on one scale: the plan above, what runs below. */}
      <div className="grid gap-0.5" aria-hidden="true">
        <div className="h-1 rounded-full bg-muted">
          <div
            className="h-1 rounded-full bg-muted-foreground/70"
            style={{ width: `${share(load.planned, load.capacity)}%` }}
          />
        </div>
        <div className="h-1 rounded-full bg-muted">
          <div
            className={cn('h-1 rounded-full', over ? 'bg-status-warn' : 'bg-foreground')}
            style={{ width: `${share(load.actual, load.capacity)}%` }}
          />
        </div>
      </div>
    </div>
  );
}

/** What a guest's row says will happen to it. */
function guestOutcome(row: GuestRow, chosen: boolean): string {
  if (row.state === 'discovered') return chosen ? 'Add to the plan' : 'Leave out';
  if (row.state === 'missing') return chosen ? 'Remove from the plan' : 'Keep planned';
  if (!row.differs) return 'In the plan already';
  return chosen ? 'Take the real size' : 'Keep the plan';
}

const GUEST_STATE: Record<GuestRow['state'], string> = {
  matched: 'On both',
  discovered: 'Only on Proxmox',
  missing: 'Only in the plan',
};

type HostBlockProps = {
  host: ImportHost;
  plan: ImportPlan;
  choice: string;
  overrides: Overrides;
  onChoice: (node: string, choice: string) => void;
  onToggle: (key: string, value: boolean) => void;
};

function HostBlock({ host, plan, choice, overrides, onChoice, onToggle }: HostBlockProps) {
  const id = useId();
  const taken = new Set(
    plan.hosts.filter(other => other.node !== host.node).map(other => other.planned_id),
  );
  const facts = host.facts;

  return (
    <section className="border-t pt-5" aria-labelledby={`${id}-title`}>
      <div className="flex flex-wrap items-end justify-between gap-x-6 gap-y-3">
        <div className="min-w-0">
          <h3 id={`${id}-title`} className="text-base font-semibold">
            <span className="app-figure">{host.node}</span>
            {!host.online && (
              <span className="ml-2 text-xs font-normal text-status-warn">offline</span>
            )}
          </h3>
          <p className="mt-0.5 text-xs text-muted-foreground">
            {[
              facts.cpu_model,
              facts.threads ? `${facts.threads} threads` : '',
              facts.memory_mb ? formatMemory(facts.memory_mb) : '',
              host.linked_item ? `your ${host.linked_item.name}` : '',
            ]
              .filter(Boolean)
              .join(', ')}
          </p>
        </div>
        <label className="grid gap-1 text-xs text-muted-foreground">
          In the plan this is
          <select
            className={SELECT_CLASS}
            value={choice}
            onChange={event => onChoice(host.node, event.target.value)}
          >
            {plan.candidates.map(candidate => (
              <option key={candidate.id} value={candidate.id} disabled={taken.has(candidate.id)}>
                {candidate.name} ({hardwareTypeName(candidate.type)})
              </option>
            ))}
            <option value="new">A new device</option>
            <option value="skip">Left out</option>
          </select>
        </label>
      </div>

      {host.skipped ? (
        <p className="mt-3 text-sm text-muted-foreground">
          This host and its guests are left out of the import.
        </p>
      ) : (
        <div className="mt-4 grid gap-5">
          {host.planned_id && (
            <div className="app-table-scroll">
              <table className="app-table min-w-[36rem] table-fixed">
                <caption className="sr-only">The planned device beside the real machine</caption>
                <colgroup>
                  <col className="w-[34%]" />
                  <col className="w-[24%]" />
                  <col className="w-[24%]" />
                  <col />
                </colgroup>
                <thead>
                  <tr>
                    <th scope="col">{host.planned_name}</th>
                    <th scope="col">Planned</th>
                    <th scope="col">Real</th>
                    <th scope="col">
                      <span className="sr-only">Agreement</span>
                    </th>
                  </tr>
                </thead>
                <tbody>
                  <tr>
                    <th scope="row">Memory</th>
                    <FigureCells figure={host.ram_gb} format={value => `${value} GB`} />
                  </tr>
                  <tr>
                    <th scope="row">Storage</th>
                    <FigureCells
                      figure={host.storage_gb}
                      format={value => `${Math.round(value)} GB`}
                    />
                  </tr>
                  <tr>
                    <th scope="row">Threads</th>
                    <FigureCells figure={host.cpus} format={value => String(value)} />
                  </tr>
                </tbody>
              </table>
              {specsDiffer(host) && (
                <label className="mt-2 flex items-center gap-2 text-sm hover:cursor-pointer">
                  <TickBox
                    checked={specsChosen(host, overrides)}
                    onChange={event => onToggle(specsKey(host), event.target.checked)}
                  />
                  Write the real figures into the plan
                </label>
              )}
            </div>
          )}

          {host.guests.length > 0 ? (
            <div className="app-table-scroll">
              <table className="app-table min-w-[46rem] table-fixed">
                <caption className="sr-only">Guests of {host.node}</caption>
                <colgroup>
                  <col className="w-10" />
                  <col className="w-[26%]" />
                  <col className="w-[14%]" />
                  <col className="w-[15%]" />
                  <col />
                  <col className="w-[17%]" />
                </colgroup>
                <thead>
                  <tr>
                    <th scope="col">
                      <span className="sr-only">Take over</span>
                    </th>
                    <th scope="col">Guest</th>
                    <th scope="col">Where</th>
                    <th scope="col">Planned</th>
                    <th scope="col">Real</th>
                    <th scope="col">What happens</th>
                  </tr>
                </thead>
                <tbody>
                  {host.guests.map(row => {
                    const key = guestKey(row);
                    const chosen = guestChosen(row, overrides);
                    const choosable = row.state !== 'matched' || row.differs;
                    return (
                      <tr key={key}>
                        <td>
                          {choosable && (
                            <TickBox
                              checked={chosen}
                              onChange={event => onToggle(key, event.target.checked)}
                              aria-label={`${guestOutcome(row, true)}: ${row.name}`}
                            />
                          )}
                        </td>
                        <th scope="row">
                          {row.name}
                          <span className="block text-xs font-normal text-muted-foreground">
                            {[
                              GUEST_KIND[row.kind] ?? row.kind,
                              row.vmid ? `id ${row.vmid}` : '',
                              row.status,
                              row.planned_name && row.planned_name !== row.name
                                ? `planned as ${row.planned_name}`
                                : '',
                            ]
                              .filter(Boolean)
                              .join(', ')}
                          </span>
                        </th>
                        <td
                          className={cn(
                            'whitespace-nowrap',
                            row.state === 'matched' && !row.differs && 'text-status-ok',
                            row.state === 'missing' && 'text-status-warn',
                          )}
                        >
                          {GUEST_STATE[row.state]}
                        </td>
                        <td className="is-figure">
                          {[cores(row.cpus.planned), memory(row.memory_mb.planned)]
                            .filter(Boolean)
                            .join(', ')}
                        </td>
                        <td className={cn('is-figure', row.differs && 'text-status-warn')}>
                          {[cores(row.cpus.actual), memory(row.memory_mb.actual), row.ip]
                            .filter(Boolean)
                            .join(', ')}
                        </td>
                        <td className="text-muted-foreground">{guestOutcome(row, chosen)}</td>
                      </tr>
                    );
                  })}
                </tbody>
              </table>
              {host.guests.some(row => row.state === 'missing') && (
                <p className="mt-2 text-xs text-muted-foreground">
                  Proxmox does not see into its guests: a planned service that is &quot;only in the
                  plan&quot; may well run as a container inside one of the virtual machines.
                </p>
              )}
            </div>
          ) : (
            <p className="text-sm text-muted-foreground">No guests on this host.</p>
          )}

          <div className="grid max-w-xl gap-3">
            <LoadBar label="Memory" load={host.memory_mb} format={formatMemory} />
            <LoadBar
              label="Virtual processors"
              load={host.vcpus}
              format={value => String(Math.round(value))}
            />
            {host.memory_mb.capacity > 0 && (
              <p className="text-xs text-muted-foreground">
                Memory left free:{' '}
                {host.planned_id && host.memory_mb.planned > 0 && (
                  <>
                    <span className="app-figure text-foreground">
                      {freeShare(host.memory_mb.planned, host.memory_mb.capacity)}%
                    </span>{' '}
                    by the plan,{' '}
                  </>
                )}
                <span className="app-figure text-foreground">
                  {freeShare(host.memory_mb.actual, host.memory_mb.capacity)}%
                </span>{' '}
                as it runs
              </p>
            )}
            {host.warnings.map(warning => (
              <p key={warning} className="border-l-2 border-status-warn pl-3 text-sm">
                {warning}
              </p>
            ))}
          </div>
        </div>
      )}
    </section>
  );
}

type ProxmoxImportProps = {
  integration: Integration;
  /** The project open on the canvas, compared with first. */
  openBuildId?: string;
  onImported: (result: ImportResult) => void;
};

/**
 * Compares what the cluster runs with a project and imports the differences
 * the owner ticks. Into an existing project that is a proposal, reviewed on
 * the canvas like any other; a new project is made at once.
 */
export function ProxmoxImport({ integration, openBuildId, onImported }: ProxmoxImportProps) {
  const id = useId();
  const { data: builds } = useBuilds();
  const [chosen, setTarget] = useState(openBuildId ?? NEW_PROJECT);
  const [buildName, setBuildName] = useState('');
  const [hostChoices, setHostChoices] = useState<Record<string, string>>({});
  const [overrides, setOverrides] = useState<Overrides>({});
  // The open project may be gone by now (deleted in another tab): then there is
  // nothing to compare with but a new one.
  const target =
    chosen !== NEW_PROJECT && builds && !builds.some(build => build.id === chosen)
      ? NEW_PROJECT
      : chosen;
  const buildId = target === NEW_PROJECT ? null : target;

  const planQuery = useImportPlan(integration.id, buildId, hostChoices);
  const importMutation = useImportFromIntegration(integration.id);
  const plan = planQuery.data;

  const count = useMemo(() => (plan ? countChanges(plan, overrides) : null), [plan, overrides]);
  const tooLarge = !!plan && !!plan.build && !!count && count.operations > plan.operation_limit;
  const nothing = !count || totalChanges(count) === 0;

  const changeTarget = (next: string) => {
    setTarget(next);
    // The devices of another project are other devices.
    setHostChoices({});
    setOverrides({});
  };

  const run = async () => {
    if (!plan) return;
    try {
      const result = await importMutation.mutateAsync(
        decisionOf(plan, hostChoices, overrides, buildName),
      );
      onImported(result);
    } catch (cause) {
      toast.error(errorMessage(cause, 'The import could not be made.'));
    }
  };

  return (
    <div className="grid gap-5">
      <div className="flex flex-wrap items-end gap-x-6 gap-y-3">
        <label className="grid gap-1 text-xs text-muted-foreground">
          Compare with
          <select
            className={cn(SELECT_CLASS, 'max-w-72')}
            value={target}
            onChange={event => changeTarget(event.target.value)}
          >
            {(builds ?? []).map(build => (
              <option key={build.id} value={build.id}>
                {build.name}
                {build.id === openBuildId ? ' (open)' : ''}
              </option>
            ))}
            <option value={NEW_PROJECT}>A new project</option>
          </select>
        </label>
        {target === NEW_PROJECT && (
          <label className="grid gap-1 text-xs text-muted-foreground" htmlFor={`${id}-name`}>
            Its name
            <Input
              id={`${id}-name`}
              className="w-64"
              value={buildName}
              onChange={event => setBuildName(event.target.value)}
              placeholder={`Proxmox ${integration.summary?.cluster ?? ''}`.trim()}
              maxLength={120}
            />
          </label>
        )}
        {plan && (
          <p className="pb-2 text-sm text-muted-foreground" aria-live="polite">
            {plan.build
              ? `${plan.counts.matched} on both sides, ${plan.counts.discovered} only on Proxmox, ${plan.counts.missing} only in the plan`
              : `${plan.counts.discovered} guests on ${plan.hosts.length} ${plan.hosts.length === 1 ? 'host' : 'hosts'}`}
          </p>
        )}
      </div>

      {planQuery.isLoading && <p className="text-sm text-muted-foreground">Comparing…</p>}
      {planQuery.isError && (
        <p className="text-sm text-destructive" role="alert">
          {errorMessage(planQuery.error, 'The comparison could not be made.')}
        </p>
      )}

      {plan && (
        <>
          <div className={cn('grid gap-5', planQuery.isFetching && 'opacity-60')}>
            {plan.hosts.map(host => (
              <HostBlock
                key={host.node}
                host={host}
                plan={plan}
                choice={
                  hostChoices[host.node] ?? (host.skipped ? 'skip' : host.planned_id || 'new')
                }
                overrides={overrides}
                onChoice={(node, choice) =>
                  setHostChoices(current => ({ ...current, [node]: choice }))
                }
                onToggle={(key, value) => setOverrides(current => ({ ...current, [key]: value }))}
              />
            ))}
          </div>

          {plan.build && (
            <section className="border-t pt-5" aria-label="Plan against reality">
              <table className="app-table max-w-xl">
                <thead>
                  <tr>
                    <th scope="col">All compared hosts</th>
                    <th scope="col" className="is-end">
                      Plan
                    </th>
                    <th scope="col" className="is-end">
                      Running
                    </th>
                    <th scope="col" className="is-end">
                      Capacity
                    </th>
                  </tr>
                </thead>
                <tbody>
                  <tr>
                    <th scope="row">Virtual processors</th>
                    <td className="is-figure is-end">{Math.round(plan.totals.vcpus.planned)}</td>
                    <td className="is-figure is-end">{Math.round(plan.totals.vcpus.actual)}</td>
                    <td className="is-figure is-end">{Math.round(plan.totals.vcpus.capacity)}</td>
                  </tr>
                  <tr>
                    <th scope="row">Memory</th>
                    <td className="is-figure is-end">
                      {formatMemory(plan.totals.memory_mb.planned)}
                    </td>
                    <td className="is-figure is-end">
                      {formatMemory(plan.totals.memory_mb.actual)}
                    </td>
                    <td className="is-figure is-end">
                      {formatMemory(plan.totals.memory_mb.capacity)}
                    </td>
                  </tr>
                  <tr>
                    <th scope="row">Guest disks</th>
                    <td className="is-figure is-end">
                      {Math.round(plan.totals.disk_gb.planned)} GB
                    </td>
                    <td className="is-figure is-end">
                      {Math.round(plan.totals.disk_gb.actual)} GB
                    </td>
                    <td className="is-figure is-end">
                      {Math.round(plan.totals.disk_gb.capacity)} GB
                    </td>
                  </tr>
                </tbody>
              </table>
            </section>
          )}

          {/* The dialog scrolls with its padding: the bar sticks to the edge, not 24 px above it. */}
          <div className="sticky -bottom-6 -mx-6 -mb-6 flex flex-wrap items-center justify-between gap-3 border-t bg-background px-6 py-4">
            <div className="min-w-0 text-sm">
              <p className="font-medium">{count ? changeSentence(count) : ''}</p>
              <p className="text-xs text-muted-foreground">
                {tooLarge
                  ? `One import holds ${plan.operation_limit} changes and this is ${count?.operations}. Untick some guests and import them next.`
                  : plan.build
                    ? 'Nothing is written yet: you review the changes on the canvas and apply them there.'
                    : 'A new project is made with a router, a switch and these hosts.'}
              </p>
            </div>
            <Button
              onClick={() => void run()}
              disabled={importMutation.isPending || planQuery.isFetching || tooLarge || nothing}
            >
              {importMutation.isPending && <Loader2 className="animate-spin" aria-hidden="true" />}
              {plan.build ? 'Review on the canvas' : 'Create the project'}
            </Button>
          </div>
        </>
      )}
    </div>
  );
}
