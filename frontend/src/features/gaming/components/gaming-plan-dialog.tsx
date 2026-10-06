import { useState } from 'react';
import { Loader2, Plus, Trash2 } from 'lucide-react';
import {
  Dialog,
  DialogContent,
  DialogDescription,
  DialogHeader,
  DialogTitle,
} from '../../../components/ui/dialog';
import { Button } from '../../../components/ui/button';
import { Input } from '../../../components/ui/input';
import { Label } from '../../../components/ui/label';
import { cn } from '../../../lib/utils';
import type { BuildKind, GamingPlan, PowerCircuit } from '../../../types';
import { useBuilderStore } from '../../builder/store/builder-store';
import { useGamingReport } from '../api/gaming';
import { BUILD_KINDS, completePlan, isGamingKind } from '../lib/kind';
import { GamingReportView } from './gaming-report';

type Tab = 'report' | 'plan';

const selectClass =
  'h-9 w-full rounded-md border border-input bg-background px-3 text-sm focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-ring';

const toNumber = (value: string) => (value === '' ? 0 : Math.max(0, Number(value) || 0));

/** The next free circuit id: c1, c2, ... */
function nextCircuitId(circuits: PowerCircuit[]): string {
  for (let index = 1; ; index += 1) {
    if (!circuits.some(circuit => circuit.id === `c${index}`)) return `c${index}`;
  }
}

function Field({
  id,
  label,
  hint,
  children,
}: {
  id: string;
  label: string;
  hint?: string;
  children: React.ReactNode;
}) {
  return (
    <div className="space-y-1.5">
      <Label htmlFor={id} className="text-xs">
        {label}
      </Label>
      {children}
      {hint && <p className="text-xs text-muted-foreground">{hint}</p>}
    </div>
  );
}

export function GamingPlanDialog({
  open,
  onOpenChange,
  onSelectNode,
}: {
  open: boolean;
  onOpenChange: (open: boolean) => void;
  onSelectNode?: (nodeId: string) => void;
}) {
  const buildId = useBuilderStore(state => state.currentBuildId);
  const revision = useBuilderStore(state => state.currentRevision);
  const kind = useBuilderStore(state => state.buildKind);
  const storedPlan = useBuilderStore(state => state.gamingPlan);
  const setBuildKind = useBuilderStore(state => state.setBuildKind);
  const setGamingPlan = useBuilderStore(state => state.setGamingPlan);
  const unsaved = useBuilderStore(state => state.hasUnsavedChanges());
  const [tab, setTab] = useState<Tab>('report');

  const plan = completePlan(storedPlan);
  const { data: report, isLoading, isError } = useGamingReport(buildId, revision, open);

  // Every edit replaces the plan in the store; the builder's autosave picks it up.
  const update = (change: (current: GamingPlan) => GamingPlan) => setGamingPlan(change(plan));
  const setUplink = (patch: Partial<GamingPlan['uplink']>) =>
    update(current => ({ ...current, uplink: { ...current.uplink, ...patch } }));
  const setCircuits = (circuits: PowerCircuit[]) =>
    update(current => ({ ...current, power: { ...current.power, circuits } }));
  const setCircuit = (id: string, patch: Partial<PowerCircuit>) =>
    setCircuits(
      plan.power.circuits.map(circuit => (circuit.id === id ? { ...circuit, ...patch } : circuit)),
    );

  const isParty = kind === 'lan_party';

  return (
    <Dialog open={open} onOpenChange={onOpenChange}>
      <DialogContent className="flex max-h-[88vh] max-w-3xl flex-col gap-0 p-0">
        <DialogHeader className="border-b px-6 py-4">
          <DialogTitle>Game plan</DialogTitle>
          <DialogDescription>
            {isParty
              ? 'Checks seats, addresses, switch ports and power for the party.'
              : 'Checks sizing, ports and upload for the game servers in this build.'}
          </DialogDescription>
          <div className="flex gap-1 pt-2" role="tablist" aria-label="Game plan">
            {(
              [
                ['report', 'Report'],
                ['plan', 'Plan details'],
              ] as const
            ).map(([value, label]) => (
              <button
                key={value}
                type="button"
                role="tab"
                aria-selected={tab === value}
                onClick={() => setTab(value)}
                className={cn(
                  'rounded-md px-3 py-1.5 text-sm font-medium transition-colors focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-ring',
                  tab === value
                    ? 'bg-primary/10 text-primary'
                    : 'text-muted-foreground hover:text-foreground',
                )}
              >
                {label}
              </button>
            ))}
          </div>
        </DialogHeader>

        <div className="min-h-0 flex-1 overflow-y-auto px-6 py-5">
          {tab === 'report' && (
            <div role="tabpanel">
              {unsaved && (
                <p className="mb-4 flex items-center gap-2 text-xs text-muted-foreground">
                  <Loader2 className="size-3.5 animate-spin" />
                  Saving your changes. The report updates when they are saved.
                </p>
              )}
              {isLoading && <p className="text-sm text-muted-foreground">Checking the plan...</p>}
              {isError && (
                <p className="text-sm text-destructive">
                  The report could not be loaded. Save the build and open it again.
                </p>
              )}
              {report && (
                <GamingReportView
                  report={report}
                  onSelectNode={
                    onSelectNode
                      ? nodeId => {
                          onSelectNode(nodeId);
                          onOpenChange(false);
                        }
                      : undefined
                  }
                />
              )}
            </div>
          )}

          {tab === 'plan' && (
            <div role="tabpanel" className="space-y-6">
              <Field id="plan-kind" label="This build is a">
                <select
                  id="plan-kind"
                  className={selectClass}
                  value={kind}
                  onChange={event => setBuildKind(event.target.value as BuildKind)}
                >
                  {BUILD_KINDS.map(entry => (
                    <option key={entry.kind} value={entry.kind}>
                      {entry.label}
                    </option>
                  ))}
                </select>
              </Field>

              <fieldset className="space-y-3">
                <legend className="text-sm font-semibold">Internet line</legend>
                <div className="grid gap-3 sm:grid-cols-2">
                  <Field id="plan-down" label="Download (Mbps)">
                    <Input
                      id="plan-down"
                      type="number"
                      min={0}
                      value={plan.uplink.down_mbps || ''}
                      onChange={event => setUplink({ down_mbps: toNumber(event.target.value) })}
                    />
                  </Field>
                  <Field id="plan-up" label="Upload (Mbps)">
                    <Input
                      id="plan-up"
                      type="number"
                      min={0}
                      value={plan.uplink.up_mbps || ''}
                      onChange={event => setUplink({ up_mbps: toNumber(event.target.value) })}
                    />
                  </Field>
                  <Field
                    id="plan-cgnat"
                    label="Public IPv4 address"
                    hint="Without one, a port forward cannot be reached from outside."
                  >
                    <select
                      id="plan-cgnat"
                      className={selectClass}
                      value={plan.uplink.cgnat}
                      onChange={event =>
                        setUplink({ cgnat: event.target.value as GamingPlan['uplink']['cgnat'] })
                      }
                    >
                      <option value="">I do not know</option>
                      <option value="no">Yes, my line has one</option>
                      <option value="yes">No, carrier-grade NAT</option>
                    </select>
                  </Field>
                  <Field
                    id="plan-host"
                    label="Address friends connect to"
                    hint="A DDNS name or your public IP. It is left out of shared links."
                  >
                    <Input
                      id="plan-host"
                      placeholder="play.example.org"
                      value={plan.uplink.public_host}
                      onChange={event => setUplink({ public_host: event.target.value.trim() })}
                    />
                  </Field>
                </div>
              </fieldset>

              {(isParty || plan.power.circuits.length > 0) && (
                <fieldset className="space-y-3">
                  <legend className="text-sm font-semibold">Power at the venue</legend>
                  <div className="grid gap-3 sm:grid-cols-3">
                    <Field id="plan-voltage" label="Mains voltage (V)">
                      <Input
                        id="plan-voltage"
                        type="number"
                        min={100}
                        max={240}
                        value={plan.power.mains_voltage || ''}
                        onChange={event =>
                          update(current => ({
                            ...current,
                            power: {
                              ...current.power,
                              mains_voltage: toNumber(event.target.value),
                            },
                          }))
                        }
                      />
                    </Field>
                    <Field id="plan-date" label="Date">
                      <Input
                        id="plan-date"
                        type="date"
                        value={plan.event.date}
                        onChange={event =>
                          update(current => ({
                            ...current,
                            event: { ...current.event, date: event.target.value },
                          }))
                        }
                      />
                    </Field>
                    <Field id="plan-hours" label="Length (hours)">
                      <Input
                        id="plan-hours"
                        type="number"
                        min={0}
                        value={plan.event.hours || ''}
                        onChange={event =>
                          update(current => ({
                            ...current,
                            event: { ...current.event, hours: toNumber(event.target.value) },
                          }))
                        }
                      />
                    </Field>
                  </div>

                  <div className="space-y-2">
                    <p className="text-xs text-muted-foreground">
                      One row per breaker. Assign tables and devices to a circuit in their
                      properties.
                    </p>
                    {plan.power.circuits.map(circuit => (
                      <div key={circuit.id} className="flex items-end gap-2">
                        <div className="min-w-0 flex-1">
                          <Label htmlFor={`circuit-label-${circuit.id}`} className="sr-only">
                            Name of circuit {circuit.id}
                          </Label>
                          <Input
                            id={`circuit-label-${circuit.id}`}
                            placeholder={`Circuit ${circuit.id}`}
                            value={circuit.label}
                            onChange={event => setCircuit(circuit.id, { label: event.target.value })}
                          />
                        </div>
                        <div className="w-28">
                          <Label htmlFor={`circuit-amps-${circuit.id}`} className="sr-only">
                            Breaker rating of circuit {circuit.id} in amps
                          </Label>
                          <Input
                            id={`circuit-amps-${circuit.id}`}
                            type="number"
                            min={1}
                            max={125}
                            value={circuit.breaker_amps || ''}
                            onChange={event =>
                              setCircuit(circuit.id, {
                                breaker_amps: toNumber(event.target.value),
                              })
                            }
                          />
                        </div>
                        <span className="pb-2 text-sm text-muted-foreground">A</span>
                        <Button
                          variant="ghost"
                          size="icon"
                          aria-label={`Remove circuit ${circuit.label || circuit.id}`}
                          onClick={() =>
                            setCircuits(plan.power.circuits.filter(item => item.id !== circuit.id))
                          }
                        >
                          <Trash2 className="size-4" />
                        </Button>
                      </div>
                    ))}
                    <Button
                      variant="outline"
                      size="sm"
                      onClick={() =>
                        setCircuits([
                          ...plan.power.circuits,
                          {
                            id: nextCircuitId(plan.power.circuits),
                            label: '',
                            breaker_amps: plan.power.circuits.at(-1)?.breaker_amps || 16,
                          },
                        ])
                      }
                    >
                      <Plus className="mr-1.5 size-3.5" /> Add circuit
                    </Button>
                  </div>
                </fieldset>
              )}

              {!isGamingKind(kind) && (
                <p className="text-xs text-muted-foreground">
                  A homelab keeps working as before. Game servers placed in it are still checked in
                  the report.
                </p>
              )}
            </div>
          )}
        </div>
      </DialogContent>
    </Dialog>
  );
}
