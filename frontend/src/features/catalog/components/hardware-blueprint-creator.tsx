import { useEffect, useMemo, useState, type ElementType } from 'react';
import {
  AppWindow,
  Check,
  CircuitBoard,
  HardDrive,
  Loader2,
  Plus,
  ScanLine,
  Server,
  Tags,
  Trash2,
  X,
  Zap,
} from 'lucide-react';
import { Button } from '../../../components/ui/button';
import { Input } from '../../../components/ui/input';
import type { HardwareComponent, HardwareNode, HardwareSpec, HardwareType } from '../../../types';
import { useBuilderStore } from '../../builder/store/builder-store';
import {
  CREATOR_HARDWARE_TYPES,
  hardwareCategoryLabel,
  nodeTypeToCatalogCategory,
} from '../../../lib/hardware-taxonomy';
import {
  useCreateHardwareBlueprint,
  useSubmitHardwareBlueprint,
} from '../api/use-hardware-blueprints';
import {
  blueprintMetricBars,
  componentSummary,
  estimateBlueprintFit,
  fitTone,
  formatMetric,
} from '../lib/blueprint-fit';

type Props = {
  open: boolean;
  onClose: () => void;
  initialNode?: HardwareNode | null;
};

const DEFAULT_TYPE: HardwareType = 'minipc';
const COMPONENT_TYPES: Array<{ type: HardwareType; label: string; icon: ElementType }> = [
  { type: 'disk', label: 'Disk', icon: HardDrive },
  { type: 'gpu', label: 'GPU', icon: ScanLine },
  { type: 'hba', label: 'HBA', icon: CircuitBoard },
  { type: 'pcie', label: 'PCIe Card', icon: CircuitBoard },
];

function numberOrUndefined(value: string) {
  if (!value.trim()) return undefined;
  const parsed = Number(value);
  return Number.isFinite(parsed) ? parsed : undefined;
}

function splitTags(value: string) {
  return value
    .split(',')
    .map(tag => tag.trim())
    .filter(Boolean)
    .slice(0, 12);
}

function makeComponentId() {
  if (typeof crypto !== 'undefined' && 'randomUUID' in crypto) {
    return crypto.randomUUID();
  }
  return `component-${Date.now()}-${Math.random().toString(16).slice(2)}`;
}

function previewGrade(utilization: { cpu: number; ram: number; storage: number; ports: number }) {
  const peak = Math.max(utilization.cpu, utilization.ram, utilization.storage, utilization.ports);
  if (peak > 1) return 'risky' as const;
  if (peak > 0.78) return 'tight' as const;
  if (peak > 0) return 'good' as const;
  return undefined;
}

export function HardwareBlueprintCreator({ open, onClose, initialNode }: Props) {
  const { availableServices, fetchServices } = useBuilderStore();
  const createBlueprint = useCreateHardwareBlueprint();
  const submitBlueprint = useSubmitHardwareBlueprint();

  const [name, setName] = useState('');
  const [type, setType] = useState<HardwareType>(DEFAULT_TYPE);
  const [description, setDescription] = useState('');
  const [tags, setTags] = useState('useful, beginner friendly');
  const [cpu, setCpu] = useState('');
  const [ram, setRam] = useState('');
  const [storage, setStorage] = useState('');
  const [ports, setPorts] = useState('');
  const [price, setPrice] = useState('');
  const [power, setPower] = useState('');
  const [rackUnits, setRackUnits] = useState('');
  const [internalComponents, setInternalComponents] = useState<HardwareComponent[]>([]);
  const [componentType, setComponentType] = useState<HardwareType>('disk');
  const [componentName, setComponentName] = useState('');
  const [componentModel, setComponentModel] = useState('');
  const [componentStorage, setComponentStorage] = useState('');
  const [componentRam, setComponentRam] = useState('');
  const [componentPorts, setComponentPorts] = useState('');
  const [componentPower, setComponentPower] = useState('');
  const [selectedServiceIds, setSelectedServiceIds] = useState<string[]>([]);
  const [submitToCommunity, setSubmitToCommunity] = useState(false);
  const [error, setError] = useState('');

  useEffect(() => {
    if (!open) return;
    fetchServices();
  }, [open, fetchServices]);

  useEffect(() => {
    if (!open) return;
    const details = initialNode?.details || {};
    setName(initialNode?.name || 'N100 Mini PC');
    setType(initialNode?.type || DEFAULT_TYPE);
    setDescription('');
    setTags('useful, quiet, power efficient');
    setCpu(details.cpu?.toString() || '4');
    setRam(details.ram?.toString() || '16');
    setStorage(details.storage?.toString() || '512');
    setPorts(details.ports?.toString() || (initialNode?.type === 'switch' ? '8' : '2'));
    setPrice(details.price_est?.toString() || '');
    setPower(initialNode?.power_draw?.toString() || '');
    setRackUnits(details.rack_units?.toString() || '');
    setInternalComponents(
      (initialNode?.internal_components || []).map(component => ({
        ...component,
        id: component.id || makeComponentId(),
      })),
    );
    setComponentType('disk');
    setComponentName('');
    setComponentModel('');
    setComponentStorage('');
    setComponentRam('');
    setComponentPorts('');
    setComponentPower('');
    setSelectedServiceIds([]);
    setSubmitToCommunity(false);
    setError('');
  }, [open, initialNode]);

  const selectedServices = useMemo(
    () => availableServices.filter(service => selectedServiceIds.includes(service.id)),
    [availableServices, selectedServiceIds],
  );
  const previewDetails: HardwareSpec = {
    ...(initialNode?.details || {}),
    model: name.trim() || 'Hardware Blueprint',
    cpu: numberOrUndefined(cpu),
    ram: numberOrUndefined(ram),
    storage: numberOrUndefined(storage),
    ports: numberOrUndefined(ports),
    price_est: numberOrUndefined(price),
    rack_units: numberOrUndefined(rackUnits),
  };
  const previewFit = estimateBlueprintFit(
    {
      type,
      name: name.trim() || 'Hardware Blueprint',
      details: previewDetails,
      power_draw: numberOrUndefined(power),
      internal_components: internalComponents,
    },
    selectedServices,
  );
  const previewBars = blueprintMetricBars(previewFit);
  const componentCounts = componentSummary(internalComponents);
  const fitGrade = previewGrade(previewFit.utilization);

  if (!open) return null;

  const toggleService = (serviceId: string) => {
    setSelectedServiceIds(current =>
      current.includes(serviceId)
        ? current.filter(id => id !== serviceId)
        : [...current, serviceId],
    );
  };

  const resetComponentForm = () => {
    setComponentName('');
    setComponentModel('');
    setComponentStorage('');
    setComponentRam('');
    setComponentPorts('');
    setComponentPower('');
  };

  const addInternalComponent = () => {
    const typeMeta = COMPONENT_TYPES.find(item => item.type === componentType);
    const fallbackName = typeMeta ? `New ${typeMeta.label}` : 'New Component';
    const details: HardwareSpec = {
      model: componentModel.trim() || undefined,
      storage: componentType === 'disk' ? numberOrUndefined(componentStorage) : undefined,
      ram: componentType === 'gpu' ? numberOrUndefined(componentRam) : undefined,
      ports: componentType === 'hba' || componentType === 'pcie' ? numberOrUndefined(componentPorts) : undefined,
    };
    setInternalComponents(current => [
      ...current,
      {
        id: makeComponentId(),
        type: componentType,
        name: componentName.trim() || fallbackName,
        power_draw: numberOrUndefined(componentPower),
        details,
      },
    ]);
    resetComponentForm();
  };

  const removeInternalComponent = (componentId: string) => {
    setInternalComponents(current => current.filter(component => component.id !== componentId));
  };

  const handleSave = async () => {
    setError('');
    if (!name.trim()) {
      setError('Name is required.');
      return;
    }

    const details = {
      ...(initialNode?.details || {}),
      model: name.trim(),
      cpu: numberOrUndefined(cpu),
      ram: numberOrUndefined(ram),
      storage: numberOrUndefined(storage),
      ports: numberOrUndefined(ports),
      price_est: numberOrUndefined(price),
      rack_units: numberOrUndefined(rackUnits),
    };

    try {
      const created = await createBlueprint.mutateAsync({
        name: name.trim(),
        description: description.trim(),
        category: nodeTypeToCatalogCategory(type),
        node_type: type,
        tags: splitTags(tags),
        services: selectedServices,
        node_data: {
          type,
          name: name.trim(),
          details,
          power_draw: numberOrUndefined(power),
          internal_components: internalComponents,
          vms: initialNode?.vms || [],
        },
      });
      if (submitToCommunity) {
        await submitBlueprint.mutateAsync(created.data.id);
      }
      onClose();
    } catch (err) {
      setError(err instanceof Error ? err.message : 'Could not save blueprint.');
    }
  };

  const isSaving = createBlueprint.isPending || submitBlueprint.isPending;
  const selectedTags = splitTags(tags);

  return (
    <div className="fixed inset-0 z-[120] flex items-center justify-center p-4">
      <div className="absolute inset-0 bg-black/65" onClick={onClose} role="presentation" />
      <div className="relative z-10 grid w-full max-w-5xl overflow-hidden rounded-xl border bg-card shadow-xl md:grid-cols-[1.15fr_0.85fr]">
        <div className="min-h-0 max-h-[86vh] overflow-y-auto">
          <div className="flex items-start justify-between border-b px-6 py-4">
            <div>
              <h2 className="text-lg font-semibold">Hardware Blueprint</h2>
              <p className="text-xs text-muted-foreground mt-0.5">
                {initialNode ? 'Save reusable hardware from this node' : 'Create reusable hardware'}
              </p>
            </div>
            <button type="button" onClick={onClose} className="rounded-md p-1.5 hover:bg-muted">
              <X className="size-4" />
            </button>
          </div>

          <div className="space-y-5 p-6">
            <div className="grid gap-3 sm:grid-cols-[1fr_180px]">
              <div className="space-y-1.5">
                <label className="text-xs font-medium text-muted-foreground" htmlFor="blueprint-name">
                  Name
                </label>
                <Input id="blueprint-name" value={name} onChange={e => setName(e.target.value)} />
              </div>
              <div className="space-y-1.5">
                <label className="text-xs font-medium text-muted-foreground" htmlFor="blueprint-type">
                  Type
                </label>
                <select
                  id="blueprint-type"
                  className="h-9 w-full rounded-md border bg-background px-3 text-sm"
                  value={type}
                  onChange={e => setType(e.target.value as HardwareType)}
                >
                  {CREATOR_HARDWARE_TYPES.map(item => (
                    <option key={item.type} value={item.type}>
                      {item.label}
                    </option>
                  ))}
                </select>
              </div>
            </div>

            <div className="space-y-1.5">
              <label className="text-xs font-medium text-muted-foreground" htmlFor="blueprint-description">
                Description
              </label>
              <textarea
                id="blueprint-description"
                className="min-h-20 w-full resize-none rounded-md border bg-background px-3 py-2 text-sm"
                value={description}
                onChange={e => setDescription(e.target.value)}
              />
            </div>

            <div className="grid gap-3 sm:grid-cols-3">
              <SpecField label="CPU" value={cpu} onChange={setCpu} suffix="cores" />
              <SpecField label="RAM" value={ram} onChange={setRam} suffix="GB" />
              <SpecField label="Storage" value={storage} onChange={setStorage} suffix="GB" />
              <SpecField label="Ports" value={ports} onChange={setPorts} />
              <SpecField label="Price" value={price} onChange={setPrice} suffix="EUR" />
              <SpecField label="Power" value={power} onChange={setPower} suffix="W" />
              <SpecField label="Rack" value={rackUnits} onChange={setRackUnits} suffix="U" />
            </div>

            <div className="space-y-3 rounded-lg border bg-muted/20 p-3">
              <div className="flex items-center justify-between gap-3">
                <div>
                  <p className="text-xs font-semibold text-foreground">Internal Components</p>
                  <p className="text-[11px] text-muted-foreground">Disk, GPU, HBA, PCIe</p>
                </div>
                <span className="rounded-md bg-background px-2 py-1 text-[10px] text-muted-foreground">
                  {internalComponents.length} parts
                </span>
              </div>

              <div className="grid gap-2 lg:grid-cols-[120px_1fr_1fr_96px_88px]">
                <select
                  className="h-9 rounded-md border bg-background px-2 text-xs"
                  value={componentType}
                  onChange={event => setComponentType(event.target.value as HardwareType)}
                  aria-label="Component type"
                >
                  {COMPONENT_TYPES.map(item => (
                    <option key={item.type} value={item.type}>
                      {item.label}
                    </option>
                  ))}
                </select>
                <Input
                  className="h-9 text-xs"
                  placeholder="Name"
                  value={componentName}
                  onChange={event => setComponentName(event.target.value)}
                />
                <Input
                  className="h-9 text-xs"
                  placeholder="Model"
                  value={componentModel}
                  onChange={event => setComponentModel(event.target.value)}
                />
                {componentType === 'disk' ? (
                  <Input
                    className="h-9 text-xs"
                    type="number"
                    min="0"
                    placeholder="GB"
                    value={componentStorage}
                    onChange={event => setComponentStorage(event.target.value)}
                  />
                ) : componentType === 'gpu' ? (
                  <Input
                    className="h-9 text-xs"
                    type="number"
                    min="0"
                    placeholder="VRAM GB"
                    value={componentRam}
                    onChange={event => setComponentRam(event.target.value)}
                  />
                ) : (
                  <Input
                    className="h-9 text-xs"
                    type="number"
                    min="0"
                    placeholder="Ports"
                    value={componentPorts}
                    onChange={event => setComponentPorts(event.target.value)}
                  />
                )}
                <div className="flex gap-2">
                  <Input
                    className="h-9 min-w-0 text-xs"
                    type="number"
                    min="0"
                    placeholder="W"
                    value={componentPower}
                    onChange={event => setComponentPower(event.target.value)}
                  />
                  <Button type="button" size="icon" className="size-9 shrink-0" onClick={addInternalComponent}>
                    <Plus className="size-4" />
                  </Button>
                </div>
              </div>

              {internalComponents.length > 0 && (
                <div className="grid gap-2 sm:grid-cols-2">
                  {internalComponents.map(component => {
                    const typeMeta = COMPONENT_TYPES.find(item => item.type === component.type);
                    const Icon = typeMeta?.icon || CircuitBoard;
                    return (
                      <div key={component.id} className="flex items-center gap-2 rounded-md border bg-background px-2 py-2">
                        <Icon className="size-3.5 shrink-0 text-muted-foreground" />
                        <div className="min-w-0 flex-1">
                          <p className="truncate text-xs font-medium">{component.name}</p>
                          <p className="truncate text-[10px] text-muted-foreground">
                            {component.details?.model || typeMeta?.label || component.type}
                            {component.details?.storage ? ` - ${component.details.storage}GB` : ''}
                            {component.details?.ram ? ` - ${component.details.ram}GB VRAM` : ''}
                            {component.details?.ports ? ` - ${component.details.ports} ports` : ''}
                          </p>
                        </div>
                        <Button
                          type="button"
                          size="icon"
                          variant="ghost"
                          className="size-7 shrink-0 text-muted-foreground hover:text-destructive"
                          onClick={() => removeInternalComponent(component.id)}
                        >
                          <Trash2 className="size-3.5" />
                        </Button>
                      </div>
                    );
                  })}
                </div>
              )}
            </div>

            <div className="space-y-1.5">
              <label className="text-xs font-medium text-muted-foreground" htmlFor="blueprint-tags">
                Tags
              </label>
              <Input id="blueprint-tags" value={tags} onChange={e => setTags(e.target.value)} />
            </div>

            <div className="space-y-2">
              <div className="flex items-center justify-between">
                <span className="text-xs font-medium text-muted-foreground">Services</span>
                <span className="text-[10px] text-muted-foreground">{selectedServices.length} selected</span>
              </div>
              <div className="grid max-h-44 gap-2 overflow-y-auto rounded-md border bg-muted/20 p-2 sm:grid-cols-2">
                {availableServices.map(service => {
                  const active = selectedServiceIds.includes(service.id);
                  return (
                    <button
                      key={service.id}
                      type="button"
                      className={`flex items-center gap-2 rounded-md border px-2 py-1.5 text-left text-xs transition-colors ${
                        active ? 'border-primary bg-primary/10 text-primary' : 'bg-background hover:bg-muted'
                      }`}
                      onClick={() => toggleService(service.id)}
                    >
                      <AppWindow className="size-3.5 shrink-0" />
                      <span className="min-w-0 flex-1 truncate">{service.name}</span>
                      {active && <Check className="size-3 shrink-0" />}
                    </button>
                  );
                })}
              </div>
            </div>

            <label className="flex items-center justify-between rounded-md border bg-muted/20 px-3 py-2 text-sm">
              <span>Submit to community after saving</span>
              <input
                type="checkbox"
                className="size-4"
                checked={submitToCommunity}
                onChange={e => setSubmitToCommunity(e.target.checked)}
              />
            </label>

            {error && <p className="rounded-md bg-destructive/10 px-3 py-2 text-sm text-destructive">{error}</p>}

            <div className="flex justify-end gap-2 border-t pt-4">
              <Button variant="outline" onClick={onClose} disabled={isSaving}>
                Cancel
              </Button>
              <Button onClick={handleSave} disabled={isSaving}>
                {isSaving ? <Loader2 className="size-4 animate-spin" /> : <Plus className="size-4" />}
                Save Blueprint
              </Button>
            </div>
          </div>
        </div>

        <div className="border-l bg-muted/20 p-6">
          <div className="sticky top-6 space-y-4">
            <div className="rounded-lg border bg-background p-4 shadow-sm">
              <div className="flex items-start gap-3">
                <div className="flex size-11 shrink-0 items-center justify-center rounded-md bg-primary/10 text-primary">
                  <Server className="size-5" />
                </div>
                <div className="min-w-0 flex-1">
                  <p className="truncate text-sm font-semibold">{name || 'Hardware Blueprint'}</p>
                  <p className="text-xs text-muted-foreground">{hardwareCategoryLabel(type)}</p>
                </div>
                <span
                  className={`rounded-full border px-2 py-0.5 text-[10px] font-semibold ${fitTone(fitGrade)}`}
                >
                  {fitGrade === 'risky'
                    ? 'Risky fit'
                    : fitGrade === 'tight'
                      ? 'Tight fit'
                      : fitGrade === 'good'
                        ? 'Good fit'
                        : 'Draft'}
                </span>
              </div>

              <div className="mt-4 space-y-2">
                {previewBars.map(metric => (
                  <CapacityBar key={metric.label} metric={metric} />
                ))}
              </div>

              <div className="mt-4 grid grid-cols-3 gap-2 text-xs">
                <Metric icon={HardDrive} label="Disks" value={String(componentCounts.disks)} />
                <Metric icon={ScanLine} label="GPUs" value={String(componentCounts.gpus)} />
                <Metric icon={Zap} label="Power" value={power ? `${power}W` : '-'} />
              </div>

              <div className="mt-4 flex flex-wrap gap-1.5">
                {selectedTags.map(tag => (
                  <span key={tag} className="rounded-md border bg-muted px-1.5 py-0.5 text-[10px]">
                    {tag}
                  </span>
                ))}
              </div>
            </div>

            <div className="rounded-lg border bg-background p-4">
              <div className="mb-3 flex items-center gap-2 text-xs font-semibold text-muted-foreground">
                <Tags className="size-3.5" />
                Service Load
              </div>
              {selectedServices.length === 0 ? (
                <p className="text-xs text-muted-foreground">No services selected</p>
              ) : (
                <div className="space-y-2">
                  {selectedServices.slice(0, 8).map(service => (
                    <div key={service.id} className="flex items-center justify-between gap-2 text-xs">
                      <span className="truncate">{service.name}</span>
                      <span className="shrink-0 text-muted-foreground">
                        {formatMetric((service.requirements?.recommended_ram_mb || service.requirements?.min_ram_mb || 0) / 1024, 'GB')}
                      </span>
                    </div>
                  ))}
                </div>
              )}
            </div>
          </div>
        </div>
      </div>
    </div>
  );
}

function SpecField({
  label,
  value,
  suffix,
  onChange,
}: {
  label: string;
  value: string;
  suffix?: string;
  onChange: (value: string) => void;
}) {
  return (
    <div className="space-y-1.5">
      <label className="text-xs font-medium text-muted-foreground">{label}</label>
      <div className="flex items-center rounded-md border bg-background">
        <input
          type="number"
          min="0"
          className="h-9 min-w-0 flex-1 bg-transparent px-3 text-sm outline-none"
          value={value}
          onChange={event => onChange(event.target.value)}
        />
        {suffix && <span className="pr-3 text-xs text-muted-foreground">{suffix}</span>}
      </div>
    </div>
  );
}

function CapacityBar({ metric }: { metric: ReturnType<typeof blueprintMetricBars>[number] }) {
  const overloaded = metric.total > 0 && metric.used > metric.total;
  const fill = metric.label === 'Power' ? 100 : metric.percent;
  return (
    <div className="space-y-1">
      <div className="flex items-center justify-between gap-2 text-[10px]">
        <span className="font-medium text-muted-foreground">{metric.label}</span>
        <span className="font-mono text-muted-foreground">
          {metric.label === 'Power'
            ? formatMetric(metric.total, metric.unit)
            : `${formatMetric(metric.used, metric.unit)} / ${formatMetric(metric.total, metric.unit)}`}
        </span>
      </div>
      <div className="h-1.5 overflow-hidden rounded-full bg-muted">
        <div
          className={`h-full rounded-full ${overloaded ? 'bg-red-500' : metric.percent > 80 ? 'bg-amber-500' : 'bg-primary'}`}
          style={{ width: `${Math.max(4, fill)}%` }}
        />
      </div>
    </div>
  );
}

function Metric({
  icon: Icon,
  label,
  value,
}: {
  icon: ElementType;
  label: string;
  value: string;
}) {
  return (
    <div className="rounded-md border bg-muted/30 p-2">
      <Icon className="mb-1 size-3.5 text-primary" />
      <p className="text-[10px] text-muted-foreground">{label}</p>
      <p className="truncate font-mono text-xs">{value}</p>
    </div>
  );
}
