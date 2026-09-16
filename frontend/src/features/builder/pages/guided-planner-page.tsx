import { useEffect, useMemo, useState } from 'react';
import { useNavigate } from 'react-router-dom';
import {
  ArrowLeft,
  ArrowRight,
  Check,
  Cloud,
  Gauge,
  HardDrive,
  Home,
  Loader2,
  Network,
  Play,
  Server,
  ShieldCheck,
  Sparkles,
  Wallet,
} from 'lucide-react';
import { toast } from 'sonner';
import { Button } from '../../../components/ui/button';
import { Card } from '../../../components/ui/card';
import type { Service } from '../../../types';
import { buildApi, type CreateBuildParams } from '../api/builds';
import { useBuilderStore } from '../store/builder-store';

type Goal = 'backup' | 'media' | 'home' | 'network' | 'development' | 'security';
type Footprint = 'compact' | 'desk' | 'rack' | 'cloud';
type Budget = 'starter' | 'balanced' | 'enthusiast';
type Reliability = 'simple' | 'resilient';

type PlannerAnswers = {
  goals: Goal[];
  footprint: Footprint;
  budget: Budget;
  reliability: Reliability;
  name: string;
};

type PlannedNode = {
  id: string;
  type: string;
  name: string;
  x: number;
  y: number;
  ip?: string;
  power_draw?: number;
  parent_id?: string;
  details: Record<string, unknown>;
  vms: Array<{
    id: string;
    name: string;
    type: 'container';
    status: 'running';
    cpu_cores?: number;
    ram_mb?: number;
    details: Record<string, unknown>;
  }>;
  internal_components: unknown[];
};

const GOALS: Array<{ id: Goal; label: string; description: string; icon: typeof Home }> = [
  {
    id: 'backup',
    label: 'Backups & storage',
    description: 'Protect family files and device backups.',
    icon: HardDrive,
  },
  {
    id: 'media',
    label: 'Media streaming',
    description: 'Run a private movie and music library.',
    icon: Play,
  },
  {
    id: 'home',
    label: 'Smart home',
    description: 'Keep automations local and dependable.',
    icon: Home,
  },
  {
    id: 'network',
    label: 'Better networking',
    description: 'DNS filtering, Wi-Fi, and visibility.',
    icon: Network,
  },
  {
    id: 'development',
    label: 'Development',
    description: 'Git, CI, containers, and test services.',
    icon: Server,
  },
  {
    id: 'security',
    label: 'Remote access',
    description: 'A safer VPN entry point to your lab.',
    icon: ShieldCheck,
  },
];

const FOOTPRINTS: Array<{ id: Footprint; label: string; description: string }> = [
  { id: 'compact', label: 'Tiny & quiet', description: 'One mini PC, low power, no rack.' },
  {
    id: 'desk',
    label: 'Desk / shelf',
    description: 'Separate compute and storage with room to grow.',
  },
  {
    id: 'rack',
    label: 'Rack build',
    description: 'Structured server, switching, power, and storage.',
  },
  { id: 'cloud', label: 'Hybrid cloud', description: 'Local services plus a small public VPS.' },
];

const BUDGETS: Array<{ id: Budget; label: string; description: string; range: string }> = [
  {
    id: 'starter',
    label: 'Starter',
    description: 'Reuse gear and keep the first build lean.',
    range: '$250-$600',
  },
  {
    id: 'balanced',
    label: 'Balanced',
    description: 'Good headroom without enterprise hardware.',
    range: '$700-$1,500',
  },
  {
    id: 'enthusiast',
    label: 'Enthusiast',
    description: 'Rack, redundancy, and faster networking.',
    range: '$1,800-$4,000',
  },
];

const SERVICE_BY_GOAL: Record<Goal, string[]> = {
  backup: ['restic', 'duplicati', 'syncthing'],
  media: ['jellyfin'],
  home: ['home assistant'],
  network: ['pi-hole', 'adguard home', 'uptime kuma'],
  development: ['gitea', 'forgejo'],
  security: ['wireguard easy', 'wg-easy'],
};

function normalize(value: string) {
  return value.toLowerCase().replace(/[^a-z0-9]/g, '');
}

function chooseService(goal: Goal, services: Service[]): Service | undefined {
  const candidates = SERVICE_BY_GOAL[goal].map(normalize);
  return services.find(service =>
    candidates.some(candidate => normalize(service.name).includes(candidate)),
  );
}

function buildPlan(answers: PlannerAnswers, services: Service[]): CreateBuildParams {
  const nodes: PlannedNode[] = [];
  const edges: CreateBuildParams['edges'] = [];
  const routerID = crypto.randomUUID();
  const switchID = crypto.randomUUID();

  nodes.push({
    id: routerID,
    type: 'router',
    name: 'Lab Router',
    x: 80,
    y: 250,
    ip: '192.168.10.1',
    power_draw: 12,
    details: {
      model: 'Existing router or firewall',
      ports: 4,
      dhcp_enabled: true,
      subnet_mask: '255.255.255.0',
      network_zone: 'lan',
      planner_role: 'gateway',
    },
    vms: [],
    internal_components: [],
  });
  nodes.push({
    id: switchID,
    type: 'switch',
    name: answers.budget === 'enthusiast' ? 'Managed 16-port Switch' : 'Managed 8-port Switch',
    x: 360,
    y: 250,
    power_draw: answers.budget === 'enthusiast' ? 24 : 10,
    details: {
      ports: answers.budget === 'enthusiast' ? 16 : 8,
      managed: true,
      planner_role: 'distribution',
    },
    vms: [],
    internal_components: [],
  });
  edges.push({
    source: routerID,
    source_handle: 'eth1',
    target: switchID,
    target_handle: 'target-0',
    type: 'ethernet',
    speed: answers.budget === 'enthusiast' ? '10 GbE' : '1 GbE',
    direction: 'lan',
  });

  const computeIDs: string[] = [];
  const addCompute = (
    type: string,
    name: string,
    x: number,
    y: number,
    details: Record<string, unknown>,
  ) => {
    const id = crypto.randomUUID();
    computeIDs.push(id);
    nodes.push({
      id,
      type,
      name,
      x,
      y,
      power_draw: type === 'vps' ? 0 : type === 'server_v2' ? 115 : 24,
      details: { ...details, app_host_enabled: true, planner_role: 'compute' },
      vms: [],
      internal_components: [],
    });
    return id;
  };

  let rackID: string | undefined;
  if (answers.footprint === 'rack') {
    rackID = crypto.randomUUID();
    nodes.push({
      id: rackID,
      type: 'rack',
      name: '12U Lab Rack',
      x: 630,
      y: 70,
      power_draw: 0,
      details: { rack_size: 12, planner_role: 'enclosure' },
      vms: [],
      internal_components: [],
    });
  }

  const primaryType = answers.footprint === 'rack' ? 'server_v2' : 'minipc';
  const primaryID = addCompute(
    primaryType,
    answers.footprint === 'rack' ? 'Primary Virtualization Server' : 'Primary Mini PC',
    rackID ? 22 : 680,
    rackID ? 70 : 150,
    {
      cpu: answers.budget === 'starter' ? 4 : answers.budget === 'balanced' ? 8 : 16,
      ram: answers.budget === 'starter' ? 16 : answers.budget === 'balanced' ? 32 : 64,
      storage: answers.budget === 'starter' ? 512 : 1000,
      ports: answers.budget === 'enthusiast' ? 4 : 2,
      ...(rackID ? { rack_units: 2, rack_position: 1 } : {}),
    },
  );
  if (rackID) {
    nodes[nodes.findIndex(node => node.id === primaryID)].parent_id = rackID;
  }

  if (answers.reliability === 'resilient') {
    addCompute(
      answers.footprint === 'cloud' ? 'vps' : 'minipc',
      answers.footprint === 'cloud' ? 'Cloud Recovery VPS' : 'Secondary Compute Node',
      680,
      390,
      { cpu: 4, ram: 16, storage: 256, ports: 2, planner_role: 'failover' },
    );
  }
  if (answers.footprint === 'cloud' && !nodes.some(node => node.type === 'vps')) {
    addCompute('vps', 'Public Edge VPS', 680, 390, {
      cpu: 2,
      ram: 4,
      storage: 40,
      ports: 2,
      provider: 'Choose a provider',
      network_zone: 'cloud',
    });
  }

  if (answers.goals.includes('backup') || answers.goals.includes('media')) {
    nodes.push({
      id: crypto.randomUUID(),
      type: 'nas',
      name: 'Storage NAS',
      x: 990,
      y: 320,
      power_draw: 45,
      details: {
        storage:
          answers.budget === 'starter' ? 4000 : answers.budget === 'balanced' ? 12000 : 24000,
        raid: answers.reliability === 'resilient' ? 'RAIDZ2 / SHR-2' : 'Mirror / SHR',
        planner_role: 'storage',
      },
      vms: [],
      internal_components: [],
    });
  }

  if (answers.goals.includes('home') || answers.goals.includes('network')) {
    nodes.push({
      id: crypto.randomUUID(),
      type: 'access_point',
      name: 'Wi-Fi Access Point',
      x: 990,
      y: 90,
      power_draw: 12,
      details: { wireless_standard: 'Wi-Fi 6', planner_role: 'wireless' },
      vms: [],
      internal_components: [],
    });
  }

  if (answers.footprint === 'rack' || answers.reliability === 'resilient') {
    nodes.push({
      id: crypto.randomUUID(),
      type: 'ups',
      name: 'UPS',
      x: 990,
      y: 520,
      power_draw: 5,
      details: { capacity_va: answers.budget === 'enthusiast' ? 1500 : 900, planner_role: 'power' },
      vms: [],
      internal_components: [],
    });
  }

  let switchPort = 1;
  for (const node of nodes) {
    if (node.id === routerID || node.id === switchID || node.type === 'rack' || node.type === 'ups')
      continue;
    edges.push({
      source: switchID,
      source_handle: `eth${switchPort++}`,
      target: node.id,
      target_handle: 'target-0',
      type: node.type === 'access_point' ? 'wireless' : 'ethernet',
      speed: answers.budget === 'enthusiast' && node.type !== 'access_point' ? '10 GbE' : '1 GbE',
      wireless_standard: node.type === 'access_point' ? 'Wi-Fi 6' : '',
      direction: 'lan',
    });
  }

  const computeNodes = nodes.filter(node => computeIDs.includes(node.id));
  answers.goals.forEach((goal, index) => {
    const host = computeNodes[index % Math.max(computeNodes.length, 1)];
    if (!host) return;
    const catalogService = chooseService(goal, services);
    const fallbackName = GOALS.find(item => item.id === goal)?.label || goal;
    host.vms.push({
      id: crypto.randomUUID(),
      name: catalogService?.name || fallbackName,
      type: 'container',
      status: 'running',
      cpu_cores: catalogService?.requirements?.min_cpu_cores || 1,
      ram_mb: catalogService?.requirements?.min_ram_mb || 512,
      details: {
        catalog_service_id: catalogService?.id || '',
        catalog_service_name: catalogService?.name || fallbackName,
        planner_goal: goal,
      },
    });
  });

  return {
    name: answers.name.trim() || 'Guided Homelab',
    thumbnail: '',
    settings: {
      planner: answers,
      boughtItems: [],
      showBought: false,
    },
    nodes,
    edges,
    services: [],
  };
}

function ChoiceCard({
  selected,
  onClick,
  title,
  description,
  meta,
  icon: Icon,
}: {
  selected: boolean;
  onClick: () => void;
  title: string;
  description: string;
  meta?: string;
  icon?: typeof Home;
}) {
  return (
    <button
      type="button"
      aria-pressed={selected}
      onClick={onClick}
      className={`min-h-32 rounded-2xl border p-5 text-left transition-all focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-primary ${
        selected
          ? 'border-primary bg-primary/10 shadow-[0_14px_36px_-24px_var(--primary)]'
          : 'border-border bg-card hover:-translate-y-0.5 hover:border-primary/40 hover:bg-muted/30'
      }`}
    >
      <div className="flex items-start justify-between gap-4">
        {Icon && (
          <Icon className={`size-5 ${selected ? 'text-primary' : 'text-muted-foreground'}`} />
        )}
        <span
          className={`grid size-5 place-items-center rounded-full border ${selected ? 'border-primary bg-primary text-primary-foreground' : 'border-muted-foreground/30'}`}
        >
          {selected && <Check className="size-3" />}
        </span>
      </div>
      <h3 className="mt-4 font-semibold">{title}</h3>
      <p className="mt-1 text-sm leading-relaxed text-muted-foreground">{description}</p>
      {meta && (
        <p className="mt-3 text-xs font-semibold uppercase tracking-wider text-primary">{meta}</p>
      )}
    </button>
  );
}

export default function GuidedPlannerPage() {
  const navigate = useNavigate();
  const { availableServices, fetchServices, loadBuild } = useBuilderStore();
  const [step, setStep] = useState(0);
  const [creating, setCreating] = useState(false);
  const [answers, setAnswers] = useState<PlannerAnswers>({
    goals: ['backup', 'network'],
    footprint: 'compact',
    budget: 'balanced',
    reliability: 'simple',
    name: 'My Guided Homelab',
  });

  useEffect(() => {
    void fetchServices();
  }, [fetchServices]);

  const preview = useMemo(
    () => buildPlan(answers, availableServices),
    [answers, availableServices],
  );
  const previewNodes = preview.nodes as PlannedNode[];
  const serviceCount = previewNodes.reduce((sum, node) => sum + node.vms.length, 0);
  const estimatedWatts = previewNodes.reduce((sum, node) => sum + (node.power_draw || 0), 0);

  const toggleGoal = (goal: Goal) => {
    setAnswers(current => ({
      ...current,
      goals: current.goals.includes(goal)
        ? current.goals.filter(item => item !== goal)
        : [...current.goals, goal],
    }));
  };

  const createLab = async () => {
    setCreating(true);
    let createdID: string | null = null;
    try {
      const created = await buildApi.create({
        ...preview,
        nodes: [],
        edges: [],
        services: [],
      });
      createdID = created.id;
      const result = await buildApi.updateTopology(created.id, {
        ...preview,
        revision: created.revision,
      });
      loadBuild(result.build.id, result.build.name, result.build);
      toast.success('Your guided lab is ready to edit.');
      navigate(`/builder/${result.build.id}`);
    } catch (error) {
      if (createdID) {
        await buildApi.delete(createdID).catch(() => undefined);
      }
      console.error('Failed to create guided lab', error);
      toast.error('Could not create the guided lab. No partial project was kept.');
    } finally {
      setCreating(false);
    }
  };

  const canContinue = step !== 0 || answers.goals.length > 0;

  return (
    <main className="mx-auto w-full max-w-6xl px-4 py-6 sm:px-6 sm:py-10">
      <header className="relative overflow-hidden rounded-3xl border bg-card p-6 sm:p-9">
        <div className="pointer-events-none absolute -right-24 -top-24 size-72 rounded-full bg-primary/15 blur-3xl" />
        <div className="relative max-w-3xl">
          <div className="mb-4 flex items-center gap-2 text-xs font-semibold uppercase tracking-[0.2em] text-primary">
            <Sparkles className="size-4" />
            Guided Lab Planner
          </div>
          <h1 className="text-3xl font-semibold tracking-tight sm:text-5xl">
            Turn your goals into a working topology.
          </h1>
          <p className="mt-4 max-w-2xl text-sm leading-7 text-muted-foreground sm:text-base">
            Choose what the lab should do. HLBuilder creates the devices, connections, service
            placements, and IP plan so you can refine instead of starting from an empty canvas.
          </p>
        </div>
      </header>

      <div className="mt-6 grid gap-6 lg:grid-cols-[minmax(0,1fr)_18rem]">
        <Card className="overflow-hidden">
          <div className="flex items-center gap-2 border-b px-5 py-4 sm:px-7">
            {['Goals', 'Shape', 'Budget', 'Review'].map((label, index) => (
              <div key={label} className="flex min-w-0 flex-1 items-center gap-2">
                <span
                  className={`grid size-7 shrink-0 place-items-center rounded-full text-xs font-semibold ${index <= step ? 'bg-primary text-primary-foreground' : 'bg-muted text-muted-foreground'}`}
                >
                  {index < step ? <Check className="size-3.5" /> : index + 1}
                </span>
                <span className="hidden truncate text-xs font-medium sm:block">{label}</span>
                {index < 3 && <span className="h-px flex-1 bg-border" />}
              </div>
            ))}
          </div>

          <section className="p-5 sm:p-7" aria-live="polite">
            {step === 0 && (
              <fieldset>
                <legend className="text-2xl font-semibold">What should your lab do?</legend>
                <p className="mt-2 text-sm text-muted-foreground">
                  Pick every goal that matters. Services stay editable after creation.
                </p>
                <div className="mt-6 grid gap-3 sm:grid-cols-2 lg:grid-cols-3">
                  {GOALS.map(goal => (
                    <ChoiceCard
                      key={goal.id}
                      selected={answers.goals.includes(goal.id)}
                      onClick={() => toggleGoal(goal.id)}
                      title={goal.label}
                      description={goal.description}
                      icon={goal.icon}
                    />
                  ))}
                </div>
              </fieldset>
            )}

            {step === 1 && (
              <fieldset>
                <legend className="text-2xl font-semibold">Where will it live?</legend>
                <p className="mt-2 text-sm text-muted-foreground">
                  This changes the compute, storage, rack, and cloud layout.
                </p>
                <div className="mt-6 grid gap-3 sm:grid-cols-2">
                  {FOOTPRINTS.map(item => (
                    <ChoiceCard
                      key={item.id}
                      selected={answers.footprint === item.id}
                      onClick={() => setAnswers(current => ({ ...current, footprint: item.id }))}
                      title={item.label}
                      description={item.description}
                      icon={item.id === 'cloud' ? Cloud : Server}
                    />
                  ))}
                </div>
              </fieldset>
            )}

            {step === 2 && (
              <div className="space-y-8">
                <fieldset>
                  <legend className="text-2xl font-semibold">Set the spending lane</legend>
                  <div className="mt-5 grid gap-3 sm:grid-cols-3">
                    {BUDGETS.map(item => (
                      <ChoiceCard
                        key={item.id}
                        selected={answers.budget === item.id}
                        onClick={() => setAnswers(current => ({ ...current, budget: item.id }))}
                        title={item.label}
                        description={item.description}
                        meta={item.range}
                        icon={Wallet}
                      />
                    ))}
                  </div>
                </fieldset>
                <fieldset>
                  <legend className="text-lg font-semibold">Failure tolerance</legend>
                  <div className="mt-4 grid gap-3 sm:grid-cols-2">
                    <ChoiceCard
                      selected={answers.reliability === 'simple'}
                      onClick={() => setAnswers(current => ({ ...current, reliability: 'simple' }))}
                      title="Keep it simple"
                      description="One compute path and fewer devices to maintain."
                      icon={Gauge}
                    />
                    <ChoiceCard
                      selected={answers.reliability === 'resilient'}
                      onClick={() =>
                        setAnswers(current => ({ ...current, reliability: 'resilient' }))
                      }
                      title="Add recovery capacity"
                      description="A second compute target plus protected power where useful."
                      icon={ShieldCheck}
                    />
                  </div>
                </fieldset>
              </div>
            )}

            {step === 3 && (
              <div>
                <label htmlFor="planner-name" className="text-sm font-semibold">
                  Project name
                </label>
                <input
                  id="planner-name"
                  value={answers.name}
                  onChange={event =>
                    setAnswers(current => ({ ...current, name: event.target.value }))
                  }
                  className="mt-2 h-12 w-full rounded-xl border bg-background px-4 text-base focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-primary"
                />
                <div className="mt-6 rounded-2xl border bg-muted/25 p-5">
                  <h2 className="text-xl font-semibold">Your editable starter lab</h2>
                  <div className="mt-5 grid grid-cols-2 gap-3 sm:grid-cols-4">
                    {[
                      ['Devices', previewNodes.length],
                      ['Connections', preview.edges.length],
                      ['Services', serviceCount],
                      ['Estimated draw', `${estimatedWatts} W`],
                    ].map(([label, value]) => (
                      <div key={label} className="rounded-xl border bg-card p-3">
                        <p className="text-2xl font-semibold">{value}</p>
                        <p className="mt-1 text-xs text-muted-foreground">{label}</p>
                      </div>
                    ))}
                  </div>
                  <ul className="mt-5 space-y-2 text-sm text-muted-foreground">
                    {previewNodes
                      .filter(node => node.type !== 'rack' && node.type !== 'ups')
                      .map(node => (
                        <li
                          key={node.id}
                          className="flex items-center justify-between gap-3 border-b border-border/60 pb-2 last:border-0"
                        >
                          <span>{node.name}</span>
                          <span className="text-xs uppercase tracking-wider">
                            {node.type.replace('_', ' ')}
                          </span>
                        </li>
                      ))}
                  </ul>
                </div>
              </div>
            )}
          </section>

          <footer className="flex flex-col-reverse gap-3 border-t bg-muted/20 px-5 py-4 sm:flex-row sm:items-center sm:justify-between sm:px-7">
            <Button
              variant="ghost"
              onClick={() => (step === 0 ? navigate('/') : setStep(current => current - 1))}
            >
              <ArrowLeft className="size-4" />
              {step === 0 ? 'Back to projects' : 'Previous'}
            </Button>
            {step < 3 ? (
              <Button disabled={!canContinue} onClick={() => setStep(current => current + 1)}>
                Continue
                <ArrowRight className="size-4" />
              </Button>
            ) : (
              <Button disabled={creating || !answers.name.trim()} onClick={createLab}>
                {creating ? (
                  <Loader2 className="size-4 animate-spin" />
                ) : (
                  <Sparkles className="size-4" />
                )}
                {creating ? 'Building topology...' : 'Create this lab'}
              </Button>
            )}
          </footer>
        </Card>

        <aside className="h-fit rounded-2xl border bg-card p-5 lg:sticky lg:top-6">
          <p className="text-xs font-semibold uppercase tracking-[0.18em] text-muted-foreground">
            Live plan
          </p>
          <div className="mt-4 space-y-4">
            <div>
              <p className="text-3xl font-semibold">{previewNodes.length}</p>
              <p className="text-sm text-muted-foreground">planned devices</p>
            </div>
            <div className="h-px bg-border" />
            <div className="flex flex-wrap gap-2">
              {answers.goals.map(goal => (
                <span
                  key={goal}
                  className="rounded-full bg-primary/10 px-2.5 py-1 text-xs font-medium text-primary"
                >
                  {GOALS.find(item => item.id === goal)?.label}
                </span>
              ))}
            </div>
            <p className="text-xs leading-5 text-muted-foreground">
              The planner uses real catalog services when a match exists. Missing catalog matches
              remain clearly labeled placeholders in the editable design.
            </p>
          </div>
        </aside>
      </div>
    </main>
  );
}
