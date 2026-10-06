import { useEffect, useMemo, useState } from 'react';
import { useNavigate, useSearchParams } from 'react-router-dom';
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
  type LucideIcon,
} from 'lucide-react';
import { toast } from 'sonner';
import { Button } from '../../../components/ui/button';
import { Card } from '../../../components/ui/card';
import type { BuildKind, GameExposure, Service } from '../../../types';
import { buildApi, type CreateBuildParams } from '../api/builds';
import { useBuilderStore } from '../store/builder-store';
import { BUILD_KINDS, buildKindInfo } from '../../gaming/lib/kind';
import { EXPOSURES, formatMemory, sizeServer } from '../../gaming/lib/sizing';
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
  type PlannedNode,
  type PlannerAnswers,
} from '../lib/planner/types';

const GOALS: Array<{ id: Goal; description: string; icon: LucideIcon }> = [
  { id: 'backup', description: 'Protect family files and device backups.', icon: HardDrive },
  { id: 'media', description: 'Run a private movie and music library.', icon: Play },
  { id: 'home', description: 'Keep automations local and dependable.', icon: Home },
  { id: 'network', description: 'DNS filtering, Wi-Fi, and visibility.', icon: Network },
  { id: 'development', description: 'Git, CI, containers, and test services.', icon: Server },
  { id: 'security', description: 'A safer VPN entry point to your lab.', icon: ShieldCheck },
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

export default function GuidedPlannerPage() {
  const navigate = useNavigate();
  const [searchParams] = useSearchParams();
  const { availableServices, fetchServices, loadBuild } = useBuilderStore();
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
    void fetchServices();
  }, [fetchServices]);

  const gameCatalog = useMemo(() => games(availableServices), [availableServices]);

  const preview: CreateBuildParams = useMemo(() => {
    if (kind === 'lan_party') return buildLanPartyPlan(party, availableServices);
    if (kind === 'game_server') return buildGameServerPlan(server, availableServices);
    return buildHomelabPlan(answers, availableServices);
  }, [kind, answers, party, server, availableServices]);

  const previewNodes = preview.nodes as PlannedNode[];
  const serviceCount = previewNodes.reduce((sum, node) => sum + node.vms.length, 0);
  const estimatedWatts = previewNodes.reduce((sum, node) => sum + (node.power_draw || 0), 0);

  const steps = kind ? STEPS[kind] : [];
  const lastStep = steps.length - 1;
  const name = kind === 'lan_party' ? party.name : kind === 'game_server' ? server.name : answers.name;
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
      toast.success(
        kind === 'homelab' ? 'Your guided lab is ready to edit.' : 'Your plan is ready to edit.',
      );
      navigate(`/builder/${result.build.id}`);
    } catch (error) {
      if (createdID) {
        await buildApi.delete(createdID).catch(() => undefined);
      }
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
    <main className="mx-auto w-full max-w-6xl px-4 py-6 sm:px-6 sm:py-10">
      <header className="relative overflow-hidden rounded-3xl border bg-card p-6 sm:p-9">
        <div className="pointer-events-none absolute -right-24 -top-24 size-72 rounded-full bg-primary/15 blur-3xl" />
        <div className="relative max-w-3xl">
          <div className="mb-4 flex items-center gap-2 text-xs font-semibold uppercase tracking-[0.2em] text-primary">
            <Sparkles className="size-4" />
            Guided Planner
          </div>
          <h1 className="text-3xl font-semibold tracking-tight sm:text-5xl">{intro.title}</h1>
          <p className="mt-4 max-w-2xl text-sm leading-7 text-muted-foreground sm:text-base">
            {intro.text}
          </p>
        </div>
      </header>

      <div className="mt-6 grid gap-6 lg:grid-cols-[minmax(0,1fr)_18rem]">
        <Card className="overflow-hidden">
          {kind && (
            <div className="flex items-center gap-2 border-b px-5 py-4 sm:px-7">
              {steps.map((label, index) => (
                <div key={label} className="flex min-w-0 flex-1 items-center gap-2">
                  <span
                    className={`grid size-7 shrink-0 place-items-center rounded-full text-xs font-semibold ${index <= step ? 'bg-primary text-primary-foreground' : 'bg-muted text-muted-foreground'}`}
                  >
                    {index < step ? <Check className="size-3.5" /> : index + 1}
                  </span>
                  <span className="hidden truncate text-xs font-medium sm:block">{label}</span>
                  {index < lastStep && <span className="h-px flex-1 bg-border" />}
                </div>
              ))}
            </div>
          )}

          <section className="p-5 sm:p-7" aria-live="polite">
            {!kind && (
              <fieldset>
                <legend className="text-2xl font-semibold">What are you planning?</legend>
                <p className="mt-2 text-sm text-muted-foreground">
                  Each plan asks different questions and adds its own checks.
                </p>
                <div className="mt-6 grid gap-3 sm:grid-cols-3">
                  {BUILD_KINDS.map(entry => (
                    <ChoiceCard
                      key={entry.kind}
                      selected={picked === entry.kind}
                      onClick={() => setPicked(entry.kind)}
                      title={entry.label}
                      description={entry.description}
                      icon={entry.icon}
                    />
                  ))}
                </div>
              </fieldset>
            )}

            {/* ── Homelab ─────────────────────────────────────────────── */}
            {kind === 'homelab' && step === 0 && (
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
                      title={GOAL_LABELS[goal.id]}
                      description={goal.description}
                      icon={goal.icon}
                    />
                  ))}
                </div>
              </fieldset>
            )}

            {kind === 'homelab' && step === 1 && (
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

            {kind === 'homelab' && step === 2 && (
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

            {/* ── LAN party ───────────────────────────────────────────── */}
            {kind === 'lan_party' && step === 0 && (
              <fieldset>
                <legend className="text-2xl font-semibold">Who is coming?</legend>
                <p className="mt-2 text-sm text-muted-foreground">
                  Seats are grouped into tables, each with its own small switch.
                </p>
                <div className="mt-6 grid gap-5 sm:grid-cols-2">
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
                <div className="mt-5">
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
                <legend className="text-2xl font-semibold">What does the venue offer?</legend>
                <p className="mt-2 text-sm text-muted-foreground">
                  Power is what ends LAN parties early. A gaming PC with a monitor is planned at 350
                  W.
                </p>
                <div className="mt-6 grid gap-5 sm:grid-cols-3">
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
                  className={`mt-4 rounded-xl border px-4 py-3 text-sm ${
                    circuitCount > party.circuits
                      ? 'border-destructive/40 bg-destructive/10 text-destructive'
                      : 'bg-muted/25 text-muted-foreground'
                  }`}
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
                <legend className="text-2xl font-semibold">Anything to host on site?</legend>
                <p className="mt-2 text-sm text-muted-foreground">
                  A local server keeps matches inside the room. Skip this to play on public servers.
                </p>
                <div className="mt-6">
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
                <legend className="text-2xl font-semibold">Which games, for how many?</legend>
                <p className="mt-2 text-sm text-muted-foreground">
                  Memory and upload scale with the number of players online at once.
                </p>
                <GamePicker
                  catalog={gameCatalog}
                  isSelected={slug => server.games.some(game => game.slug === slug)}
                  onToggle={toggleServerGame}
                />
                {server.games.length > 0 && (
                  <div className="mt-6 grid gap-4 sm:grid-cols-2">
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
              <div className="space-y-8">
                <fieldset>
                  <legend className="text-2xl font-semibold">Where does it run?</legend>
                  <div className="mt-5 grid gap-3 sm:grid-cols-2">
                    <ChoiceCard
                      selected={server.location === 'home'}
                      onClick={() => setServer(current => ({ ...current, location: 'home' }))}
                      title="At home"
                      description="A mini PC or server behind your own router."
                      icon={Home}
                    />
                    <ChoiceCard
                      selected={server.location === 'vps'}
                      onClick={() => setServer(current => ({ ...current, location: 'vps' }))}
                      title="Rented VPS"
                      description="A server in a data centre with a public address and its own line."
                      icon={Cloud}
                    />
                  </div>
                </fieldset>
                {server.location === 'home' && (
                  <fieldset>
                    <legend className="text-lg font-semibold">How do friends reach it?</legend>
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
                      <label htmlFor="server-cgnat" className="text-sm font-semibold">
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
                        className="mt-2 h-11 w-full rounded-xl border bg-background px-3 text-base focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-primary"
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
                <label htmlFor="planner-name" className="text-sm font-semibold">
                  Project name
                </label>
                <input
                  id="planner-name"
                  value={name}
                  onChange={event => setName(event.target.value)}
                  className="mt-2 h-12 w-full rounded-xl border bg-background px-4 text-base focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-primary"
                />
                <div className="mt-6 rounded-2xl border bg-muted/25 p-5">
                  <h2 className="text-xl font-semibold">
                    {kind === 'homelab' ? 'Your editable starter lab' : 'Your editable plan'}
                  </h2>
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
                          <span>
                            {node.name}
                            {node.vms.length > 0 && (
                              <span className="text-xs">
                                {' '}
                                · {node.vms.map(vm => vm.name).join(', ')}
                              </span>
                            )}
                          </span>
                          <span className="shrink-0 text-xs uppercase tracking-wider">
                            {node.type === 'lan_table'
                              ? `${node.details.seats} seats`
                              : node.type.replace('_', ' ')}
                          </span>
                        </li>
                      ))}
                  </ul>
                </div>
              </div>
            )}
          </section>

          <footer className="flex flex-col-reverse gap-3 border-t bg-muted/20 px-5 py-4 sm:flex-row sm:items-center sm:justify-between sm:px-7">
            <Button variant="ghost" onClick={goBack}>
              <ArrowLeft className="size-4" />
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
                <ArrowRight className="size-4" />
              </Button>
            ) : step < lastStep ? (
              <Button disabled={!canContinue} onClick={() => setStep(current => current + 1)}>
                Continue
                <ArrowRight className="size-4" />
              </Button>
            ) : (
              <Button disabled={creating || !name.trim()} onClick={createLab}>
                {creating ? (
                  <Loader2 className="size-4 animate-spin" />
                ) : (
                  <Sparkles className="size-4" />
                )}
                {creating
                  ? 'Building topology...'
                  : kind === 'homelab'
                    ? 'Create this lab'
                    : 'Create this plan'}
              </Button>
            )}
          </footer>
        </Card>

        <aside className="h-fit rounded-2xl border bg-card p-5 lg:sticky lg:top-6">
          <p className="text-xs font-semibold uppercase tracking-[0.18em] text-muted-foreground">
            Live plan
          </p>
          <div className="mt-4 space-y-4">
            {!kind && (
              <p className="text-sm leading-6 text-muted-foreground">
                {buildKindInfo(picked).description}
              </p>
            )}
            {kind && (
              <div>
                <p className="text-3xl font-semibold">{previewNodes.length}</p>
                <p className="text-sm text-muted-foreground">planned devices</p>
              </div>
            )}
            {kind === 'homelab' && (
              <>
                <div className="h-px bg-border" />
                <div className="flex flex-wrap gap-2">
                  {answers.goals.map(goal => (
                    <span
                      key={goal}
                      className="rounded-full bg-primary/10 px-2.5 py-1 text-xs font-medium text-primary"
                    >
                      {GOAL_LABELS[goal]}
                    </span>
                  ))}
                </div>
                <p className="text-xs leading-5 text-muted-foreground">
                  The planner uses real catalog services when a match exists. Missing catalog
                  matches remain clearly labeled placeholders in the editable design.
                </p>
              </>
            )}
            {kind === 'lan_party' && (
              <>
                <div className="h-px bg-border" />
                <dl className="space-y-2 text-sm">
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
                <div className="h-px bg-border" />
                <dl className="space-y-2 text-sm">
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
    </main>
  );
}

function PlanFact({ label, value }: { label: string; value: string }) {
  return (
    <div className="flex items-baseline justify-between gap-3">
      <dt className="text-muted-foreground">{label}</dt>
      <dd className="font-medium">{value}</dd>
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
      <p className="mt-6 rounded-xl border bg-muted/25 px-4 py-3 text-sm text-muted-foreground">
        The game catalog is not loaded. You can add game servers later from the Services tab in the
        builder.
      </p>
    );
  }
  return (
    <div className="mt-6 flex flex-wrap gap-2" role="group" aria-label="Games">
      {catalog.map(service => {
        const selected = isSelected(service.game!.slug);
        return (
          <button
            key={service.id}
            type="button"
            aria-pressed={selected}
            onClick={() => onToggle(service)}
            className={`rounded-full border px-3 py-1.5 text-sm transition-colors focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-primary ${
              selected
                ? 'border-primary bg-primary/10 font-medium text-primary'
                : 'border-border hover:border-primary/40'
            }`}
          >
            {service.name.replace(/ Server$/, '')}
          </button>
        );
      })}
    </div>
  );
}
