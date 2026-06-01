import { useState } from 'react';
import { Check, Loader2, ShieldCheck, X } from 'lucide-react';
import { Button } from '../../../components/ui/button';
import { Badge } from '../../../components/ui/badge';
import {
  useAdminHardwareBlueprints,
  useModerateHardwareBlueprint,
  type HardwareBlueprint,
} from '../../catalog/api/use-hardware-blueprints';
import { blueprintMetricBars, fitTone } from '../../catalog/lib/blueprint-fit';
import { hardwareCategoryLabel } from '../../../lib/hardware-taxonomy';

const STATUS_OPTIONS = ['pending', 'approved', 'rejected', 'all'] as const;

export function BlueprintModerationManager() {
  const [status, setStatus] = useState<(typeof STATUS_OPTIONS)[number]>('pending');
  const [notes, setNotes] = useState<Record<string, string>>({});
  const { data, isLoading } = useAdminHardwareBlueprints(status);
  const moderate = useModerateHardwareBlueprint();
  const blueprints = data?.data ?? [];

  const runModeration = (blueprint: HardwareBlueprint, action: 'approve' | 'reject') => {
    moderate.mutate({
      id: blueprint.id,
      action,
      note: notes[blueprint.id] || '',
    });
  };

  return (
    <div className="space-y-4">
      <div className="flex flex-wrap items-center justify-between gap-3">
        <div>
          <h2 className="text-lg font-semibold">Blueprint Moderation</h2>
          <p className="text-sm text-muted-foreground">Review shared hardware blueprints before they enter community discovery.</p>
        </div>
        <select
          className="h-9 rounded-md border bg-background px-3 text-sm"
          value={status}
          onChange={event => setStatus(event.target.value as (typeof STATUS_OPTIONS)[number])}
        >
          {STATUS_OPTIONS.map(option => (
            <option key={option} value={option}>
              {option}
            </option>
          ))}
        </select>
      </div>

      {isLoading ? (
        <div className="grid gap-3">
          {Array.from({ length: 3 }).map((_, index) => (
            <div key={index} className="h-40 animate-pulse rounded-lg border bg-card" />
          ))}
        </div>
      ) : blueprints.length === 0 ? (
        <div className="flex flex-col items-center justify-center rounded-lg border border-dashed py-14 text-center">
          <ShieldCheck className="mb-3 size-10 text-muted-foreground/50" />
          <h3 className="text-sm font-semibold">No blueprints in this queue</h3>
        </div>
      ) : (
        <div className="grid gap-4">
          {blueprints.map(blueprint => (
            <ModerationCard
              key={blueprint.id}
              blueprint={blueprint}
              note={notes[blueprint.id] || ''}
              onNoteChange={value => setNotes(current => ({ ...current, [blueprint.id]: value }))}
              onApprove={() => runModeration(blueprint, 'approve')}
              onReject={() => runModeration(blueprint, 'reject')}
              busy={moderate.isPending}
            />
          ))}
        </div>
      )}
    </div>
  );
}

function ModerationCard({
  blueprint,
  note,
  onNoteChange,
  onApprove,
  onReject,
  busy,
}: {
  blueprint: HardwareBlueprint;
  note: string;
  onNoteChange: (value: string) => void;
  onApprove: () => void;
  onReject: () => void;
  busy: boolean;
}) {
  const bars = blueprint.fit ? blueprintMetricBars(blueprint.fit).slice(0, 5) : [];
  const services = blueprint.services || [];

  return (
    <article className="rounded-lg border bg-card p-4">
      <div className="flex flex-col gap-4 lg:flex-row lg:items-start lg:justify-between">
        <div className="min-w-0 flex-1 space-y-3">
          <div className="flex flex-wrap items-center gap-2">
            <h3 className="truncate text-base font-semibold">{blueprint.name}</h3>
            <Badge variant="outline">{hardwareCategoryLabel(blueprint.category)}</Badge>
            <Badge className={fitTone(blueprint.fit?.grade)}>{blueprint.fit?.score ?? 0} fit</Badge>
            <Badge variant="outline">{blueprint.moderation_status || blueprint.visibility}</Badge>
          </div>
          {blueprint.description && <p className="line-clamp-2 text-sm text-muted-foreground">{blueprint.description}</p>}

          <div className="grid gap-2 md:grid-cols-5">
            {bars.map(bar => (
              <div key={bar.label} className="rounded-md border bg-muted/20 p-2">
                <div className="mb-1 flex justify-between gap-2 text-[10px] text-muted-foreground">
                  <span>{bar.label}</span>
                  <span>{bar.percent}%</span>
                </div>
                <div className="h-1.5 overflow-hidden rounded-full bg-muted">
                  <div className="h-full rounded-full bg-primary" style={{ width: `${Math.max(4, bar.percent)}%` }} />
                </div>
              </div>
            ))}
          </div>

          <div className="flex flex-wrap gap-1.5">
            {services.length === 0 ? (
              <span className="text-xs text-muted-foreground">No bundled services</span>
            ) : (
              services.slice(0, 8).map(service => (
                <span key={service.id} className="rounded border bg-muted px-1.5 py-0.5 text-[10px]">
                  {service.name}
                </span>
              ))
            )}
          </div>
        </div>

        <div className="w-full space-y-2 lg:w-72">
          <textarea
            className="h-20 w-full resize-none rounded-md border bg-background px-3 py-2 text-sm"
            placeholder="Moderation note"
            value={note}
            onChange={event => onNoteChange(event.target.value)}
          />
          <div className="grid grid-cols-2 gap-2">
            <Button variant="outline" onClick={onReject} disabled={busy}>
              {busy ? <Loader2 className="size-4 animate-spin" /> : <X className="size-4" />}
              Reject
            </Button>
            <Button onClick={onApprove} disabled={busy}>
              {busy ? <Loader2 className="size-4 animate-spin" /> : <Check className="size-4" />}
              Approve
            </Button>
          </div>
        </div>
      </div>
    </article>
  );
}
