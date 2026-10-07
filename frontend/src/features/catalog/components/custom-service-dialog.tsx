import { useId, useState } from 'react';
import { Loader2 } from 'lucide-react';
import { toast } from 'sonner';
import { Button } from '../../../components/ui/button';
import {
  Dialog,
  DialogContent,
  DialogDescription,
  DialogFooter,
  DialogHeader,
  DialogTitle,
} from '../../../components/ui/dialog';
import { Input } from '../../../components/ui/input';
import { Label } from '../../../components/ui/label';
import { Switch } from '../../../components/ui/switch';
import { Textarea } from '../../../components/ui/textarea';
import type { Service } from '../../../types';
import { useBuilderStore } from '../../builder/store/builder-store';
import {
  useCreateCustomService,
  useSubmitCustomService,
  type CustomServicePayload,
} from '../api/use-services';
import { categoryLabel } from '../lib/service-catalog';

const SERVICE_CATEGORIES = [
  'media',
  'networking',
  'monitoring',
  'storage',
  'management',
  'home_automation',
  'gaming',
  'other',
];

/** What a new service needs, least first, then what is comfortable. */
const NEEDS = [
  { key: 'cpu', label: 'CPU cores', step: '0.5', min: '0.5', recommended: '1' },
  { key: 'ram', label: 'RAM, MB', step: '64', min: '256', recommended: '512' },
  { key: 'disk', label: 'Disk, GB', step: '1', min: '1', recommended: '5' },
] as const;

type NeedKey = (typeof NEEDS)[number]['key'];
type Needs = Record<NeedKey, { min: string; recommended: string }>;

const initialNeeds = () =>
  Object.fromEntries(
    NEEDS.map(need => [need.key, { min: need.min, recommended: need.recommended }]),
  ) as Needs;

type CustomServiceDialogProps = {
  open: boolean;
  onOpenChange: (open: boolean) => void;
  onSaved: (service: Service, submittedToCommunity: boolean) => void;
};

/**
 * Adds a service of one's own to the library. It is private until its owner
 * submits it for the public library, which can be done in the same step.
 */
export function CustomServiceDialog({ open, onOpenChange, onSaved }: CustomServiceDialogProps) {
  const id = useId();
  const fetchServices = useBuilderStore(state => state.fetchServices);
  const createService = useCreateCustomService();
  const submitService = useSubmitCustomService();
  const [name, setName] = useState('');
  const [category, setCategory] = useState('other');
  const [description, setDescription] = useState('');
  const [tags, setTags] = useState('');
  const [website, setWebsite] = useState('');
  const [docs, setDocs] = useState('');
  const [github, setGithub] = useState('');
  const [needs, setNeeds] = useState<Needs>(initialNeeds);
  const [dockerSupport, setDockerSupport] = useState(true);
  const [submitToCommunity, setSubmitToCommunity] = useState(false);
  const [error, setError] = useState('');

  const pending = createService.isPending || submitService.isPending;
  const number = (value: string) => Number(value || 0);

  const setNeed = (key: NeedKey, field: 'min' | 'recommended', value: string) =>
    setNeeds(current => ({ ...current, [key]: { ...current[key], [field]: value } }));

  const handleSave = async (event: React.FormEvent) => {
    event.preventDefault();
    setError('');
    if (!name.trim() || !description.trim()) {
      setError('Name and description are required.');
      return;
    }

    const payload: CustomServicePayload = {
      name: name.trim(),
      description: description.trim(),
      category,
      official_website: website.trim(),
      docs_url: docs.trim(),
      github_url: github.trim(),
      tags: JSON.stringify(
        tags
          .split(',')
          .map(tag => tag.trim())
          .filter(Boolean),
      ),
      docker_support: dockerSupport,
      min_cpu_cores: number(needs.cpu.min),
      recommended_cpu_cores: number(needs.cpu.recommended),
      min_ram_mb: number(needs.ram.min),
      recommended_ram_mb: number(needs.ram.recommended),
      min_storage_gb: number(needs.disk.min),
      recommended_storage_gb: number(needs.disk.recommended),
    };

    try {
      const created = await createService.mutateAsync(payload);
      let savedService = created.data;
      if (submitToCommunity) {
        const submitted = await submitService.mutateAsync(created.data.id);
        savedService = submitted.data;
      }
      await fetchServices();
      onSaved(savedService, submitToCommunity);
      onOpenChange(false);
    } catch (err) {
      const message = err instanceof Error ? err.message : 'Could not save service.';
      setError(message);
      toast.error(message);
    }
  };

  return (
    <Dialog open={open} onOpenChange={next => !pending && onOpenChange(next)}>
      <DialogContent className="max-h-[90vh] overflow-y-auto sm:max-w-2xl">
        <DialogHeader>
          <DialogTitle>Add a service</DialogTitle>
          <DialogDescription>
            It is saved to your account and can be placed on any of your projects.
          </DialogDescription>
        </DialogHeader>

        <form onSubmit={handleSave} className="grid gap-5">
          <div className="grid gap-4 sm:grid-cols-[minmax(0,1fr)_12rem]">
            <div className="grid gap-1.5">
              <Label htmlFor={`${id}-name`}>Name</Label>
              <Input
                id={`${id}-name`}
                value={name}
                onChange={event => setName(event.target.value)}
                autoFocus
              />
            </div>
            <div className="grid gap-1.5">
              <Label htmlFor={`${id}-category`}>Category</Label>
              <select
                id={`${id}-category`}
                className="h-9 w-full rounded-md border border-input bg-background px-3 text-sm focus-visible:outline-none focus-visible:ring-1 focus-visible:ring-ring"
                value={category}
                onChange={event => setCategory(event.target.value)}
              >
                {SERVICE_CATEGORIES.map(value => (
                  <option key={value} value={value}>
                    {categoryLabel(value)}
                  </option>
                ))}
              </select>
            </div>
          </div>

          <div className="grid gap-1.5">
            <Label htmlFor={`${id}-description`}>Description</Label>
            <Textarea
              id={`${id}-description`}
              className="min-h-20 resize-none"
              value={description}
              onChange={event => setDescription(event.target.value)}
            />
          </div>

          <fieldset className="grid gap-2">
            <legend className="text-sm font-medium">What it needs</legend>
            <table className="app-table mt-1">
              <thead>
                <tr>
                  <th scope="col" className="w-1/3" />
                  <th scope="col">Minimum</th>
                  <th scope="col">Recommended</th>
                </tr>
              </thead>
              <tbody>
                {NEEDS.map(need => (
                  <tr key={need.key}>
                    <th scope="row" className="font-normal text-muted-foreground">
                      {need.label}
                    </th>
                    {(['min', 'recommended'] as const).map(field => (
                      <td key={field}>
                        <Input
                          type="number"
                          min="0"
                          step={need.step}
                          aria-label={`${need.label}, ${field === 'min' ? 'minimum' : 'recommended'}`}
                          className="h-8 max-w-28 font-mono text-[0.8125rem]"
                          value={needs[need.key][field]}
                          onChange={event => setNeed(need.key, field, event.target.value)}
                        />
                      </td>
                    ))}
                  </tr>
                ))}
              </tbody>
            </table>
          </fieldset>

          <div className="grid gap-4 sm:grid-cols-3">
            <div className="grid gap-1.5">
              <Label htmlFor={`${id}-website`}>Website</Label>
              <Input
                id={`${id}-website`}
                type="url"
                placeholder="https://"
                value={website}
                onChange={event => setWebsite(event.target.value)}
              />
            </div>
            <div className="grid gap-1.5">
              <Label htmlFor={`${id}-docs`}>Documentation</Label>
              <Input
                id={`${id}-docs`}
                type="url"
                placeholder="https://"
                value={docs}
                onChange={event => setDocs(event.target.value)}
              />
            </div>
            <div className="grid gap-1.5">
              <Label htmlFor={`${id}-github`}>Source</Label>
              <Input
                id={`${id}-github`}
                type="url"
                placeholder="https://"
                value={github}
                onChange={event => setGithub(event.target.value)}
              />
            </div>
          </div>

          <div className="grid gap-1.5">
            <Label htmlFor={`${id}-tags`}>Tags</Label>
            <Input
              id={`${id}-tags`}
              placeholder="Separated by commas"
              value={tags}
              onChange={event => setTags(event.target.value)}
            />
          </div>

          <div className="grid border-y">
            <label className="flex items-center justify-between gap-4 py-3 text-sm">
              <span>Runs in Docker</span>
              <Switch checked={dockerSupport} onCheckedChange={setDockerSupport} />
            </label>
            <label className="flex items-center justify-between gap-4 border-t py-3 text-sm">
              <span>
                Submit it for the public library
                <span className="block text-xs text-muted-foreground">
                  It stays private to you until it has been reviewed.
                </span>
              </span>
              <Switch checked={submitToCommunity} onCheckedChange={setSubmitToCommunity} />
            </label>
          </div>

          {error && (
            <p role="alert" className="text-sm text-destructive">
              {error}
            </p>
          )}

          <DialogFooter className="gap-2 sm:space-x-0">
            <Button
              type="button"
              variant="outline"
              onClick={() => onOpenChange(false)}
              disabled={pending}
            >
              Cancel
            </Button>
            <Button type="submit" disabled={pending}>
              {pending && <Loader2 className="animate-spin" aria-hidden="true" />}
              Save service
            </Button>
          </DialogFooter>
        </form>
      </DialogContent>
    </Dialog>
  );
}
