import { useMemo, useState, type KeyboardEvent } from 'react';
import { Plus, Trash2 } from 'lucide-react';
import type { HardwareNode, HardwareSpec, PortRole, PortSettings, VlanDef } from '../../../types';
import { Button } from '../../../components/ui/button';
import { Input } from '../../../components/ui/input';
import { TickBox } from '../../../components/ui/tick-box';
import { useBuilderStore } from '../store/builder-store';
import { getNodePortCount } from '../lib/port-count';
import { isPowerHandle } from '../lib/power-ports';
import {
  defaultRole,
  isIpv4Cidr,
  isIpv4Subnet,
  readPortConfig,
  readVlans,
  withPortCount,
} from '../lib/port-config';

const ROLES: PortRole[] = ['wan', 'lan', 'dmz', 'vpn', 'unused'];
const MAX_VLANS = 64;
const DEFAULT_VLAN_COLOR = '#3b82f6';

const selectClass =
  'h-8 w-full rounded-md border border-input bg-background px-2 text-xs focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-ring';
const labelClass = 'text-[11px] text-muted-foreground';
const hintClass = 'text-[10px] text-destructive';

type PortConfig = Record<string, PortSettings>;

/** The settings without empty values; null when nothing is left. */
function cleanSettings(settings: PortSettings): PortSettings | null {
  const clean: PortSettings = {};
  if (settings.role) clean.role = settings.role;
  if (settings.address) clean.address = settings.address;
  if (settings.dhcp) clean.dhcp = true;
  if (settings.untagged_vlan !== undefined) clean.untagged_vlan = settings.untagged_vlan;
  if (settings.tagged_vlans?.length) clean.tagged_vlans = [...settings.tagged_vlans].sort((a, b) => a - b);
  if (settings.comment) clean.comment = settings.comment;
  return Object.keys(clean).length > 0 ? clean : null;
}

/** The details with config as their port settings; empty entries and an empty config are removed. */
function withConfig(details: HardwareSpec, config: PortConfig): HardwareSpec {
  const next: HardwareSpec = { ...details };
  const kept: PortConfig = {};
  for (const [handle, settings] of Object.entries(config)) {
    const clean = cleanSettings(settings);
    if (clean) kept[handle] = clean;
  }
  if (Object.keys(kept).length > 0) next.port_config = kept;
  else delete next.port_config;
  return next;
}

const parseVlanId = (text: string): number | null => {
  const id = Number(text.trim());
  return text.trim() !== '' && Number.isInteger(id) && id >= 1 && id <= 4094 ? id : null;
};

/** The id a new VLAN gets: the first free one of 10, 20, … 4090, else the first free one. */
function nextVlanId(vlans: VlanDef[]): number | null {
  const used = new Set(vlans.map(vlan => vlan.id));
  for (let id = 10; id <= 4090; id += 10) if (!used.has(id)) return id;
  for (let id = 1; id <= 4094; id++) if (!used.has(id)) return id;
  return null;
}

/**
 * A text field that keeps what is typed and commits it when it loses focus
 * or on Enter. commit answers an error to show, or null when it took the text.
 */
function DraftInput({
  value,
  commit,
  label,
  placeholder,
  maxLength,
  inputMode,
}: {
  value: string;
  commit: (text: string) => string | null;
  label: string;
  placeholder?: string;
  maxLength?: number;
  inputMode?: 'numeric';
}) {
  const [draft, setDraft] = useState(value);
  const [error, setError] = useState<string | null>(null);

  // Follow changes made elsewhere: undo, a proposal, a save.
  const [shown, setShown] = useState(value);
  if (shown !== value) {
    setShown(value);
    setDraft(value);
    setError(null);
  }

  const submit = () => {
    if (draft === value) {
      setError(null);
      return;
    }
    setError(commit(draft));
  };

  return (
    <div className="space-y-0.5">
      <Input
        aria-label={label}
        className="h-7 text-xs"
        value={draft}
        placeholder={placeholder}
        maxLength={maxLength}
        inputMode={inputMode}
        onChange={event => setDraft(event.target.value)}
        onBlur={submit}
        onKeyDown={(event: KeyboardEvent<HTMLInputElement>) => {
          if (event.key === 'Enter') submit();
        }}
      />
      {error && <p className={hintClass}>{error}</p>}
    </div>
  );
}

/**
 * The settings of each port of a router, firewall or switch: role, address,
 * DHCP and VLAN of a gateway port, the VLANs of a switch and its ports.
 */
export function PortSettingsEditor({ node }: { node: HardwareNode }) {
  const updateHardware = useBuilderStore(state => state.updateHardware);
  const edges = useBuilderStore(state => state.edges);

  // The ports of this device that carry a network cable.
  const cabled = useMemo(() => {
    const handles = new Set<string>();
    for (const edge of edges) {
      if (isPowerHandle(edge.sourceHandle) || isPowerHandle(edge.targetHandle)) continue;
      if (edge.source === node.id) handles.add(edge.sourceHandle || 'eth0');
      if (edge.target === node.id) handles.add(edge.targetHandle || 'target-0');
    }
    return handles;
  }, [edges, node.id]);

  const isGateway = node.type === 'router' || node.type === 'firewall';
  const isSwitch = node.type === 'switch';
  if (!isGateway && !isSwitch) return null;

  // Read the latest details at write time: other fields of the panel save on a delay.
  const latest = () =>
    useBuilderStore.getState().hardwareNodes.find(item => item.id === node.id) ?? node;
  const writeConfig = (change: (config: PortConfig, details: HardwareSpec) => void) => {
    const details: HardwareSpec = { ...(latest().details ?? {}) };
    const config = readPortConfig(details);
    change(config, details);
    updateHardware(node.id, { details: withConfig(details, config) });
  };
  const patchPort = (handle: string, patch: Partial<PortSettings>) =>
    writeConfig(config => {
      const entry: PortSettings = { ...config[handle], ...patch };
      for (const key of Object.keys(patch) as (keyof PortSettings)[]) {
        if (patch[key] === undefined) delete entry[key];
      }
      // DHCP runs only on a LAN or DMZ port that has an address.
      const role = entry.role ?? defaultRole(handle);
      if (!entry.address || (role !== 'lan' && role !== 'dmz')) delete entry.dhcp;
      config[handle] = entry;
    });
  const setPortCount = (requested: number) => {
    const current = latest();
    const next = withPortCount(current, useBuilderStore.getState().edges, requested);
    updateHardware(node.id, { details: next.details });
  };

  const count = getNodePortCount(node.type, node.details?.ports);
  const config = readPortConfig(node.details);
  const vlans = readVlans(node.details);
  const handles = ['target-0', ...Array.from({ length: count }, (_, i) => `eth${i}`)];
  const lastHandle = `eth${count - 1}`;
  const fieldId = `port-${node.id}`;

  const writeVlans = (change: (list: VlanDef[], config: PortConfig) => void) =>
    writeConfig((portConfig, details) => {
      const list = readVlans(details);
      change(list, portConfig);
      if (list.length > 0) details.vlans = list;
      else delete details.vlans;
    });
  const addVlan = () => {
    const vlanId = nextVlanId(readVlans(latest().details));
    if (vlanId === null) return;
    writeVlans(list => {
      list.push({ id: vlanId, name: `VLAN ${vlanId}`, color: DEFAULT_VLAN_COLOR });
    });
  };
  // A port may only carry VLANs the switch defines: a deleted VLAN leaves its ports too.
  const deleteVlan = (vlanId: number) =>
    writeVlans((list, portConfig) => {
      const index = list.findIndex(vlan => vlan.id === vlanId);
      if (index >= 0) list.splice(index, 1);
      for (const settings of Object.values(portConfig)) {
        if (settings.untagged_vlan === vlanId) delete settings.untagged_vlan;
        if (settings.tagged_vlans) settings.tagged_vlans = settings.tagged_vlans.filter(v => v !== vlanId);
      }
    });
  const renumberVlan = (from: number, to: number) =>
    writeVlans((list, portConfig) => {
      const vlan = list.find(item => item.id === from);
      if (vlan) vlan.id = to;
      for (const settings of Object.values(portConfig)) {
        if (settings.untagged_vlan === from) settings.untagged_vlan = to;
        if (settings.tagged_vlans)
          settings.tagged_vlans = settings.tagged_vlans.map(v => (v === from ? to : v));
      }
    });
  const patchVlan = (vlanId: number, patch: Partial<VlanDef>) =>
    writeVlans(list => {
      const vlan = list.find(item => item.id === vlanId);
      if (!vlan) return;
      Object.assign(vlan, patch);
      if (!vlan.subnet) delete vlan.subnet;
    });

  const summary = (handle: string) => {
    const settings = config[handle] ?? {};
    const label = handle === 'target-0' ? 'Uplink (top)' : handle;
    if (isGateway) {
      const role = (settings.role ?? defaultRole(handle)).toUpperCase();
      return `${label} · ${role} · ${settings.address || 'no address'}`;
    }
    const parts = [label];
    if (settings.untagged_vlan !== undefined) parts.push(`VLAN ${settings.untagged_vlan}`);
    if (settings.tagged_vlans?.length) parts.push(`tagged ${settings.tagged_vlans.join(', ')}`);
    if (parts.length === 1) parts.push('no VLAN');
    return parts.join(' · ');
  };

  return (
    <div className="space-y-3 border-t pt-3">
      {isSwitch && (
        <div className="space-y-2">
          <div className="text-xs font-medium">VLANs</div>
          {vlans.length === 0 && (
            <p className="text-[11px] text-muted-foreground">No VLANs defined.</p>
          )}
          {vlans.map(vlan => (
            <div key={vlan.id} className="grid grid-cols-[4rem_1fr_2rem_1.75rem] items-start gap-1.5">
              <DraftInput
                label={`Id of VLAN ${vlan.id}`}
                value={String(vlan.id)}
                inputMode="numeric"
                commit={text => {
                  const next = parseVlanId(text);
                  if (next === null) return 'Enter an id from 1 to 4094';
                  if (next !== vlan.id && vlans.some(item => item.id === next))
                    return `VLAN ${next} exists`;
                  renumberVlan(vlan.id, next);
                  return null;
                }}
              />
              <DraftInput
                label={`Name of VLAN ${vlan.id}`}
                value={vlan.name}
                maxLength={32}
                commit={text => {
                  if (!text.trim()) return 'Enter a name';
                  patchVlan(vlan.id, { name: text.trim() });
                  return null;
                }}
              />
              <input
                type="color"
                aria-label={`Colour of VLAN ${vlan.id}`}
                className="h-7 w-8 cursor-pointer rounded-md border border-input bg-background p-0.5"
                value={vlan.color || DEFAULT_VLAN_COLOR}
                onChange={event => patchVlan(vlan.id, { color: event.target.value })}
              />
              <Button
                type="button"
                variant="ghost"
                size="icon"
                className="h-7 w-7"
                aria-label={`Delete VLAN ${vlan.id}`}
                onClick={() => deleteVlan(vlan.id)}
              >
                <Trash2 className="h-3.5 w-3.5" />
              </Button>
              <div className="col-span-4">
                <DraftInput
                  label={`Subnet of VLAN ${vlan.id}`}
                  value={vlan.subnet ?? ''}
                  placeholder="Subnet, e.g. 192.168.10.0/24"
                  commit={text => {
                    const subnet = text.trim();
                    if (subnet && !isIpv4Subnet(subnet)) return 'Enter a subnet like 192.168.10.0/24';
                    patchVlan(vlan.id, { subnet: subnet || undefined });
                    return null;
                  }}
                />
              </div>
            </div>
          ))}
          <Button
            type="button"
            variant="outline"
            size="sm"
            className="h-7 text-xs"
            disabled={vlans.length >= MAX_VLANS}
            onClick={addVlan}
          >
            <Plus className="mr-1 h-3.5 w-3.5" />
            Add VLAN
          </Button>
        </div>
      )}

      <div className="space-y-1">
        <div className="text-xs font-medium">Ports</div>
        {handles.map(handle => {
          const settings = config[handle] ?? {};
          const role = settings.role ?? defaultRole(handle);
          const pool = node.details?.port_networks?.[handle]?.dhcp_pool;
          return (
            <details key={handle} className="rounded-md border px-2 py-1">
              <summary className="flex cursor-pointer items-center gap-1.5 text-xs">
                <span className="truncate font-mono">{summary(handle)}</span>
                {cabled.has(handle) && (
                  <span
                    className="ml-auto size-1.5 shrink-0 rounded-full bg-foreground"
                    title="Carries a cable"
                  />
                )}
              </summary>
              <div className="space-y-2 py-2">
                {isGateway && (
                  <>
                    <div className="grid grid-cols-2 gap-2">
                      <div className="space-y-1">
                        <label htmlFor={`${fieldId}-${handle}-role`} className={labelClass}>
                          Role
                        </label>
                        <select
                          id={`${fieldId}-${handle}-role`}
                          aria-label={`Role of ${handle}`}
                          className={selectClass}
                          value={role}
                          onChange={event =>
                            patchPort(handle, { role: event.target.value as PortRole })
                          }
                        >
                          {ROLES.map(item => (
                            <option key={item} value={item}>
                              {item.toUpperCase()}
                            </option>
                          ))}
                        </select>
                      </div>
                      <div className="space-y-1">
                        <span className={labelClass}>VLAN</span>
                        <DraftInput
                          label={`VLAN of ${handle}`}
                          value={settings.untagged_vlan === undefined ? '' : String(settings.untagged_vlan)}
                          placeholder="none"
                          inputMode="numeric"
                          commit={text => {
                            if (!text.trim()) {
                              patchPort(handle, { untagged_vlan: undefined });
                              return null;
                            }
                            const vlanId = parseVlanId(text);
                            if (vlanId === null) return 'Enter a VLAN id from 1 to 4094';
                            patchPort(handle, { untagged_vlan: vlanId });
                            return null;
                          }}
                        />
                      </div>
                    </div>
                    <div className="space-y-1">
                      <span className={labelClass}>Address</span>
                      <DraftInput
                        label={`Address of ${handle}`}
                        value={settings.address ?? ''}
                        placeholder="192.168.10.1/24"
                        commit={text => {
                          const address = text.trim();
                          if (address && !isIpv4Cidr(address))
                            return 'Enter an address like 192.168.10.1/24';
                          patchPort(handle, { address: address || undefined });
                          return null;
                        }}
                      />
                    </div>
                    <label className="flex items-center gap-2 text-xs">
                      <TickBox
                        aria-label={`DHCP on ${handle}`}
                        checked={!!settings.dhcp}
                        disabled={!settings.address || (role !== 'lan' && role !== 'dmz')}
                        onChange={event =>
                          patchPort(handle, { dhcp: event.target.checked || undefined })
                        }
                      />
                      Hand out addresses (DHCP)
                    </label>
                    {pool && (
                      <p className="text-[11px] text-muted-foreground">
                        DHCP {pool.start}–{pool.end}
                      </p>
                    )}
                  </>
                )}

                {isSwitch && (
                  <>
                    <div className="space-y-1">
                      <label htmlFor={`${fieldId}-${handle}-untagged`} className={labelClass}>
                        Untagged
                      </label>
                      <select
                        id={`${fieldId}-${handle}-untagged`}
                        aria-label={`Untagged VLAN of ${handle}`}
                        className={selectClass}
                        value={settings.untagged_vlan ?? ''}
                        onChange={event => {
                          const vlanId = event.target.value ? Number(event.target.value) : undefined;
                          patchPort(handle, {
                            untagged_vlan: vlanId,
                            tagged_vlans: settings.tagged_vlans?.filter(v => v !== vlanId),
                          });
                        }}
                      >
                        <option value="">None</option>
                        {vlans.map(vlan => (
                          <option key={vlan.id} value={vlan.id}>
                            {vlan.id} · {vlan.name}
                          </option>
                        ))}
                      </select>
                    </div>
                    {vlans.some(vlan => vlan.id !== settings.untagged_vlan) && (
                      <div className="space-y-1">
                        <span className={labelClass}>Tagged</span>
                        <div className="flex flex-wrap gap-x-3 gap-y-1">
                          {vlans
                            .filter(vlan => vlan.id !== settings.untagged_vlan)
                            .map(vlan => (
                              <label key={vlan.id} className="flex items-center gap-1.5 text-xs">
                                <TickBox
                                  aria-label={`${handle} tagged VLAN ${vlan.id}`}
                                  checked={settings.tagged_vlans?.includes(vlan.id) ?? false}
                                  onChange={event => {
                                    const others = (settings.tagged_vlans ?? []).filter(
                                      v => v !== vlan.id,
                                    );
                                    patchPort(handle, {
                                      tagged_vlans: event.target.checked
                                        ? [...others, vlan.id]
                                        : others,
                                    });
                                  }}
                                />
                                {vlan.id}
                              </label>
                            ))}
                        </div>
                      </div>
                    )}
                  </>
                )}

                <div className="space-y-1">
                  <span className={labelClass}>Comment</span>
                  <DraftInput
                    label={`Comment of ${handle}`}
                    value={settings.comment ?? ''}
                    maxLength={80}
                    commit={text => {
                      patchPort(handle, { comment: text.trim() || undefined });
                      return null;
                    }}
                  />
                </div>

                {handle === lastHandle && count > 1 && !cabled.has(handle) && (
                  <Button
                    type="button"
                    variant="ghost"
                    size="sm"
                    className="h-7 text-xs text-muted-foreground"
                    onClick={() => setPortCount(count - 1)}
                  >
                    <Trash2 className="mr-1 h-3.5 w-3.5" />
                    Remove port
                  </Button>
                )}
              </div>
            </details>
          );
        })}
        <Button
          type="button"
          variant="outline"
          size="sm"
          className="h-7 text-xs"
          onClick={() => setPortCount(count + 1)}
        >
          <Plus className="mr-1 h-3.5 w-3.5" />
          Add port
        </Button>
      </div>
    </div>
  );
}
