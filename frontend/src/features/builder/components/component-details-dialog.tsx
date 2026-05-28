import { useReducer } from 'react';
import {
  Dialog,
  DialogContent,
  DialogHeader,
  DialogTitle,
  DialogFooter,
} from '../../../components/ui/dialog';
import { Button } from '../../../components/ui/button';
import { Input } from '../../../components/ui/input';
import { Label } from '../../../components/ui/label';
import type { HardwareType, HardwareSpec } from '../../../types';
import { nodeHasCPU, nodeHasRAM, nodeHasStorage } from '../../../lib/hardware-config';

interface Props {
  open: boolean;
  onOpenChange: (open: boolean) => void;
  onConfirm: (data: { name: string; details: HardwareSpec }) => void;
  initialType: HardwareType;
  initialName?: string;
  initialDetails?: HardwareSpec;
  title?: string; // Added optional title prop as it's used in VisualBuilder
}

// ─── Form state reducer ──────────────────────────────────────────────────────
type FormField = { value: string; unit?: string };
type FormState = {
  name: string;
  model: string;
  cpuCores: string;
  ram: FormField;
  storage: FormField;
};
type FormAction =
  | { type: 'SET_NAME'; payload: string }
  | { type: 'SET_MODEL'; payload: string }
  | { type: 'SET_CPU_CORES'; payload: string }
  | { type: 'SET_RAM_VALUE'; payload: string }
  | { type: 'SET_RAM_UNIT'; payload: string }
  | { type: 'SET_STORAGE_VALUE'; payload: string }
  | { type: 'SET_STORAGE_UNIT'; payload: string };

function formReducer(state: FormState, action: FormAction): FormState {
  switch (action.type) {
    case 'SET_NAME': return { ...state, name: action.payload };
    case 'SET_MODEL': return { ...state, model: action.payload };
    case 'SET_CPU_CORES': return { ...state, cpuCores: action.payload };
    case 'SET_RAM_VALUE': return { ...state, ram: { ...state.ram, value: action.payload } };
    case 'SET_RAM_UNIT': return { ...state, ram: { ...state.ram, unit: action.payload } };
    case 'SET_STORAGE_VALUE': return { ...state, storage: { ...state.storage, value: action.payload } };
    case 'SET_STORAGE_UNIT': return { ...state, storage: { ...state.storage, unit: action.payload } };
    default: return state;
  }
}

export function ComponentDetailsDialog({
  open,
  onOpenChange,
  onConfirm,
  initialType,
  initialName,
  initialDetails,
  title,
}: Props) {
  const formatStorageForDisplay = (val?: number | string): [string, string] => {
    if (val === undefined || val === null || val === '') return ['', 'GB'];
    if (typeof val === 'number') {
      if (val >= 1000 && val % 1000 === 0) return [String(val / 1000), 'TB'];
      return [String(val), 'GB'];
    }
    const match = val.match(/^(\d+(?:\.\d+)?)\s*(MB|GB|TB)?$/i);
    if (match) {
      const n = parseFloat(match[1]);
      const unit = (match[2] || 'GB').toUpperCase();
      return [String(n), unit];
    }
    return ['', 'GB'];
  };

  const formatRamForDisplay = (val?: number | string): [string, string] => {
    if (val === undefined || val === null || val === '') return ['', 'GB'];
    if (typeof val === 'number') return [String(val), 'GB'];
    const match = val.match(/^(\d+(?:\.\d+)?)\s*(MB|GB|TB)?$/i);
    if (match) {
      const n = parseFloat(match[1]);
      const unit = (match[2] || 'GB').toUpperCase();
      return [String(n), unit];
    }
    return ['', 'GB'];
  };

  const [form, dispatch] = useReducer(formReducer, {
    name: initialName || '',
    model: initialDetails?.model || '',
    cpuCores: initialDetails?.cpu?.toString() || initialDetails?.cpu_cores?.toString() || '',
    ram: { value: formatRamForDisplay(initialDetails?.ram)[0], unit: formatRamForDisplay(initialDetails?.ram)[1] || 'GB' },
    storage: { value: formatStorageForDisplay(initialDetails?.storage)[0], unit: formatStorageForDisplay(initialDetails?.storage)[1] || 'GB' },
  });

  const handleConfirm = () => {
    const spec: HardwareSpec = {};
    const finalSpec: HardwareSpec = { ...spec, model: form.model };

    // Output cores to `cpu` attribute since that is the new standard
    if (form.cpuCores) finalSpec.cpu = parseInt(form.cpuCores, 10);

    if (form.ram.value) {
      const r = parseFloat(form.ram.value);
      if (!isNaN(r)) {
        finalSpec.ram = form.ram.unit === 'TB' ? r * 1000 : form.ram.unit === 'MB' ? r / 1000 : r;
      }
    }

    if (form.storage.value) {
      const s = parseFloat(form.storage.value);
      if (!isNaN(s)) {
        finalSpec.storage = form.storage.unit === 'TB' ? s * 1000 : s;
      }
    }

    onConfirm({
      name: form.name || `New ${initialType}`,
      details: finalSpec,
    });
    onOpenChange(false);
  };

  return (
    <Dialog open={open} onOpenChange={onOpenChange}>
      <DialogContent className="sm:max-w-106.25">
        <DialogHeader>
          <DialogTitle>{title || `Add ${initialType.toUpperCase()} Component`}</DialogTitle>
        </DialogHeader>
        <div
          className="grid gap-4 py-4"
          role="presentation"
        >
          {/* Name */}
          <div className="grid grid-cols-4 items-center gap-4">
            <Label htmlFor="name" className="text-right">
              Name
            </Label>
            <Input
              id="name"
              value={form.name}
              onChange={e => dispatch({ type: 'SET_NAME', payload: e.target.value })}
              className="col-span-3"
              placeholder={`e.g. My ${initialType}`}
              autoFocus
            />
          </div>

          {/* Model - Always show */}
          <div className="grid grid-cols-4 items-center gap-4">
            <Label htmlFor="model" className="text-right">
              Model
            </Label>
            <Input
              id="model"
              value={form.model}
              onChange={e => dispatch({ type: 'SET_MODEL', payload: e.target.value })}
              className="col-span-3"
              placeholder="e.g. Samsung 980 Pro"
            />
          </div>

          {/* CPU - Compute types */}
          {nodeHasCPU(initialType) && (
            <>
              <div className="grid grid-cols-4 items-center gap-4">
                <Label htmlFor="cpu_cores" className="text-right">
                  CPU Cores
                </Label>
                <Input
                  id="cpu_cores"
                  type="number"
                  value={form.cpuCores}
                  onChange={e => dispatch({ type: 'SET_CPU_CORES', payload: e.target.value })}
                  className="col-span-3"
                  placeholder="e.g. 16"
                />
              </div>
            </>
          )}

          {/* RAM - Compute + GPU */}
          {nodeHasRAM(initialType) && (
            <div className="grid grid-cols-4 items-center gap-4">
              <Label htmlFor="ram" className="text-right">
                {initialType === 'gpu' ? 'VRAM' : 'RAM'}
              </Label>
              <div className="col-span-3 flex gap-2">
                <Input
                  id="ram"
                  type="number"
                  value={form.ram.value}
                  onChange={e => dispatch({ type: 'SET_RAM_VALUE', payload: e.target.value })}
                  className="flex-1"
                  placeholder="32"
                />
                <select
                  className="h-10 rounded-md border border-input bg-background px-3 py-2 text-sm ring-offset-background focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-ring focus-visible:ring-offset-2"
                  value={form.ram.unit}
                  onChange={e => dispatch({ type: 'SET_RAM_UNIT', payload: e.target.value })}
                >
                  <option value="MB">MB</option>
                  <option value="GB">GB</option>
                </select>
              </div>
            </div>
          )}

          {/* Storage - Compute + Disk + NAS */}
          {nodeHasStorage(initialType) && (
            <div className="grid grid-cols-4 items-center gap-4">
              <Label htmlFor="storage" className="text-right">
                Storage
              </Label>
              <div className="col-span-3 flex gap-2">
                <Input
                  id="storage"
                  type="number"
                  value={form.storage.value}
                  onChange={e => dispatch({ type: 'SET_STORAGE_VALUE', payload: e.target.value })}
                  className="flex-1"
                  placeholder="4"
                />
                <select
                  className="h-10 rounded-md border border-input bg-background px-3 py-2 text-sm ring-offset-background focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-ring focus-visible:ring-offset-2"
                  value={form.storage.unit}
                  onChange={e => dispatch({ type: 'SET_STORAGE_UNIT', payload: e.target.value })}
                >
                  <option value="GB">GB</option>
                  <option value="TB">TB</option>
                </select>
              </div>
            </div>
          )}
        </div>
        <DialogFooter>
          <Button variant="outline" onClick={() => onOpenChange(false)}>
            Cancel
          </Button>
          <Button onClick={handleConfirm}>{initialName ? 'Save Changes' : 'Add Component'}</Button>
        </DialogFooter>
      </DialogContent>
    </Dialog>
  );
}
