import { useEffect, useState } from 'react';
import { useBuilderStore } from '../store/builder-store';
import { Card, CardContent, CardHeader, CardTitle } from '../../../components/ui/card';
import { Button } from '../../../components/ui/button';
import { Input } from '../../../components/ui/input';
import { Label } from '../../../components/ui/label';
import {
  X,
  Trash2,
  AlertCircle,
  Wand2,
  AlertTriangle,
  Lock,
  Unlock,
  ChevronDown,
} from 'lucide-react';
import { toast } from 'sonner';
import type { HardwareType } from '../../../types';
import { VMManager } from './vm-manager';
import { InternalComponentManager } from './internal-component-manager';
import { canNodeHostVMs, nodeHasCPU, nodeHasDynamicPorts, nodeHasRAM, nodeHasStorage, isNetworkNode } from '../../../lib/hardware-config';
import { getVmResourceUsage } from '../lib/resource-usage';
import { getNodePortCount, parsePortCount } from '../lib/port-count';
import { DEFAULT_DEVICE_U } from './rack-node';
import { useHardware } from '../../catalog/api/use-hardware';

const IP_REGEX =
  /^(?:(?:25[0-5]|2[0-4][0-9]|[01]?[0-9][0-9]?)\.){3}(?:25[0-5]|2[0-4][0-9]|[01]?[0-9][0-9]?)$/;

export function NodePropertiesPanel() {
  const {
    selectedNodeId,
    hardwareNodes,
    selectNode,
    updateHardware,
    removeHardware,
    autoAssignIP,
  } = useBuilderStore();

  const [name, setName] = useState('');
  const [ip, setIp] = useState('');
  const [mask, setMask] = useState('');
  const [gateway, setGateway] = useState('');
  const [dhcpEnabled, setDhcpEnabled] = useState(false);
  const [dhcpLocked, setDhcpLocked] = useState(false);
  const [model, setModel] = useState('');
  const [cpu, setCpu] = useState('');
  const [ram, setRam] = useState('');
  const [storage, setStorage] = useState('');
  const [ports, setPorts] = useState('');

  const [ramUnit, setRamUnit] = useState<'GB' | 'TB'>('GB');
  const [storageUnit, setStorageUnit] = useState<'GB' | 'TB'>('GB');

  const [errors, setErrors] = useState<{ ip?: string; mask?: string; gateway?: string }>({});
  const [netOpen, setNetOpen] = useState(false);
  const [modelSearchOpen, setModelSearchOpen] = useState(false);

  const selectedNode = hardwareNodes.find(n => n.id === selectedNodeId);

  const { data: hardwareResponse } = useHardware(
    selectedNode ? { category: selectedNode.type, limit: 100 } : {}
  );
  
  const parseHardwareSpecString = (spec: Record<string, any>) => {
    let cpu = undefined;
    if (spec.cpu) {
      const cpuStr = String(spec.cpu).toLowerCase();
      const matchCoreNum = cpuStr.match(/(\d+)\s*-core/);
      if (matchCoreNum) cpu = parseInt(matchCoreNum[1], 10);
      else if (cpuStr.includes('quad-core')) cpu = 4;
      else if (cpuStr.includes('dual-core')) cpu = 2;
      else if (cpuStr.includes('octa-core') || cpuStr.includes('8-core')) cpu = 8;
      const multiMatch = cpuStr.match(/^(\d+)x/);
      if (multiMatch && cpu) {
        cpu *= parseInt(multiMatch[1], 10);
      }
    }
  
    let ramGB = undefined;
    if (spec.ram) {
      const ramStr = String(spec.ram).toUpperCase();
      const gbMatch = ramStr.match(/(\d+(?:\.\d+)?)\s*GB/);
      const mbMatch = ramStr.match(/(\d+)\s*MB/);
      if (gbMatch) ramGB = parseFloat(gbMatch[1]);
      else if (mbMatch) ramGB = parseInt(mbMatch[1], 10) / 1024;
    }
  
    let storageGB = undefined;
    if (spec.storage || spec.capacity) {
      const storageStr = String(spec.storage || spec.capacity).toUpperCase();
      const gbMatch = storageStr.match(/(\d+(?:\.\d+)?)\s*GB/);
      const tbMatch = storageStr.match(/(\d+(?:\.\d+)?)\s*TB/);
      
      let base = 0;
      if (gbMatch) base = parseFloat(gbMatch[1]);
      else if (tbMatch) base = parseFloat(tbMatch[1]) * 1024;
      
      const multiMatch = storageStr.match(/^(\d+)X/);
      if (multiMatch && base) base *= parseInt(multiMatch[1], 10);
      if (base > 0) storageGB = base;
    }
  
    let rackUnits = undefined;
    if (spec.form_factor || spec.units) {
      const ffStr = String(spec.form_factor || spec.units).toLowerCase();
      const ruMatch = ffStr.match(/(\d+)u\s*rack/);
      if (ruMatch) rackUnits = parseInt(ruMatch[1], 10);
      else if (spec.units) rackUnits = parseInt(String(spec.units), 10); 
    }
  
    return { cpu, ram: ramGB, storage: storageGB, rackUnits };
  };

  const validate = () => {
    const newErrors: typeof errors = {};
    if (ip && !IP_REGEX.test(ip)) newErrors.ip = 'Invalid IPv4';
    if (mask && !IP_REGEX.test(mask)) newErrors.mask = 'Invalid mask';
    if (gateway && !IP_REGEX.test(gateway)) newErrors.gateway = 'Invalid gateway';
    setErrors(newErrors);
    return Object.keys(newErrors).length === 0;
  };

  // Sync from store to local state (only if changed to avoid loops)
  useEffect(() => {
    if (selectedNode) {
      if (name !== selectedNode.name) setName(selectedNode.name);
      if (ip !== (selectedNode.ip || '')) setIp(selectedNode.ip || '');
      if (mask !== (selectedNode.subnet_mask || '')) setMask(selectedNode.subnet_mask || '');
      if (gateway !== (selectedNode.gateway || '')) setGateway(selectedNode.gateway || '');
      if (dhcpEnabled !== (selectedNode.details?.dhcp_enabled ?? true))
        setDhcpEnabled(selectedNode.details?.dhcp_enabled ?? true);
      if (dhcpLocked !== (selectedNode.details?.dhcp_locked ?? false))
        setDhcpLocked(selectedNode.details?.dhcp_locked ?? false);

      if (model !== (selectedNode.details?.model || ''))
        setModel(selectedNode.details?.model || '');
      if (cpu !== (selectedNode.details?.cpu?.toString() || ''))
        setCpu(selectedNode.details?.cpu?.toString() || '');

      // Re-hydrate RAM with TB format extraction
      if (selectedNode.details?.ram) {
        const r = Number(selectedNode.details.ram);
        if (r >= 1000 && r % 1000 === 0) {
          setRam(String(r / 1000));
          setRamUnit('TB');
        } else {
          setRam(String(r));
          setRamUnit('GB');
        }
      } else {
        setRam('');
        setRamUnit('GB');
      }

      // Re-hydrate Storage with TB format extraction
      if (selectedNode.details?.storage) {
        const s = Number(selectedNode.details.storage);
        if (s >= 1000 && s % 1000 === 0) {
          setStorage(String(s / 1000));
          setStorageUnit('TB');
        } else {
          setStorage(String(s));
          setStorageUnit('GB');
        }
      } else {
        setStorage('');
        setStorageUnit('GB');
      }

      const portValue = selectedNode.details?.ports;
      const normalizedPorts =
        portValue === undefined
          ? ''
          : String(parsePortCount(portValue) ?? getNodePortCount(selectedNode.type, portValue));
      if (ports !== normalizedPorts) setPorts(normalizedPorts);

      setErrors({});
    }
  }, [selectedNode]); // Rely on store reference changes

  // Auto-save to store (Debounced)
  useEffect(() => {
    if (!selectedNode) return;

    const timer = setTimeout(() => {
      // Validate and Save
      if (validate()) {
        const parseNum = (val: string) => {
          if (!val || val.trim() === '') return undefined;
          const num = Number(val);
          return isNaN(num) ? undefined : num;
        };

        const rVal = parseNum(ram);
        const sVal = parseNum(storage);

        updateHardware(selectedNode.id, {
          name,
          ip,
          subnet_mask: mask,
          gateway,
          details: {
            ...selectedNode.details,
            model,
            dhcp_enabled: selectedNode.type === 'router' ? dhcpEnabled : undefined,
            dhcp_locked: dhcpLocked,
            cpu: parseNum(cpu),
            ram: rVal ? rVal * (ramUnit === 'TB' ? 1000 : 1) : undefined,
            storage: sVal ? sVal * (storageUnit === 'TB' ? 1000 : 1) : undefined,
            ports: parseNum(ports),
          },
        });
      }
    }, 500); // 500ms debounce

    return () => clearTimeout(timer);
  }, [
    name,
    ip,
    mask,
    gateway,
    dhcpEnabled,
    dhcpLocked,
    model,
    cpu,
    ram,
    ramUnit,
    storage,
    storageUnit,
    ports,
  ]);

  if (!selectedNode) return null;

  const handleDelete = () => {
    removeHardware(selectedNode.id);
    selectNode(null);
  };

  const handleAutoIP = () => {
    const assigned = autoAssignIP(selectedNode.id);
    if (assigned) setIp(assigned);
    else toast.error('No router with a configured IP found. Add a Router and set its IP first.');
  };

  const handleIpChange = (val: string) => {
    setIp(val);
    if (val.trim() === '') {
      setDhcpLocked(false);
    } else {
      setDhcpLocked(true);
    }
  };

  const isRouter = selectedNode.type === 'router';
  const isRack = selectedNode.type === 'rack';
  const isInRack = !!selectedNode.parent_id;
  const supportsVMs = canNodeHostVMs(selectedNode.type);
  const isNetworked = isNetworkNode(selectedNode.type);

  // Resource limit calculations
  const { cpu: usedCpu, ramMb: usedRam } = getVmResourceUsage(selectedNode.vms || []);

  const totalCpu = Number(selectedNode.details?.cpu) || 0;
  const totalRamGB = Number(selectedNode.details?.ram) || 0;
  const totalRamMB = totalRamGB < 1000 ? totalRamGB * 1024 : totalRamGB;

  // Sum storage from base details + internal disk/NAS components
  let totalStorageGB = Number(selectedNode.details?.storage) || 0;
  let totalGpuRamMB = 0;
  (selectedNode.internal_components || []).forEach(comp => {
    if (!comp.details) return;
    if (nodeHasStorage(comp.type as HardwareType)) {
      totalStorageGB += Number(comp.details.storage) || 0;
    }
    if (comp.type === 'gpu') {
      const vram = Number(comp.details.ram) || 0;
      totalGpuRamMB += vram < 1000 ? vram * 1024 : vram;
    }
  });

  const cpuWarning = totalCpu > 0 && usedCpu > totalCpu;
  const ramWarning = totalRamMB > 0 && usedRam > totalRamMB;
  const hasWarning = cpuWarning || ramWarning;

  return (
    <Card className="absolute top-8 right-8 w-80 shadow-none z-10 border-l animate-in slide-in-from-right-10 bg-card max-h-[calc(100vh-6rem)] flex flex-col">
      <CardHeader className="flex flex-row items-center justify-between py-3 bg-muted/50 border-b shrink-0">
        <CardTitle className="text-sm font-medium flex items-center gap-2">
          Node Properties
          <span className="text-[10px] bg-primary/10 text-primary px-2 py-0.5 rounded-full uppercase tracking-wider">
            {selectedNode.type}
          </span>
        </CardTitle>
        <div className="flex items-center gap-1">
          <Button
            variant="ghost"
            size="icon"
            onClick={handleDelete}
            className="h-6 w-6 rounded-full hover:bg-destructive/10 hover:text-destructive"
            title="Delete Node"
          >
            <Trash2 className="h-4 w-4" />
          </Button>
          <Button
            variant="ghost"
            size="icon"
            onClick={() => selectNode(null)}
            className="h-6 w-6 rounded-full hover:bg-muted"
            title="Close"
          >
            <X className="h-4 w-4" />
          </Button>
        </div>
      </CardHeader>

      <CardContent className="space-y-4 pt-4 overflow-y-auto flex-1">
        {/* Name */}
        <div className="space-y-2">
          <Label htmlFor="name">Name</Label>
          <Input
            id="name"
            value={name}
            onChange={e => setName(e.target.value)}
            placeholder={isRack ? 'e.g. Main Rack' : 'e.g. Main Router'}
          />
        </div>

        {/* ── Rack-specific properties ── */}
        {isRack && (
          <div className="space-y-3 border-t pt-3">
            <div className="space-y-2">
              <Label htmlFor="rackSize" className="text-xs text-muted-foreground">Rack Size (U)</Label>
              <select
                id="rackSize"
                className="w-full h-8 text-xs rounded-md border border-input bg-background px-3 py-1 cursor-pointer"
                value={selectedNode.details?.rack_size || 24}
                onChange={e => {
                  const newSize = Number(e.target.value);
                  updateHardware(selectedNode.id, {
                    details: { ...selectedNode.details, rack_size: newSize },
                  });
                }}
              >
                <option value={4}>4U — Wall Mount</option>
                <option value={12}>12U — Small Cabinet</option>
                <option value={24}>24U — Standard Homelab</option>
                <option value={42}>42U — Full Height</option>
                <option value={48}>48U — Extended</option>
              </select>
            </div>

            {/* U Occupancy Bar */}
            {(() => {
              const rackSize = selectedNode.details?.rack_size || 24;
              const children = hardwareNodes.filter(n => n.parent_id === selectedNode.id);
              const usedU = children.reduce(
                (sum, n) => sum + (n.details?.rack_units || DEFAULT_DEVICE_U[n.type] || 1), 0
              );
              const pct = Math.min(100, Math.round((usedU / rackSize) * 100));
              const isWarn = pct > 80;
              return (
                <div className="space-y-1.5">
                  <div className="flex justify-between items-center">
                    <span className="text-xs text-muted-foreground">Occupancy</span>
                    <span className={`text-xs font-mono ${isWarn ? 'text-yellow-500' : 'text-muted-foreground'}`}>
                      {usedU}/{rackSize}U ({pct}%)
                    </span>
                  </div>
                  <div className="h-2 rounded-full bg-muted overflow-hidden">
                    <div
                      className={`h-full rounded-full transition-all duration-300 ${isWarn ? 'bg-yellow-500' : 'bg-violet-500'}`}
                      style={{ width: `${pct}%` }}
                    />
                  </div>
                </div>
              );
            })()}

            {/* Child devices list */}
            {(() => {
              const children = hardwareNodes.filter(n => n.parent_id === selectedNode.id);
              if (children.length === 0) return (
                <p className="text-xs text-muted-foreground italic py-2">Drop devices into this rack to mount them.</p>
              );
              return (
                <div className="space-y-1">
                  <span className="text-xs text-muted-foreground">Mounted Devices</span>
                  <div className="space-y-1 max-h-32 overflow-y-auto">
                    {children.map(child => (
                      <div
                        key={child.id}
                        className="flex items-center justify-between px-2 py-1 rounded text-xs bg-muted/50 hover:bg-muted cursor-pointer"
                        onClick={() => selectNode(child.id)}
                      >
                        <span className="truncate">{child.name}</span>
                        <span className="text-muted-foreground font-mono ml-2 shrink-0">
                          {child.details?.rack_units || DEFAULT_DEVICE_U[child.type] || 1}U
                        </span>
                      </div>
                    ))}
                  </div>
                </div>
              );
            })()}
          </div>
        )}

        {/* ── In-rack device fields ── */}
        {isInRack && !isRack && (
          <div className="space-y-3 border rounded-md px-3 py-3 bg-violet-500/5">
            <span className="text-xs font-medium flex items-center gap-1.5">
              <svg className="w-3 h-3 text-violet-400" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2">
                <rect x="2" y="2" width="20" height="20" rx="2" />
                <line x1="2" y1="8" x2="22" y2="8" />
              </svg>
              Rack Mounted
            </span>
            <div className="space-y-1">
              <Label htmlFor="rackUnits" className="text-xs text-muted-foreground">Device Height (U)</Label>
              <Input
                id="rackUnits"
                type="number"
                min={1}
                max={16}
                value={selectedNode.details?.rack_units || DEFAULT_DEVICE_U[selectedNode.type] || 1}
                onChange={e => {
                  const val = Number(e.target.value);
                  if (val >= 1 && val <= 16) {
                    updateHardware(selectedNode.id, {
                      details: { ...selectedNode.details, rack_units: val },
                    });
                  }
                }}
                className="h-8 text-xs"
              />
            </div>
            <div className="space-y-1">
              <Label htmlFor="rackPos" className="text-xs text-muted-foreground">U Position (from top)</Label>
              <Input
                id="rackPos"
                type="number"
                min={0}
                value={selectedNode.details?.rack_position || 0}
                onChange={e => {
                  const val = Number(e.target.value);
                  if (val >= 0) {
                    updateHardware(selectedNode.id, {
                      details: { ...selectedNode.details, rack_position: val },
                    });
                  }
                }}
                className="h-8 text-xs"
              />
            </div>
          </div>
        )}

        {/* Advanced Network Config Collapsible */}
        {isNetworked && (
          <div className="border rounded-md px-3 pt-3 bg-muted/20">
            <button
              type="button"
              className="w-full flex items-center justify-between font-medium text-xs cursor-pointer pb-3"
              onClick={() => setNetOpen(o => !o)}
            >
              <span>Advanced Network Settings</span>
              <ChevronDown
                className={`h-4 w-4 transition-transform duration-200 text-muted-foreground ${netOpen ? 'rotate-180' : ''}`}
              />
            </button>
            <div
              className="grid transition-all duration-300 ease-in-out"
              style={{ gridTemplateRows: netOpen ? '1fr' : '0fr' }}
            >
              <div className="overflow-hidden">
                <div className="pb-3 space-y-4">
                  {/* IP Address */}
                  <div className="space-y-2">
                    <div className="flex justify-between items-center">
                      <Label htmlFor="ip">IP Address</Label>
                      <div className="flex items-center gap-1">
                        {errors.ip && (
                          <span className="text-[10px] text-destructive flex items-center">
                            <AlertCircle className="h-3 w-3 mr-0.5" />
                            {errors.ip}
                          </span>
                        )}
                        {!isRouter && (
                          <Button
                            variant="ghost"
                            size="sm"
                            className="h-5 px-1.5 text-[10px] text-primary"
                            onClick={handleAutoIP}
                          >
                            <Wand2 className="h-3 w-3 mr-0.5" /> Auto
                          </Button>
                        )}
                      </div>
                    </div>
                    <div className="flex gap-2 items-center">
                      <Input
                        id="ip"
                        value={ip}
                        onChange={e => handleIpChange(e.target.value)}
                        placeholder={
                          isRouter ? '192.168.1.1' : dhcpLocked ? 'Static IP' : 'auto from router'
                        }
                        className={
                          errors.ip ? 'border-destructive focus-visible:ring-destructive' : ''
                        }
                      />
                      <Button
                        variant="outline"
                        size="icon"
                        className={`h-9 w-9 shrink-0 transition-colors ${dhcpLocked ? 'bg-primary/10 text-primary border-primary/30 hover:bg-primary/20 hover:text-primary' : 'text-muted-foreground'}`}
                        onClick={() => setDhcpLocked(!dhcpLocked)}
                        title={dhcpLocked ? 'IP is Locked (Static)' : 'IP is Auto-Assigned (DHCP)'}
                      >
                        {dhcpLocked ? <Lock className="h-4 w-4" /> : <Unlock className="h-4 w-4" />}
                      </Button>
                    </div>
                    <p className="text-[10px] text-muted-foreground">
                      {dhcpLocked
                        ? 'This IP is locked and will not be overwritten by Auto Assign.'
                        : 'This IP can be overwritten by Auto Assign if DHCP is enabled.'}
                    </p>
                  </div>

                  {/* Router-specific: Subnet Mask + Gateway */}
                  {isRouter && (
                    <>
                      <div className="space-y-2">
                        <div className="flex justify-between">
                          <Label htmlFor="mask">Subnet Mask</Label>
                          {errors.mask && (
                            <span className="text-[10px] text-destructive">{errors.mask}</span>
                          )}
                        </div>
                        <Input
                          id="mask"
                          value={mask}
                          onChange={e => setMask(e.target.value)}
                          placeholder="255.255.255.0"
                          className={errors.mask ? 'border-destructive' : ''}
                        />
                      </div>
                      <div className="space-y-2">
                        <div className="flex justify-between">
                          <Label htmlFor="gateway">Gateway</Label>
                          {errors.gateway && (
                            <span className="text-[10px] text-destructive">{errors.gateway}</span>
                          )}
                        </div>
                        <Input
                          id="gateway"
                          value={gateway}
                          onChange={e => setGateway(e.target.value)}
                          placeholder="192.168.1.1"
                          className={errors.gateway ? 'border-destructive' : ''}
                        />
                      </div>
                      <div className="flex items-center justify-between space-y-2 mt-4 pt-4 border-t border-border/50">
                        <Label htmlFor="dhcp_enabled" className="flex flex-col space-y-1">
                          <span>DHCP Server Enabled</span>
                          <span className="font-normal text-[10px] text-muted-foreground w-48">
                            Automatically assign IPs for nodes connected to this router.
                          </span>
                        </Label>
                        <input
                          type="checkbox"
                          id="dhcp_enabled"
                          checked={dhcpEnabled}
                          onChange={e => setDhcpEnabled(e.target.checked)}
                          className="h-4 w-4 rounded border-gray-300 text-primary focus:ring-primary"
                        />
                      </div>
                      <p className="text-[10px] text-muted-foreground bg-primary/5 rounded-md px-2 py-1.5 mt-2">
                        💡 Set this router's IP to enable auto-assignment for other nodes.
                      </p>
                    </>
                  )}
                </div>
              </div>
            </div>
          </div>
        )}

        {/* Hardware Specs (Model, CPU, RAM, Storage, Ports) */}
        <div className="space-y-3 pt-2 border-t">
          {nodeHasDynamicPorts(selectedNode.type) && (
            <div className="space-y-1">
              <Label htmlFor="ports" className="text-xs text-muted-foreground">
                Number of Ports
              </Label>
              <Input
                id="ports"
                type="number"
                min={1}
                max={96}
                value={ports}
                onChange={e => setPorts(e.target.value)}
                className="h-8 text-xs"
                placeholder="e.g. 4, 8, 16, 24"
              />
            </div>
          )}
          <div className="space-y-1 relative">
            <Label htmlFor="model" className="text-xs text-muted-foreground">
              Model
            </Label>
            <Input
              id="model"
              value={model}
              onChange={e => {
                setModel(e.target.value);
                setModelSearchOpen(true);
              }}
              onFocus={() => setModelSearchOpen(true)}
              onBlur={() => setTimeout(() => setModelSearchOpen(false), 200)}
              className="h-8 text-xs"
              placeholder="e.g. Raspberry Pi 4"
              autoComplete="off"
            />
            {modelSearchOpen && hardwareResponse?.data && (
              <div className="absolute top-full left-0 right-0 z-50 mt-1 max-h-48 overflow-auto rounded-md border bg-popover text-popover-foreground shadow-md outline-none animate-in fade-in zoom-in-95">
                {hardwareResponse.data.filter(
                  p =>
                    (p.brand + ' ' + p.model).toLowerCase().includes(model.toLowerCase()) &&
                    (p.brand + ' ' + p.model).toLowerCase() !== model.toLowerCase()
                ).length > 0 ? (
                  <ul className="py-1 text-xs">
                    {hardwareResponse.data.filter(
                      p =>
                        (p.brand + ' ' + p.model).toLowerCase().includes(model.toLowerCase()) &&
                        (p.brand + ' ' + p.model).toLowerCase() !== model.toLowerCase()
                    ).map(item => (
                      <li
                        key={item.id}
                        className="relative flex w-full cursor-pointer select-none flex-col rounded-sm py-1.5 px-2 hover:bg-accent hover:text-accent-foreground outline-none"
                        onClick={() => {
                          const fullName = `${item.brand} ${item.model}`;
                          setModel(fullName);
                          
                          const parsed = parseHardwareSpecString(item.spec);
                          
                          if (parsed.cpu !== undefined) setCpu(String(parsed.cpu));
                          if (parsed.ram !== undefined) {
                            if (parsed.ram >= 1000 && parsed.ram % 1000 === 0) {
                              setRam(String(parsed.ram / 1000));
                              setRamUnit('TB');
                            } else {
                              setRam(String(parsed.ram));
                              setRamUnit('GB');
                            }
                          }
                          if (parsed.storage !== undefined) {
                            if (parsed.storage >= 1000 && parsed.storage % 1000 === 0) {
                              setStorage(String(parsed.storage / 1000));
                              setStorageUnit('TB');
                            } else {
                              setStorage(String(parsed.storage));
                              setStorageUnit('GB');
                            }
                          }
                          if (item.spec.ports !== undefined) {
                            const pCount = parsePortCount(item.spec.ports);
                            if (pCount !== undefined) setPorts(String(pCount));
                          }
                          if (parsed.rackUnits !== undefined && selectedNode.parent_id) {
                            updateHardware(selectedNode.id, {
                              details: { ...selectedNode.details, rack_units: parsed.rackUnits },
                            });
                          }
                          setModelSearchOpen(false);
                        }}
                      >
                        <span className="font-semibold">{item.brand} {item.model}</span>
                        {item.price_est > 0 && <span className="opacity-70 text-[9px]">Est. ~{item.price_est}{item.currency}</span>}
                      </li>
                    ))}
                  </ul>
                ) : (
                  model.length > 0 && hardwareResponse.data.length > 0 && (
                     <div className="py-2 px-2 text-xs text-muted-foreground text-center">No catalog matches</div>
                  )
                )}
              </div>
            )}
          </div>

          {nodeHasCPU(selectedNode.type) && (
            <div className="space-y-1">
              <Label htmlFor="cpu" className="text-xs text-muted-foreground">
                CPU Cores
              </Label>
              <Input
                id="cpu"
                type="number"
                min="1"
                step="1"
                value={cpu}
                onChange={e => setCpu(e.target.value)}
                className="h-8 text-xs"
                placeholder="e.g. 4"
              />
            </div>
          )}

          {nodeHasRAM(selectedNode.type) && (
            <div className="space-y-1">
              <Label htmlFor="ram" className="text-xs text-muted-foreground">
                {selectedNode.type === 'gpu' ? 'VRAM' : 'RAM'} capacity
              </Label>
              <div className="flex gap-1">
                <Input
                  id="ram"
                  type="number"
                  min="1"
                  value={ram}
                  onChange={e => setRam(e.target.value)}
                  className="h-8 text-xs flex-1"
                  placeholder="e.g. 16"
                />
                <Button
                  variant="outline"
                  size="sm"
                  className="h-8 px-2 w-10.5 font-mono text-xs cursor-pointer bg-muted/30 shrink-0"
                  onClick={() => setRamUnit(prev => (prev === 'GB' ? 'TB' : 'GB'))}
                >
                  {ramUnit}
                </Button>
              </div>
            </div>
          )}

          {nodeHasStorage(selectedNode.type) && (
            <div className="space-y-1">
              <Label htmlFor="storage" className="text-xs text-muted-foreground">
                Storage capacity
              </Label>
              <div className="flex gap-1">
                <Input
                  id="storage"
                  type="number"
                  min="1"
                  value={storage}
                  onChange={e => setStorage(e.target.value)}
                  className="h-8 text-xs flex-1"
                  placeholder="e.g. 512"
                />
                <Button
                  variant="outline"
                  size="sm"
                  className="h-8 px-2 w-10.5 font-mono text-xs cursor-pointer bg-muted/30 shrink-0"
                  onClick={() => setStorageUnit(prev => (prev === 'GB' ? 'TB' : 'GB'))}
                >
                  {storageUnit}
                </Button>
              </div>
            </div>
          )}
        </div>

        {/* Component Manager (GPUs, Disks, etc) */}
        <InternalComponentManager nodeId={selectedNode.id} />

        {/* VM Manager (servers, PCs, NAS) */}
        {supportsVMs && (
          <div className="border-t pt-4">
            {hasWarning && (
              <div className="mb-4 p-2.5 bg-destructive/10 border border-destructive/20 rounded-md text-xs text-destructive flex items-start gap-2 animate-in fade-in">
                <AlertTriangle className="h-4 w-4 shrink-0 mt-0.5" />
                <div>
                  <p className="font-semibold mb-0.5">Resource Warning</p>
                  <p className="opacity-90 leading-relaxed">
                    This node is over-provisioned.
                    {cpuWarning && ` Used CPU: ${usedCpu}/${totalCpu}.`}
                    {ramWarning &&
                      ` Used RAM: ${Math.round(usedRam / 1024)}GB/${Math.round(totalRamMB / 1024)}GB.`}
                  </p>
                </div>
              </div>
            )}
            <VMManager nodeId={selectedNode.id} />
          </div>
        )}
      </CardContent>
    </Card>
  );
}
