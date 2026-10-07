import { useId, useState, type ReactNode } from 'react';
import { Loader2 } from 'lucide-react';
import { toast } from 'sonner';
import { Button } from '@/components/ui/button';
import { ConfirmDialog } from '@/components/ui/confirm-dialog';
import {
  Dialog,
  DialogContent,
  DialogDescription,
  DialogFooter,
  DialogHeader,
  DialogTitle,
} from '@/components/ui/dialog';
import { Input } from '@/components/ui/input';
import { Label } from '@/components/ui/label';
import { Textarea } from '@/components/ui/textarea';
import {
  useDeleteInventoryItem,
  useSaveInventoryItem,
  type InventoryInput,
  type InventoryItem,
  type InventoryKind,
  type InventoryLocation,
  type InventoryStatus,
} from '../api/inventory';
import { KINDS, LOCATIONS, STATUSES, TYPES, specFieldsOf } from '../lib/inventory';

const SELECT_CLASS =
  'h-9 w-full rounded-md border border-input bg-transparent px-3 text-sm focus-visible:outline-none focus-visible:ring-1 focus-visible:ring-ring disabled:opacity-50';

type Form = {
  kind: InventoryKind;
  type: string;
  name: string;
  manufacturer: string;
  model: string;
  quantity: string;
  status: InventoryStatus;
  location: InventoryLocation;
  cpuModel: string;
  cpuCores: string;
  cpuThreads: string;
  ramGb: string;
  ramType: string;
  storageGb: string;
  storageType: string;
  ports: string;
  portSpeed: string;
  rackUnits: string;
  rackSize: string;
  macs: string;
  powerDraw: string;
  notes: string;
};

const text = (value: number | undefined) => (value ? String(value) : '');

function formOf(source?: Partial<InventoryInput>): Form {
  const specs = source?.specs ?? {};
  const kind = source?.kind ?? 'device';
  return {
    kind,
    type: source?.type ?? TYPES[kind][0].id,
    name: source?.name ?? '',
    manufacturer: source?.manufacturer ?? '',
    model: source?.model ?? '',
    quantity: String(source?.quantity ?? 1),
    status: source?.status ?? 'available',
    location: source?.location ?? 'shelf',
    cpuModel: specs.cpu_model ?? '',
    cpuCores: text(specs.cpu_cores),
    cpuThreads: text(specs.cpu_threads),
    ramGb: text(specs.ram_gb),
    ramType: specs.ram_type ?? '',
    storageGb: text(specs.storage_gb),
    storageType: specs.storage_type ?? '',
    ports: text(specs.ports),
    portSpeed: specs.port_speed ?? '',
    rackUnits: text(specs.rack_units),
    rackSize: text(specs.rack_size),
    macs: (source?.mac_addresses ?? []).join('\n'),
    powerDraw: text(source?.power_draw),
    notes: source?.notes ?? '',
  };
}

const amount = (value: string) => {
  const parsed = Number(value.replace(',', '.'));
  return Number.isFinite(parsed) && parsed > 0 ? parsed : undefined;
};

/** The form as the server takes it. Figures a type does not have are left out. */
function inputOf(form: Form): InventoryInput {
  const fields = new Set(specFieldsOf(form.type));
  const has = (field: Parameters<typeof fields.has>[0]) => fields.has(field);
  return {
    kind: form.kind,
    type: form.type,
    name: form.name.trim(),
    manufacturer: form.manufacturer.trim(),
    model: form.model.trim(),
    quantity: form.kind === 'device' ? 1 : Math.max(1, Math.round(amount(form.quantity) ?? 1)),
    status: form.status,
    location: form.location,
    specs: {
      cpu_model: has('cpu') ? form.cpuModel.trim() || undefined : undefined,
      cpu_cores: has('cpu') ? amount(form.cpuCores) : undefined,
      cpu_threads: has('cpu') ? amount(form.cpuThreads) : undefined,
      ram_gb: has('ram') ? amount(form.ramGb) : undefined,
      ram_type: has('ram') ? form.ramType.trim() || undefined : undefined,
      storage_gb: has('storage') ? amount(form.storageGb) : undefined,
      storage_type: has('storage') ? form.storageType.trim() || undefined : undefined,
      ports: has('ports') ? amount(form.ports) : undefined,
      port_speed: has('ports') ? form.portSpeed.trim() || undefined : undefined,
      rack_units: has('rack_units') ? amount(form.rackUnits) : undefined,
      rack_size: has('rack_size') ? amount(form.rackSize) : undefined,
    },
    mac_addresses: has('macs')
      ? form.macs
          .split(/[\s,;]+/)
          .map(mac => mac.trim())
          .filter(Boolean)
      : [],
    power_draw: amount(form.powerDraw) ?? 0,
    notes: form.notes.trim(),
  };
}

function Field({
  id,
  label,
  hint,
  children,
  className,
}: {
  id: string;
  label: string;
  hint?: string;
  children: ReactNode;
  className?: string;
}) {
  return (
    <div className={className}>
      <Label htmlFor={id} className="text-xs text-muted-foreground">
        {label}
      </Label>
      <div className="mt-1">{children}</div>
      {hint && <p className="mt-1 text-xs text-muted-foreground">{hint}</p>}
    </div>
  );
}

type InventoryItemDialogProps = {
  open: boolean;
  onOpenChange: (open: boolean) => void;
  /** The item to edit; without it a new one is added. */
  item?: InventoryItem | null;
  /** What a new item starts from, for example a device taken from the canvas. */
  initial?: Partial<InventoryInput>;
  onSaved?: (item: InventoryItem) => void;
};

/**
 * Adds a piece of hardware to the inventory, or changes one. Which figures it
 * asks for depends on what the thing is: a mini PC has a processor and memory,
 * a switch has ports, a cable has neither.
 */
export function InventoryItemDialog(props: InventoryItemDialogProps) {
  return (
    <Dialog open={props.open} onOpenChange={props.onOpenChange}>
      <DialogContent className="max-h-[90vh] max-w-2xl overflow-y-auto">
        {/* Mounted while the dialog is open, so every opening starts from what it is opened for. */}
        <ItemForm {...props} />
      </DialogContent>
    </Dialog>
  );
}

function ItemForm({ onOpenChange, item, initial, onSaved }: InventoryItemDialogProps) {
  const id = useId();
  const saveItem = useSaveInventoryItem();
  const deleteItem = useDeleteInventoryItem();
  const [form, setForm] = useState<Form>(() => formOf(item ?? initial));
  const [error, setError] = useState('');
  const [confirmingDelete, setConfirmingDelete] = useState(false);

  const set = <K extends keyof Form>(key: K, value: Form[K]) =>
    setForm(current => ({ ...current, [key]: value }));
  const fields = new Set(specFieldsOf(form.type));
  const isDevice = form.kind === 'device';
  const pending = saveItem.isPending || deleteItem.isPending;

  const setKind = (kind: InventoryKind) =>
    setForm(current => ({
      ...current,
      kind,
      type: TYPES[kind][0].id,
      quantity: kind === 'device' ? '1' : current.quantity,
    }));

  const submit = async (event: React.FormEvent) => {
    event.preventDefault();
    if (!form.name.trim()) {
      setError('Give the item a name, for example "Lenovo M75q #1".');
      return;
    }
    setError('');
    try {
      const saved = await saveItem.mutateAsync({ id: item?.id, input: inputOf(form) });
      toast.success(item ? `Saved ${saved.name}.` : `Added ${saved.name} to your inventory.`);
      onSaved?.(saved);
      onOpenChange(false);
    } catch (cause) {
      setError(
        cause instanceof Error && cause.message ? cause.message : 'The item could not be saved.',
      );
    }
  };

  const remove = async () => {
    if (!item) return;
    try {
      await deleteItem.mutateAsync(item.id);
      toast.success(`Removed ${item.name} from your inventory.`);
      onOpenChange(false);
    } catch (cause) {
      setError(
        cause instanceof Error && cause.message ? cause.message : 'The item could not be removed.',
      );
    }
  };

  const planned = item?.placements.length ?? 0;

  return (
    <>
      <DialogHeader>
        <DialogTitle>{item ? 'Edit item' : 'Add to your inventory'}</DialogTitle>
        <DialogDescription>
          Something you own. It belongs to your account, so every project can plan with it, and it
          is never listed as something to buy.
        </DialogDescription>
      </DialogHeader>

      <form onSubmit={submit} className="grid gap-5" noValidate>
        <fieldset className="grid gap-3 sm:grid-cols-2">
          <legend className="sr-only">What it is</legend>
          <div className="sm:col-span-2">
            <span className="text-xs text-muted-foreground" id={`${id}-kind`}>
              Kind
            </span>
            <div className="mt-1 flex flex-wrap gap-2" role="group" aria-labelledby={`${id}-kind`}>
              {KINDS.map(kind => (
                <button
                  key={kind.id}
                  type="button"
                  className="app-filter"
                  aria-pressed={form.kind === kind.id}
                  onClick={() => setKind(kind.id)}
                >
                  {kind.label}
                </button>
              ))}
            </div>
          </div>
          <Field id={`${id}-type`} label="Type">
            <select
              id={`${id}-type`}
              className={SELECT_CLASS}
              value={form.type}
              onChange={event => set('type', event.target.value)}
            >
              {TYPES[form.kind].map(type => (
                <option key={type.id} value={type.id}>
                  {type.label}
                </option>
              ))}
            </select>
          </Field>
          <Field id={`${id}-name`} label="Name">
            <Input
              id={`${id}-name`}
              value={form.name}
              onChange={event => set('name', event.target.value)}
              placeholder={
                isDevice
                  ? 'e.g. Lenovo M75q #1'
                  : form.kind === 'component'
                    ? 'e.g. 16 GB DDR4 SODIMM'
                    : 'e.g. DAC cable, 1 m'
              }
              maxLength={120}
              autoFocus
            />
          </Field>
          <Field id={`${id}-manufacturer`} label="Manufacturer">
            <Input
              id={`${id}-manufacturer`}
              value={form.manufacturer}
              onChange={event => set('manufacturer', event.target.value)}
              placeholder={isDevice ? 'e.g. Lenovo' : undefined}
              maxLength={120}
            />
          </Field>
          <Field id={`${id}-model`} label="Model">
            <Input
              id={`${id}-model`}
              value={form.model}
              onChange={event => set('model', event.target.value)}
              placeholder={isDevice ? 'e.g. ThinkCentre M75q Gen 2' : undefined}
              maxLength={120}
            />
          </Field>
        </fieldset>

        {fields.size > 0 && (
          <fieldset className="grid gap-3 border-t pt-4 sm:grid-cols-6">
            <legend className="sr-only">Figures</legend>
            {fields.has('cpu') && (
              <>
                <Field id={`${id}-cpu`} label="Processor" className="sm:col-span-4">
                  <Input
                    id={`${id}-cpu`}
                    value={form.cpuModel}
                    onChange={event => set('cpuModel', event.target.value)}
                    placeholder="e.g. Ryzen 5 PRO 4650GE"
                    maxLength={120}
                  />
                </Field>
                <Field id={`${id}-cores`} label="Cores">
                  <Input
                    id={`${id}-cores`}
                    inputMode="numeric"
                    className="font-mono"
                    value={form.cpuCores}
                    onChange={event => set('cpuCores', event.target.value)}
                    placeholder="e.g. 6"
                  />
                </Field>
                <Field id={`${id}-threads`} label="Threads">
                  <Input
                    id={`${id}-threads`}
                    inputMode="numeric"
                    className="font-mono"
                    value={form.cpuThreads}
                    onChange={event => set('cpuThreads', event.target.value)}
                    placeholder="e.g. 12"
                  />
                </Field>
              </>
            )}
            {fields.has('ram') && (
              <>
                <Field
                  id={`${id}-ram`}
                  label={
                    form.type === 'gpu'
                      ? 'Video memory, GB'
                      : form.type === 'ram'
                        ? 'Memory per module, GB'
                        : 'Memory, GB'
                  }
                  className="sm:col-span-2"
                >
                  <Input
                    id={`${id}-ram`}
                    inputMode="decimal"
                    className="font-mono"
                    value={form.ramGb}
                    onChange={event => set('ramGb', event.target.value)}
                    placeholder={form.type === 'ram' ? 'e.g. 16' : 'e.g. 32'}
                  />
                </Field>
                {form.type !== 'gpu' && (
                  <Field
                    id={`${id}-ram-type`}
                    label="Memory type"
                    className="sm:col-span-4"
                    hint={
                      form.type === 'ram'
                        ? 'Written the same on a machine and on memory, it lets the planner say they fit.'
                        : undefined
                    }
                  >
                    <Input
                      id={`${id}-ram-type`}
                      value={form.ramType}
                      onChange={event => set('ramType', event.target.value)}
                      placeholder="e.g. DDR4 SODIMM"
                      maxLength={40}
                    />
                  </Field>
                )}
              </>
            )}
            {fields.has('storage') && (
              <>
                <Field id={`${id}-storage`} label="Storage, GB" className="sm:col-span-2">
                  <Input
                    id={`${id}-storage`}
                    inputMode="decimal"
                    className="font-mono"
                    value={form.storageGb}
                    onChange={event => set('storageGb', event.target.value)}
                    placeholder="e.g. 240"
                  />
                </Field>
                <Field id={`${id}-storage-type`} label="Storage type" className="sm:col-span-4">
                  <Input
                    id={`${id}-storage-type`}
                    value={form.storageType}
                    onChange={event => set('storageType', event.target.value)}
                    placeholder="e.g. NVMe"
                    maxLength={40}
                  />
                </Field>
              </>
            )}
            {fields.has('ports') && (
              <>
                <Field id={`${id}-ports`} label="Ports" className="sm:col-span-2">
                  <Input
                    id={`${id}-ports`}
                    inputMode="numeric"
                    className="font-mono"
                    value={form.ports}
                    onChange={event => set('ports', event.target.value)}
                    placeholder="e.g. 8"
                  />
                </Field>
                <Field id={`${id}-speed`} label="Port speed" className="sm:col-span-4">
                  <Input
                    id={`${id}-speed`}
                    value={form.portSpeed}
                    onChange={event => set('portSpeed', event.target.value)}
                    placeholder="e.g. 1 GbE"
                    maxLength={40}
                  />
                </Field>
              </>
            )}
            {fields.has('rack_units') && (
              <Field id={`${id}-units`} label="Height, U" className="sm:col-span-2">
                <Input
                  id={`${id}-units`}
                  inputMode="numeric"
                  className="font-mono"
                  value={form.rackUnits}
                  onChange={event => set('rackUnits', event.target.value)}
                  placeholder="e.g. 1"
                />
              </Field>
            )}
            {fields.has('rack_size') && (
              <Field id={`${id}-size`} label="Size, U" className="sm:col-span-2">
                <Input
                  id={`${id}-size`}
                  inputMode="numeric"
                  className="font-mono"
                  value={form.rackSize}
                  onChange={event => set('rackSize', event.target.value)}
                  placeholder="e.g. 24"
                />
              </Field>
            )}
            {fields.has('macs') && (
              <Field
                id={`${id}-macs`}
                label="MAC addresses"
                className="sm:col-span-6"
                hint="One per line. An import recognises the machine by them."
              >
                <Textarea
                  id={`${id}-macs`}
                  rows={2}
                  className="font-mono text-xs"
                  value={form.macs}
                  onChange={event => set('macs', event.target.value)}
                  placeholder="AA:BB:CC:DD:EE:FF"
                />
              </Field>
            )}
          </fieldset>
        )}

        <fieldset className="grid gap-3 border-t pt-4 sm:grid-cols-4">
          <legend className="sr-only">Where it is</legend>
          {!isDevice && (
            <Field id={`${id}-quantity`} label="How many">
              <Input
                id={`${id}-quantity`}
                inputMode="numeric"
                className="font-mono"
                value={form.quantity}
                onChange={event => set('quantity', event.target.value)}
              />
            </Field>
          )}
          <Field id={`${id}-status`} label="State">
            <select
              id={`${id}-status`}
              className={SELECT_CLASS}
              value={form.status}
              onChange={event => set('status', event.target.value as InventoryStatus)}
            >
              {STATUSES.map(status => (
                <option key={status.id} value={status.id}>
                  {status.label}
                </option>
              ))}
            </select>
          </Field>
          <Field id={`${id}-location`} label="Kept in">
            <select
              id={`${id}-location`}
              className={SELECT_CLASS}
              value={form.location}
              onChange={event => set('location', event.target.value as InventoryLocation)}
            >
              {LOCATIONS.map(location => (
                <option key={location.id} value={location.id}>
                  {location.label}
                </option>
              ))}
            </select>
          </Field>
          <Field id={`${id}-power`} label="Power draw, W">
            <Input
              id={`${id}-power`}
              inputMode="decimal"
              className="font-mono"
              value={form.powerDraw}
              onChange={event => set('powerDraw', event.target.value)}
              placeholder="e.g. 15"
            />
          </Field>
          {item && item.state === 'in_use' && item.status !== 'in_use' && (
            <p className="text-xs text-muted-foreground sm:col-span-4">
              {item.deployment
                ? `It is listed as in use while it runs as ${item.deployment.ref}.`
                : 'It is listed as in use while a project plans it.'}
            </p>
          )}
          <Field id={`${id}-notes`} label="Notes" className="sm:col-span-4">
            <Textarea
              id={`${id}-notes`}
              rows={2}
              value={form.notes}
              onChange={event => set('notes', event.target.value)}
              maxLength={2000}
            />
          </Field>
        </fieldset>

        {error && (
          <p role="alert" className="text-sm text-destructive">
            {error}
          </p>
        )}

        <DialogFooter className="gap-2 sm:justify-between sm:space-x-0">
          {item ? (
            <Button
              type="button"
              variant="ghost"
              className="text-destructive hover:text-destructive"
              disabled={pending}
              onClick={() => setConfirmingDelete(true)}
            >
              Remove from inventory
            </Button>
          ) : (
            <span />
          )}
          <div className="flex flex-col-reverse gap-2 sm:flex-row">
            <Button
              type="button"
              variant="outline"
              onClick={() => onOpenChange(false)}
              disabled={pending}
            >
              Cancel
            </Button>
            <Button type="submit" disabled={pending}>
              {saveItem.isPending && <Loader2 className="animate-spin" aria-hidden="true" />}
              {item ? 'Save' : 'Add item'}
            </Button>
          </div>
        </DialogFooter>
      </form>

      <ConfirmDialog
        open={confirmingDelete}
        onOpenChange={setConfirmingDelete}
        title={`Remove ${item?.name ?? 'this item'}?`}
        description={
          planned > 0
            ? `It is planned in ${planned} ${planned === 1 ? 'place' : 'places'}. Those devices stay in their projects and keep its name, without the link.`
            : 'It is taken off your list. Nothing in your projects changes.'
        }
        confirmLabel="Remove"
        onConfirm={() => void remove()}
      />
    </>
  );
}
