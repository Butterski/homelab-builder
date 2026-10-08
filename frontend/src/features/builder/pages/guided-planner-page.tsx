import { useEffect, useMemo, useState } from 'react';
import { useNavigate, useSearchParams } from 'react-router-dom';
import { Loader2 } from 'lucide-react';
import { toast } from 'sonner';
import { Page, PageHeader } from '../../../components/layout/page';
import { Button } from '../../../components/ui/button';
import { hardwareTypeName } from '../../../lib/hardware-taxonomy';
import { formatMemory } from '../../../lib/format';
import { cn } from '../../../lib/utils';
import type { BuildKind, GameExposure, Service } from '../../../types';
import { createBuildWithTopology } from '../api/create-build';
import { useBuilderStore } from '../store/builder-store';
import { BUILD_KINDS, buildKindInfo } from '../../gaming/lib/kind';
import { EXPOSURES, sizeServer } from '../../gaming/lib/sizing';
import { ChoiceCard, NumberField, ToggleRow } from '../components/planner/choice-card';
import { buildHomelabPlan } from '../lib/planner/homelab-plan';
import {
  MAX_PARTY_SEATS,
  buildLanPartyPlan,
  circuitsNeeded,
  hasPartyServer,
  seatsPerTable,
  tablesNeeded,
} from '../lib/planner/lan-party-plan';
import { MAX_PLANNED_GAMES, buildGameServerPlan } from '../lib/planner/game-server-plan';
import {
  GOAL_LABELS,
  type Budget,
  type Footprint,
  type GameServerAnswers,
  type Goal,
  type LanPartyAnswers,
  type Plan,
  type PlannerAnswers,
} from '../lib/planner/types';

const GOALS: Array<{ id: Goal; description: string }> = [
  { id: 'backup', description: 'Protect family files and device backups.' },
  { id: 'media', description: 'Run a private movie and music library.' },
  { id: 'home', description: 'Keep automations local and dependable.' },
  { id: 'network', description: 'DNS filtering, Wi-Fi, and visibility.' },
  { id: 'development', description: 'Git, CI, containers, and test services.' },
  { id: 'security', description: 'A safer VPN entry point to your lab.' },
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

const STEPS: Record<BuildKind, string[]> = {
  homelab: ['Goals', 'Shape', 'Budget', 'Review'],
  lan_party: ['Seats', 'Venue', 'Servers', 'Review'],
  game_server: ['Games', 'Hosting', 'Review'],
};

const INTRO: Record<BuildKind | 'none', { title: string; text: string }> = {
  none: {
    title: 'Turn your goals into a working topology.',
    text: 'Say what you are planning. HLBuilder creates the devices, connections and IP plan so you can refine instead of starting from an empty canvas.',
  },
  homelab: {
    title: 'Turn your goals into a working topology.',
    text: 'Choose what the lab should do. HLBuilder creates the devices, connections, service placements, and IP plan so you can refine instead of starting from an empty canvas.',
  },
  lan_party: {
    title: 'Plan the room before anyone carries a PC in.',
    text: 'Enter the seats and what the venue offers. HLBuilder lays out tables, switches and power circuits, and checks addresses and breakers.',
  },
  game_server: {
    title: 'A server your friends can actually join.',
    text: 'Pick the games and the group size. HLBuilder sizes the host and works out the ports to forward and the upload you need.',
  },
};

const isKind = (value: string | null): value is BuildKind =>
  BUILD_KINDS.some(entry => entry.kind === value);

const games = (services: Service[]) => services.filter(service => service.game?.role === 'game');

/** The question a step asks, and a sentence on what the answer changes. */
const QUESTION = 'text-xl font-semibold tracking-[-0.01em]';
const QUESTION_NOTE = 'mt-1.5 max-w-2xl text-sm text-muted-foreground';

export default function GuidedPlannerPage() {
  const navigate = useNavigate();
  const [searchParams] = useSearchParams();
  const availableServices = useBuilderStore(state => state.availableServices);
  const fetchServices = useBuilderStore(state => state.fetchServices);
  const loadBuild = useBuilderStore(state => state.loadBuild);
  const presetKind = searchParams.get('kind');
  // A link such as /planner?kind=lan_party goes straight to that plan.
  const [kind, setKind] = useState<BuildKind | null>(isKind(presetKind) ? presetKind : null);
  const [picked, setPicked] = useState<BuildKind>('homelab');
  const [step, setStep] = useState(0);
  const [creating, setCreating] = useState(false);

  const [answers, setAnswers] = useState<PlannerAnswers>({
    goals: ['backup', 'network'],
    footprint: 'compact',
    budget: 'balanced',
    reliability: 'simple',
    name: 'My Guided Homelab',
  });
  const [party, setParty] = useState<LanPartyAnswers>({
    name: 'My LAN Party',
    seats: 16,
    consoles: 0,
    wifi: true,
    mainsVoltage: 230,
    breakerAmps: 16,
    circuits: 2,
    downMbps: 0,
    upMbps: 0,
    hours: 24,
    games: [],
    lancache: true,
  });
  const [server, setServer] = useState<GameServerAnswers>({
    name: 'My Game Server',
    games: [],
    location: 'home',
    exposure: 'port_forward',
    downMbps: 0,
    upMbps: 0,
    cgnat: '',
    voice: false,
  });

  useEffect(() => {
    // The catalog stays in the store for the session; it is asked for once.
    if (useBuilderStore.getState().availableServices.length === 0) void fetchServices();
  }, [fetchServices]);

  const gameCatalog = useMemo(() => games(availableServices), [availableServices]);

  const preview: Plan = useMemo(() => {
    if (kind === 'lan_party') return buildLanPartyPlan(party, availableServices);
    if (kind === 'game_server') return buildGameServerPlan(server, availableServices);
    return buildHomelabPlan(answers, availableServices);
  }, [kind, answers, party, server, availableServices]);

  const previewNodes = preview.nodes;
  const serviceCount = previewNodes.reduce((sum, node) => sum + node.vms.length, 0);
  const estimatedWatts = previewNodes.reduce((sum, node) => sum + (node.power_draw || 0), 0);

  const steps = kind ? STEPS[kind] : [];
  const lastStep = steps.length - 1;
  const name =
    kind === 'lan_party' ? party.name : kind === 'game_server' ? server.name : answers.name;
  const setName = (value: string) => {
    if (kind === 'lan_party') setParty(current => ({ ...current, name: value }));
    else if (kind === 'game_server') setServer(current => ({ ...current, name: value }));
    else setAnswers(current => ({ ...current, name: value }));
  };

  const toggleGoal = (goal: Goal) => {
    setAnswers(current => ({
      ...current,
      goals: current.goals.includes(goal)
        ? current.goals.filter(item => item !== goal)
        : [...current.goals, goal],
    }));
  };

  const togglePartyGame = (slug: string) => {
    setParty(current => ({
      ...current,
      games: current.games.includes(slug)
        ? current.games.filter(item => item !== slug)
        : [...current.games, slug],
    }));
  };

  const toggleServerGame = (service: Service) => {
    const slug = service.game!.slug;
    setServer(current => ({
      ...current,
      games: current.games.some(game => game.slug === slug)
        ? current.games.filter(game => game.slug !== slug)
        : [...current.games, { slug, players: service.game!.default_players }].slice(
            0,
            MAX_PLANNED_GAMES,
          ),
    }));
  };

  const setServerPlayers = (slug: string, players: number) => {
    setServer(current => ({
      ...current,
      games: current.games.map(game => (game.slug === slug ? { ...game, players } : game)),
    }));
  };

  const createLab = async () => {
    setCreating(true);
    try {
      const build = await createBuildWithTopology(preview);
      loadBuild(build.id, build.name, build);
      toast.success(
        kind === 'homelab' ? 'Your guided lab is ready to edit.' : 'Your plan is ready to edit.',
      );
      navigate(`/builder/${build.id}`);
    } catch (error) {
      console.error('Failed to create guided lab', error);
      toast.error('Could not create the plan. No partial project was kept.');
    } finally {
      setCreating(false);
    }
  };

  const canContinue =
    kind === 'homelab'
      ? step !== 0 || answers.goals.length > 0
      : kind === 'game_server'
        ? step !== 0 || server.games.length > 0
        : true;

  const goBack = () => {
    if (kind && step > 0) setStep(current => current - 1);
    else if (kind && !isKind(presetKind)) setKind(null);
    else navigate('/');
  };

  const intro = INTRO[kind ?? 'none'];
  const perTable = seatsPerTable(party.mainsVoltage, party.breakerAmps);
  const tableCount = tablesNeeded(party);
  const circuitCount = circuitsNeeded(party);
  const serverTotals = server.games.reduce(
    (total, game) => {
      const profile = gameCatalog.find(service => service.game?.slug === game.slug)?.game;
      if (!profile) return total;
      const sizing = sizeServer(profile, game.players);
      return {
        ram: total.ram + sizing.ram_mb,
        cpu: total.cpu + sizing.cpu_cores,
        upload: total.upload + sizing.upload_kbps,
      };
    },
    { ram: 0, cpu: 0, upload: 0 },
  );

  return (
    <Page width="article" className="pb-20">
      <PageHeader title={intro.title} lede={intro.text} />

      <div className="grid gap-x-12 gap-y-8 pt-6 lg:grid-cols-[minmax(0,1fr)_17rem]">
        <div className="min-w-0">
          {kind && (
            <ol className="flex flex-wrap gap-x-7 border-b text-sm" aria-label="Steps of the plan">
              {steps.map((label, index) => (
                <li
                  key={label}
                  aria-current={index === step ? 'step' : undefined}
                  className={cn(
                    '-mb-px flex items-baseline gap-2 border-b-2 pb-3',
                    index === step
                      ? 'border-foreground font-medium text-foreground'
                      : 'border-transparent text-muted-foreground',
                  )}
                >
                  <span className="app-figure text-xs">{index + 1}</span>
                  {label}
                  {index < step && <span className="sr-only"> (answered)</span>}
                </li>
              ))}
            </ol>
          )}

          <section className={cn('pb-8', kind && 'pt-7')} aria-live="polite">
            {!kind && (
              <fieldset>
                <legend className={QUESTION}>What are you planning?</legend>
                <p className={QUESTION_NOTE}>
                  Each plan asks different questions and adds its own checks.
                </p>
                <div className="mt-5 grid gap-3 sm:grid-cols-3">
                  {BUILD_KINDS.map(entry => (
                    <ChoiceCard
                      key={entry.kind}
                      selected={picked === entry.kind}
                      onClick={() => setPicked(entry.kind)}
                      title={entry.label}
                      description={entry.description}
                    />
                  ))}
                </div>
              </fieldset>
            )}

            {/* ── Homelab ─────────────────────────────────────────────── */}
            {kind === 'homelab' && step === 0 && (
              <fieldset>
                <legend className={QUESTION}>What should your lab do?</legend>
                <p className={QUESTION_NOTE}>
                  Pick every goal that matters. Services stay editable after creation.
                </p>
                <div className="mt-5 grid gap-3 sm:grid-cols-2 xl:grid-cols-3">
                  {GOALS.map(goal => (
                    <ChoiceCard
                      key={goal.id}
                      multiple
                      selected={answers.goals.includes(goal.id)}
                      onClick={() => toggleGoal(goal.id)}
                      title={GOAL_LABELS[goal.id]}
                      description={goal.description}
                    />
                  ))}
                </div>
              </fieldset>
            )}

            {kind === 'homelab' && step === 1 && (
              <fieldset>
                <legend className={QUESTION}>Where will it live?</legend>
                <p className={QUESTION_NOTE}>
                  This changes the compute, storage, rack, and cloud layout.
                </p>
                <div className="mt-5 grid gap-3 sm:grid-cols-2">
                  {FOOTPRINTS.map(item => (
                    <ChoiceCard
                      key={item.id}
                      selected={answers.footprint === item.id}
                      onClick={() => setAnswers(current => ({ ...current, footprint: item.id }))}
                      title={item.label}
                      description={item.description}
                    />
                  ))}
                </div>
              </fieldset>
            )}

            {kind === 'homelab' && step === 2 && (
              <div className="space-y-9">
                <fieldset>
                  <legend className={QUESTION}>Set the spending lane</legend>
                  <div className="mt-5 grid gap-3 sm:grid-cols-3">
                    {BUDGETS.map(item => (
                      <ChoiceCard
                        key={item.id}
                        selected={answers.budget === item.id}
                        onClick={() => setAnswers(current => ({ ...current, budget: item.id }))}
                        title={item.label}
                        description={item.description}
                        meta={item.range}
                      />
                    ))}
                  </div>
                </fieldset>
                <fieldset>
                  <legend className="text-base font-semibold">Failure tolerance</legend>
                  <div className="mt-4 grid gap-3 sm:grid-cols-2">
                    <ChoiceCard
                      selected={answers.reliability === 'simple'}
                      onClick={() => setAnswers(current => ({ ...current, reliability: 'simple' }))}
                      title="Keep it simple"
                      description="One compute path and fewer devices to maintain."
                    />
                    <ChoiceCard
                      selected={answers.reliability === 'resilient'}
                      onClick={() =>
                        setAnswers(current => ({ ...current, reliability: 'resilient' }))
                      }
                      title="Add recovery capacity"
                      description="A second compute target plus protected power where useful."
                    />
                  </div>
                </fieldset>
              </div>
            )}

            {/* ── LAN party ───────────────────────────────────────────── */}
            {kind === 'lan_party' && step === 0 && (
              <fieldset>
                <legend className={QUESTION}>Who is coming?</legend>
                <p className={QUESTION_NOTE}>
                  Seats are grouped into tables, each with its own small switch.
                </p>
                <div className="mt-5 grid gap-5 sm:grid-cols-2">
                  <NumberField
                    id="party-seats"
                    label="Players with a PC"
                    hint={`Up to ${MAX_PARTY_SEATS}. Each gets a seat at a table.`}
                    value={party.seats}
                    min={1}
                    max={MAX_PARTY_SEATS}
                    onChange={seats => setParty(current => ({ ...current, seats }))}
                  />
                  <NumberField
                    id="party-consoles"
                    label="Consoles"
                    hint="PlayStation, Xbox or Switch plugged in next to the tables."
                    value={party.consoles}
                    max={16}
                    onChange={consoles => setParty(current => ({ ...current, consoles }))}
                  />
                </div>
                <div className="mt-6">
                  <ToggleRow
                    checked={party.wifi}
                    onChange={wifi => setParty(current => ({ ...current, wifi }))}
                    title="Wi-Fi for phones and handhelds"
                    description="Adds an access point and reserves an address for one extra device per player."
                  />
                </div>
              </fieldset>
            )}

            {kind === 'lan_party' && step === 1 && (
              <fieldset>
                <legend className={QUESTION}>What does the venue offer?</legend>
                <p className={QUESTION_NOTE}>
                  Power is what ends LAN parties early. A gaming PC with a monitor is planned at 350
                  W.
                </p>
                <div className="mt-5 grid gap-5 sm:grid-cols-3">
                  <NumberField
                    id="party-voltage"
                    label="Mains voltage"
                    value={party.mainsVoltage}
                    min={100}
                    max={240}
                    unit="V"
                    onChange={mainsVoltage => setParty(current => ({ ...current, mainsVoltage }))}
                  />
                  <NumberField
                    id="party-breaker"
                    label="Breaker rating"
                    value={party.breakerAmps}
                    min={1}
                    max={125}
                    unit="A"
                    onChange={breakerAmps => setParty(current => ({ ...current, breakerAmps }))}
                  />
                  <NumberField
                    id="party-circuits"
                    label="Separate circuits"
                    value={party.circuits}
                    min={1}
                    max={32}
                    onChange={circuits => setParty(current => ({ ...current, circuits }))}
                  />
                </div>
                <p
                  className={cn(
                    'mt-5 border-y py-3 text-sm',
                    circuitCount > party.circuits ? 'text-destructive' : 'text-muted-foreground',
                  )}
                >
                  One circuit safely carries a table of {perTable}. {party.seats} players need{' '}
                  {tableCount} {tableCount === 1 ? 'table' : 'tables'}
                  {hasPartyServer(party) && ', and the server a circuit of its own'}
                  {circuitCount > party.circuits
                    ? `: ${circuitCount} circuits, ${circuitCount - party.circuits} more than you entered.`
                    : `: ${circuitCount} ${circuitCount === 1 ? 'circuit' : 'circuits'}.`}
                </p>
                <div className="mt-6 grid gap-5 sm:grid-cols-3">
                  <NumberField
                    id="party-down"
                    label="Download speed"
                    hint="Leave 0 if you do not know yet."
                    value={party.downMbps}
                    unit="Mbps"
                    onChange={downMbps => setParty(current => ({ ...current, downMbps }))}
                  />
                  <NumberField
                    id="party-up"
                    label="Upload speed"
                    value={party.upMbps}
                    unit="Mbps"
                    onChange={upMbps => setParty(current => ({ ...current, upMbps }))}
                  />
                  <NumberField
                    id="party-hours"
                    label="Length of the event"
                    value={party.hours}
                    unit="hours"
                    onChange={hours => setParty(current => ({ ...current, hours }))}
                  />
                </div>
              </fieldset>
            )}

            {kind === 'lan_party' && step === 2 && (
              <fieldset>
                <legend className={QUESTION}>Anything to host on site?</legend>
                <p className={QUESTION_NOTE}>
                  A local server keeps matches inside the room. Skip this to play on public servers.
                </p>
                <div className="mt-5">
                  <ToggleRow
                    checked={party.lancache}
                    onChange={lancache => setParty(current => ({ ...current, lancache }))}
                    title="Download cache (LANCache)"
                    description="A game update is downloaded once and served to everyone else at LAN speed."
                  />
                </div>
                <GamePicker
                  catalog={gameCatalog}
                  isSelected={slug => party.games.includes(slug)}
                  onToggle={service => togglePartyGame(service.game!.slug)}
                />
              </fieldset>
            )}

            {/* ── Game server ─────────────────────────────────────────── */}
            {kind === 'game_server' && step === 0 && (
              <fieldset>
                <legend className={QUESTION}>Which games, for how many?</legend>
                <p className={QUESTION_NOTE}>
                  Memory and upload scale with the number of players online at once.
                </p>
                <GamePicker
                  catalog={gameCatalog}
                  isSelected={slug => server.games.some(game => game.slug === slug)}
                  onToggle={toggleServerGame}
                />
                {server.games.length > 0 && (
                  <div className="mt-6 grid gap-5 sm:grid-cols-2">
                    {server.games.map(game => {
                      const service = gameCatalog.find(item => item.game?.slug === game.slug);
                      if (!service?.game) return null;
                      const sizing = sizeServer(service.game, game.players);
                      return (
                        <NumberField
                          key={game.slug}
                          id={`players-${game.slug}`}
                          label={`${service.name}: players`}
                          hint={`Needs about ${formatMemory(sizing.ram_mb)} and ${sizing.cpu_cores} cores.`}
                          value={game.players}
                          min={1}
                          max={service.game.max_players}
                          onChange={players => setServerPlayers(game.slug, players)}
                        />
                      );
                    })}
                  </div>
                )}
              </fieldset>
            )}

            {kind === 'game_server' && step === 1 && (
              <div className="space-y-9">
                <fieldset>
                  <legend className={QUESTION}>Where does it run?</legend>
                  <div className="mt-5 grid gap-3 sm:grid-cols-2">
                    <ChoiceCard
                      selected={server.location === 'home'}
                      onClick={() => setServer(current => ({ ...current, location: 'home' }))}
                      title="At home"
                      description="A mini PC or server behind your own router."
                    />
                    <ChoiceCard
                      selected={server.location === 'vps'}
                      onClick={() => setServer(current => ({ ...current, location: 'vps' }))}
                      title="Rented VPS"
                      description="A server in a data centre with a public address and its own line."
                    />
                  </div>
                </fieldset>
                {server.location === 'home' && (
                  <fieldset>
                    <legend className="text-base font-semibold">How do friends reach it?</legend>
                    <div className="mt-4 grid gap-3 sm:grid-cols-2">
                      {EXPOSURES.map(option => (
                        <ChoiceCard
                          key={option.value}
                          selected={server.exposure === option.value}
                          onClick={() =>
                            setServer(current => ({
                              ...current,
                              exposure: option.value as GameExposure,
                            }))
                          }
                          title={option.label}
                          description={option.hint}
                        />
                      ))}
                    </div>
                    <div className="mt-6 grid gap-5 sm:grid-cols-2">
                      <NumberField
                        id="server-up"
                        label="Upload speed of your line"
                        hint="Leave 0 if you do not know yet."
                        value={server.upMbps}
                        unit="Mbps"
                        onChange={upMbps => setServer(current => ({ ...current, upMbps }))}
                      />
                      <NumberField
                        id="server-down"
                        label="Download speed"
                        value={server.downMbps}
                        unit="Mbps"
                        onChange={downMbps => setServer(current => ({ ...current, downMbps }))}
                      />
                    </div>
                    <div className="mt-5">
                      <label htmlFor="server-cgnat" className="text-sm font-medium">
                        Does your provider give you a public IPv4 address?
                      </label>
                      <select
                        id="server-cgnat"
                        value={server.cgnat}
                        onChange={event =>
                          setServer(current => ({
                            ...current,
                            cgnat: event.target.value as GameServerAnswers['cgnat'],
                          }))
                        }
                        className="mt-1.5 h-10 w-full rounded-md border border-input bg-background px-3 text-sm focus-visible:outline-none focus-visible:ring-1 focus-visible:ring-ring"
                      >
                        <option value="">I do not know</option>
                        <option value="no">Yes, a public address</option>
                        <option value="yes">No, I am behind carrier-grade NAT</option>
                      </select>
                    </div>
                  </fieldset>
                )}
                <ToggleRow
                  checked={server.voice}
                  onChange={voice => setServer(current => ({ ...current, voice }))}
                  title="Voice chat (Mumble)"
                  description="A small voice server next to the games."
                />
              </div>
            )}

            {/* ── Review, shared ──────────────────────────────────────── */}
            {kind && step === lastStep && (
              <div>
                <label htmlFor="planner-name" className="block text-sm font-medium">
                  Project name
                </label>
                <input
                  id="planner-name"
                  value={name}
                  onChange={event => setName(event.target.value)}
                  className="mt-1.5 h-10 w-full max-w-md rounded-md border border-input bg-transparent px-3 text-sm focus-visible:outline-none focus-visible:ring-1 focus-visible:ring-ring"
                />

                <h2 className={cn(QUESTION, 'mt-8')}>
                  {kind === 'homelab' ? 'Your editable starter lab' : 'Your editable plan'}
                </h2>
                <dl className="mt-4 grid grid-cols-2 gap-y-3 border-y py-3 sm:grid-cols-4">
                  {(
                    [
                      ['Devices', previewNodes.length],
                      ['Connections', preview.edges.length],
                      ['Services', serviceCount],
                      ['Estimated draw', `${estimatedWatts} W`],
                    ] as const
                  ).map(([label, value]) => (
                    <div key={label}>
                      <dt className="text-sm text-muted-foreground">{label}</dt>
                      <dd className="app-figure text-xl">{value}</dd>
                    </div>
                  ))}
                </dl>
                <div className="app-table-scroll mt-2">
                  <table className="app-table">
                    <thead>
                      <tr>
                        <th scope="col">Device</th>
                        <th scope="col">Runs</th>
                        <th scope="col" className="is-end">
                          Type
                        </th>
                      </tr>
                    </thead>
                    <tbody>
                      {previewNodes
                        .filter(node => node.type !== 'rack' && node.type !== 'ups')
                        .map(node => (
                          <tr key={node.id}>
                            <th scope="row">{node.name}</th>
                            <td className="text-muted-foreground">
                              {node.vms.map(vm => vm.name).join(', ')}
                            </td>
                            <td className="is-end whitespace-nowrap text-muted-foreground">
                              {node.type === 'lan_table'
                                ? `${node.details.seats} seats`
                                : hardwareTypeName(node.type)}
                            </td>
                          </tr>
                        ))}
                    </tbody>
                  </table>
                </div>
              </div>
            )}
          </section>

          <footer className="flex flex-col-reverse gap-3 border-t pt-5 sm:flex-row sm:items-center sm:justify-between">
            <Button variant="ghost" onClick={goBack}>
              {!kind || (step === 0 && isKind(presetKind)) ? 'Back to projects' : 'Previous'}
            </Button>
            {!kind ? (
              <Button
                onClick={() => {
                  setKind(picked);
                  setStep(0);
                }}
              >
                Continue
              </Button>
            ) : step < lastStep ? (
              <Button disabled={!canContinue} onClick={() => setStep(current => current + 1)}>
                Continue
              </Button>
            ) : (
              <Button disabled={creating || !name.trim()} onClick={createLab}>
                {creating && <Loader2 className="animate-spin" aria-hidden="true" />}
                {creating
                  ? 'Building topology...'
                  : kind === 'homelab'
                    ? 'Create this lab'
                    : 'Create this plan'}
              </Button>
            )}
          </footer>
        </div>

        <aside className="h-fit lg:sticky lg:top-6 lg:border-l lg:pl-8">
          <h2 className="text-sm text-muted-foreground">The plan so far</h2>
          <div className="mt-3 space-y-4">
            {!kind && (
              <p className="text-sm leading-6 text-muted-foreground">
                {buildKindInfo(picked).description}
              </p>
            )}
            {kind && (
              <p>
                <span className="app-figure text-3xl">{previewNodes.length}</span>{' '}
                <span className="text-sm text-muted-foreground">planned devices</span>
              </p>
            )}
            {kind === 'homelab' && (
              <>
                <ul className="grid border-t text-sm">
                  {answers.goals.map(goal => (
                    <li key={goal} className="border-b py-2">
                      {GOAL_LABELS[goal]}
                    </li>
                  ))}
                </ul>
                <p className="text-xs leading-5 text-muted-foreground">
                  The planner uses real catalog services when a match exists. Missing catalog
                  matches remain clearly labeled placeholders in the editable design.
                </p>
              </>
            )}
            {kind === 'lan_party' && (
              <>
                <dl className="grid border-t text-sm">
                  <PlanFact label="Tables" value={`${tableCount} × up to ${perTable} seats`} />
                  <PlanFact label="Power" value={`${estimatedWatts} W`} />
                  <PlanFact
                    label="Circuits"
                    value={`${party.circuits} of ${circuitCount} needed`}
                  />
                </dl>
                <p className="text-xs leading-5 text-muted-foreground">
                  After creating the plan, the Game plan report checks every breaker, the address
                  pool and the switch ports.
                </p>
              </>
            )}
            {kind === 'game_server' && (
              <>
                <dl className="grid border-t text-sm">
                  <PlanFact label="Memory needed" value={formatMemory(serverTotals.ram)} />
                  <PlanFact label="Cores needed" value={`${serverTotals.cpu}`} />
                  <PlanFact
                    label="Upload needed"
                    value={`${(serverTotals.upload / 1000).toFixed(1)} Mbps`}
                  />
                </dl>
                <p className="text-xs leading-5 text-muted-foreground">
                  Sizing is an estimate for everyone online at once. The Game plan report lists the
                  ports to forward.
                </p>
              </>
            )}
          </div>
        </aside>
      </div>
    </Page>
  );
}

function PlanFact({ label, value }: { label: string; value: string }) {
  return (
    <div className="flex items-baseline justify-between gap-3 border-b py-2">
      <dt className="text-muted-foreground">{label}</dt>
      <dd className="text-right">{value}</dd>
    </div>
  );
}

function GamePicker({
  catalog,
  isSelected,
  onToggle,
}: {
  catalog: Service[];
  isSelected: (slug: string) => boolean;
  onToggle: (service: Service) => void;
}) {
  if (catalog.length === 0) {
    return (
      <p className="mt-6 text-sm text-muted-foreground">
        The game catalog is not loaded. You can add game servers later from the Services tab in the
        builder.
      </p>
    );
  }
  return (
    <div className="mt-6 flex flex-wrap gap-2" role="group" aria-label="Games">
      {catalog.map(service => (
        <button
          key={service.id}
          type="button"
          aria-pressed={isSelected(service.game!.slug)}
          onClick={() => onToggle(service)}
          className="app-filter"
        >
          {service.name.replace(/ Server$/, '')}
        </button>
      ))}
    </div>
  );
}
