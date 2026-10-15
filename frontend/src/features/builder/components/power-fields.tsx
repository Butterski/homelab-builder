import type { HardwareNode, HardwareSpec } from '../../../types';
import { useBuilderStore } from '../store/builder-store';
import { NumberInput } from '../../gaming/components/number-input';
import { isPowerSource, powerInputCount, powerOutputCount } from '../lib/power-ports';

const inputClass =
  'h-8 w-full rounded-md border border-input bg-background px-3 text-xs focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-ring';
const labelClass = 'text-xs text-muted-foreground';

type PowerKey = 'psu_count' | 'outlets' | 'capacity_w' | 'capacity_va' | 'amps' | 'breaker_amps' | 'voltage';

/**
 * The power wiring of a device: how many power supplies it has, and for a
 * UPS, PDU or power outlet its sockets, its rating and the load the server
 * calculated on the last save.
 */
export function PowerFields({ node }: { node: HardwareNode }) {
  const updateHardware = useBuilderStore(state => state.updateHardware);

  // Read the latest details at write time: other fields of the panel save on a delay.
  // An unset rating (null) removes the key.
  const patchDetails = (key: PowerKey, value: number | null) => {
    const latest = useBuilderStore.getState().hardwareNodes.find(item => item.id === node.id);
    const details: HardwareSpec = { ...(latest?.details ?? {}) };
    if (value === null) delete details[key];
    else details[key] = value;
    updateHardware(node.id, { details });
  };

  const takesPower = powerInputCount(node.type, {}) > 0;
  const source = isPowerSource(node.type);
  if (!takesPower && !source) return null;

  const details = node.details;
  const load = details?.power_load;
  const id = (field: string) => `power-${node.id}-${field}`;
  // A rating without a default may stay unset: the field is empty, and emptying it unsets it.
  const optional = (key: PowerKey) => Number(details?.[key]) || null;
  const field = (key: PowerKey, label: string, value: number | null, min: number, max: number) => (
    <div className="space-y-1.5">
      <label htmlFor={id(key)} className={labelClass}>
        {label}
      </label>
      <NumberInput
        id={id(key)}
        className={inputClass}
        min={min}
        max={max}
        value={value}
        placeholder={value === null ? 'not set' : undefined}
        onCommit={next => patchDetails(key, next)}
        // A count always has a value; a rating may go back to unset or its default.
        onClear={key === 'psu_count' || key === 'outlets' ? undefined : () => patchDetails(key, null)}
      />
    </div>
  );

  return (
    <div className="space-y-3 border-t pt-3">
      <div className="grid grid-cols-2 gap-2">
        {takesPower &&
          field('psu_count', 'Power supplies', powerInputCount(node.type, details), 0, 4)}
        {source && field('outlets', 'Sockets', powerOutputCount(node.type, details), 1, 48)}
        {node.type === 'ups' && (
          <>
            {field('capacity_w', 'Capacity (W)', optional('capacity_w'), 1, 100000)}
            {field('capacity_va', 'Capacity (VA)', optional('capacity_va'), 1, 100000)}
          </>
        )}
        {node.type === 'pdu' && field('amps', 'Rating (A)', optional('amps'), 1, 400)}
        {node.type === 'power_outlet' && (
          <>
            {field('breaker_amps', 'Breaker (A)', Number(details?.breaker_amps) || 16, 1, 400)}
            {field('voltage', 'Voltage (V)', Number(details?.voltage) || 230, 1, 480)}
          </>
        )}
      </div>
      {source && (
        <p className="text-xs text-muted-foreground">
          {load
            ? `Load ${load.load_w} W of ${load.capacity_w !== null ? `${load.capacity_w} W` : 'capacity not set'} · ${load.sockets_used} of ${load.sockets} sockets`
            : 'Load appears after the next save.'}
        </p>
      )}
    </div>
  );
}
