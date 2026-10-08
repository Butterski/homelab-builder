import { Gamepad2 } from 'lucide-react';
import type { GameInstance, VirtualMachine } from '../../../types';
import { formatMemory } from '../../../lib/format';
import { useBuilderStore } from '../../builder/store/builder-store';
import { NumberInput } from './number-input';
import {
  EXPOSURES,
  MAX_INSTANCE_PLAYERS,
  findGameProfile,
  maxPortOffset,
  readGameInstance,
  resolvePorts,
  sizeServer,
} from '../lib/sizing';

const inputClass =
  'h-7 w-full rounded-md border border-input bg-background px-2 text-xs focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-ring';

/**
 * Players, exposure and port offset of a game server. Changing the players
 * resizes the service; memory and cores can still be edited by hand afterwards.
 */
export function GameServerSettings({ nodeId, vm }: { nodeId: string; vm: VirtualMachine }) {
  const services = useBuilderStore(state => state.availableServices);
  const updateVM = useBuilderStore(state => state.updateVM);
  const instance = readGameInstance(vm.details);
  if (!instance) return null;

  const profile = findGameProfile(services, instance.profile);
  if (!profile) {
    return (
      <p className="mt-2 border-t pt-2 text-[10px] text-muted-foreground">
        Game server settings load with the service catalog.
      </p>
    );
  }

  const players = instance.players || profile.default_players;
  const needed = sizeServer(profile, players);
  const offsetLimit = maxPortOffset(profile);
  const ports = resolvePorts(profile, instance.port_offset)
    .filter(port => port.forward)
    .map(port => `${port.port}/${port.proto}`)
    .join(', ');
  const undersized =
    (vm.ram_mb ?? 0) < needed.ram_mb || (vm.cpu_cores ?? 0) < needed.cpu_cores;

  const save = (patch: Partial<GameInstance>, resize = false) => {
    const next: GameInstance = { ...instance, players, ...patch };
    const sizing = sizeServer(profile, next.players);
    updateVM(nodeId, vm.id, {
      details: { ...(vm.details ?? {}), game: next },
      ...(resize ? { cpu_cores: sizing.cpu_cores, ram_mb: sizing.ram_mb } : {}),
    });
  };
  const idFor = (field: string) => `game-${vm.id}-${field}`;

  return (
    <div className="mt-2 space-y-2 border-t pt-2">
      <p className="flex items-center gap-1.5 text-[10px] font-semibold uppercase tracking-wider text-muted-foreground">
        <Gamepad2 className="size-3" /> Game server
      </p>
      {profile.role === 'game' && (
        <div className="grid grid-cols-3 gap-2">
          <div>
            <label htmlFor={idFor('players')} className="text-[10px]">
              Players
            </label>
            <NumberInput
              id={idFor('players')}
              className={inputClass}
              min={1}
              max={MAX_INSTANCE_PLAYERS}
              value={players}
              onCommit={value => save({ players: value }, true)}
            />
          </div>
          <div>
            <label htmlFor={idFor('exposure')} className="text-[10px]">
              Reachable
            </label>
            <select
              id={idFor('exposure')}
              className={inputClass}
              value={instance.exposure}
              title={EXPOSURES.find(option => option.value === instance.exposure)?.hint}
              onChange={event => save({ exposure: event.target.value as GameInstance['exposure'] })}
            >
              {EXPOSURES.map(option => (
                <option key={option.value} value={option.value}>
                  {option.label}
                </option>
              ))}
            </select>
          </div>
          <div>
            <label htmlFor={idFor('offset')} className="text-[10px]">
              Port offset
            </label>
            <NumberInput
              id={idFor('offset')}
              className={inputClass}
              min={0}
              max={offsetLimit}
              value={instance.port_offset}
              title="Raise it when two servers of the same game share a host or a router."
              onCommit={value => save({ port_offset: value })}
            />
          </div>
        </div>
      )}
      <p className="text-[10px] leading-4 text-muted-foreground">
        Needs about {formatMemory(needed.ram_mb)} and {needed.cpu_cores} cores
        {profile.role === 'game' && ` for ${players} players`}.
        {ports && ` Ports: ${ports}.`}
        {profile.single_thread && ' Runs mostly on one core: pick a fast CPU.'}
      </p>
      {undersized && (
        <button
          type="button"
          className="text-[10px] font-medium text-primary hover:underline"
          onClick={() => save({}, true)}
        >
          Set memory and cores to what it needs
        </button>
      )}
    </div>
  );
}
