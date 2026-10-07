import type { HardwareNode, HardwareSpec, PowerCircuit } from '../../../types';
import { useBuilderStore } from '../../builder/store/builder-store';
import { NumberInput } from './number-input';
import {
  CONSOLE_PLATFORMS,
  MAX_SEAT_WATTS,
  MAX_TABLE_SEATS,
  MIN_SEAT_WATTS,
  TABLE_SWITCH_SIZES,
  TABLE_SWITCH_SPEEDS,
  resizeTable,
  tablePowerDraw,
  tableSeatWatts,
  tableSeats,
  tableSwitchPorts,
} from '../lib/table';

const inputClass =
  'h-8 w-full rounded-md border border-input bg-background px-3 text-xs focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-ring';
const labelClass = 'text-xs text-muted-foreground';

/**
 * What a build without circuits has. One array for all of them: a store
 * selector that hands out a new array on every call never settles, and the
 * panel would render until React gives up (pitfall 37).
 */
const NO_CIRCUITS: PowerCircuit[] = [];

/**
 * The fields gaming builds add to a device: seats and switch of a LAN table,
 * the platform of a console, the Wi-Fi clients of an access point, and the
 * power circuit any device is plugged into.
 */
export function GamingNodeFields({ node }: { node: HardwareNode }) {
  const updateHardware = useBuilderStore(state => state.updateHardware);
  const circuits = useBuilderStore(state => state.gamingPlan?.power?.circuits ?? NO_CIRCUITS);

  // Read the latest details at write time: other fields of the panel save on a delay.
  const patchDetails = (patch: Partial<HardwareSpec>, extra: Partial<HardwareNode> = {}) => {
    const latest = useBuilderStore.getState().hardwareNodes.find(item => item.id === node.id);
    updateHardware(node.id, { ...extra, details: { ...(latest?.details ?? {}), ...patch } });
  };
  const resize = (change: Parameters<typeof resizeTable>[1]) => {
    const latest = useBuilderStore.getState().hardwareNodes.find(item => item.id === node.id);
    const next = resizeTable(latest?.details, change);
    // Seats, switch and power draw change together, in one write.
    updateHardware(node.id, { details: next.details, power_draw: next.power_draw });
  };

  const isTable = node.type === 'lan_table';
  const isConsole = node.type === 'console';
  const isAccessPoint = node.type === 'access_point';
  const showCircuit = circuits.length > 0 && node.type !== 'rack';
  if (!isTable && !isConsole && !isAccessPoint && !showCircuit) return null;

  const seats = tableSeats(node.details);
  const id = (field: string) => `gaming-${node.id}-${field}`;

  return (
    <div className="space-y-3 border-t pt-3">
      {isTable && (
        <>
          <div className="grid grid-cols-2 gap-2">
            <div className="space-y-1.5">
              <label htmlFor={id('seats')} className={labelClass}>
                Seats
              </label>
              <NumberInput
                id={id('seats')}
                className={inputClass}
                min={1}
                max={MAX_TABLE_SEATS}
                value={seats}
                onCommit={value => resize({ seats: value })}
              />
            </div>
            <div className="space-y-1.5">
              <label htmlFor={id('watts')} className={labelClass}>
                Power per seat (W)
              </label>
              <NumberInput
                id={id('watts')}
                className={inputClass}
                min={MIN_SEAT_WATTS}
                max={MAX_SEAT_WATTS}
                step={10}
                value={tableSeatWatts(node.details)}
                onCommit={value => resize({ seat_watts: value })}
              />
            </div>
            <div className="space-y-1.5">
              <label htmlFor={id('ports')} className={labelClass}>
                Table switch
              </label>
              <select
                id={id('ports')}
                className={inputClass}
                value={tableSwitchPorts(node.details)}
                onChange={event => resize({ switch_ports: Number(event.target.value) })}
              >
                {TABLE_SWITCH_SIZES.filter(size => size >= seats + 1).map(size => (
                  <option key={size} value={size}>
                    {size} ports
                  </option>
                ))}
              </select>
            </div>
            <div className="space-y-1.5">
              <label htmlFor={id('speed')} className={labelClass}>
                Switch speed
              </label>
              <select
                id={id('speed')}
                className={inputClass}
                value={node.details?.switch_speed || TABLE_SWITCH_SPEEDS[0]}
                onChange={event => patchDetails({ switch_speed: event.target.value })}
              >
                {TABLE_SWITCH_SPEEDS.map(speed => (
                  <option key={speed} value={speed}>
                    {speed}
                  </option>
                ))}
              </select>
            </div>
          </div>
          <p className="text-[11px] leading-4 text-muted-foreground">
            A full table draws {tablePowerDraw(node.details)} W. Its seats get their addresses from
            DHCP, and one switch port is the uplink.
          </p>
        </>
      )}

      {isConsole && (
        <div className="space-y-1.5">
          <label htmlFor={id('platform')} className={labelClass}>
            Platform
          </label>
          <select
            id={id('platform')}
            className={inputClass}
            value={node.details?.platform || 'other'}
            onChange={event => patchDetails({ platform: event.target.value })}
          >
            {CONSOLE_PLATFORMS.map(platform => (
              <option key={platform.value} value={platform.value}>
                {platform.label}
              </option>
            ))}
          </select>
        </div>
      )}

      {isAccessPoint && (
        <div className="space-y-1.5">
          <label htmlFor={id('wifi')} className={labelClass}>
            Wi-Fi devices expected
          </label>
          <NumberInput
            id={id('wifi')}
            className={inputClass}
            min={0}
            max={500}
            value={Number(node.details?.wifi_clients) || 0}
            onCommit={value => patchDetails({ wifi_clients: value })}
          />
          <p className="text-[11px] leading-4 text-muted-foreground">
            Phones and laptops that are not drawn on the canvas. Each needs an address.
          </p>
        </div>
      )}

      {showCircuit && (
        <div className="space-y-1.5">
          <label htmlFor={id('circuit')} className={labelClass}>
            Power circuit
          </label>
          <select
            id={id('circuit')}
            className={inputClass}
            value={node.details?.circuit || ''}
            onChange={event => {
              const latest = useBuilderStore
                .getState()
                .hardwareNodes.find(item => item.id === node.id);
              const details = { ...(latest?.details ?? {}) };
              if (event.target.value) details.circuit = event.target.value;
              else delete details.circuit;
              updateHardware(node.id, { details });
            }}
          >
            <option value="">Not assigned</option>
            {circuits.map(circuit => (
              <option key={circuit.id} value={circuit.id}>
                {circuit.label || circuit.id} ({circuit.breaker_amps} A)
              </option>
            ))}
          </select>
        </div>
      )}
    </div>
  );
}
