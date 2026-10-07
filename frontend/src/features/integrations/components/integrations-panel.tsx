import { useState } from 'react';
import { Plus } from 'lucide-react';
import { cn } from '@/lib/utils';
import { useIntegrations } from '../api/integrations';
import { integrationHealthy, shortSummary } from '../lib/import-selection';
import { ProxmoxDialog } from './proxmox-dialog';

type IntegrationsPanelProps = {
  /** The project open on the canvas. */
  buildId?: string;
  /** Called with a proposal an import made for that project. */
  onProposal?: (proposalId: string) => void;
};

/**
 * The integrations beside the canvas, under the inventory: each with what it
 * last read, and a click away from comparing the open project with it.
 */
export function IntegrationsPanel({ buildId, onProposal }: IntegrationsPanelProps) {
  const { data } = useIntegrations();
  // undefined: closed; null: a new integration; otherwise the one to open.
  const [opened, setOpened] = useState<string | null | undefined>(undefined);

  if (!data || !data.availability.enabled) return null;
  const integrations = data.integrations;
  const full = integrations.length >= data.availability.limit;

  return (
    <section className="shrink-0 border-t px-4 py-2" aria-label="Integrations">
      <div className="flex min-h-6 items-center justify-between gap-2">
        <h3 className="text-xs font-bold uppercase tracking-wider">Integrations</h3>
        {/* With nothing connected the section is this one line. */}
        {integrations.length === 0 ? (
          <button
            type="button"
            onClick={() => setOpened(null)}
            className="flex items-center gap-1 text-[10px] font-medium text-muted-foreground hover:cursor-pointer hover:text-foreground focus-visible:outline-none focus-visible:ring-1 focus-visible:ring-ring"
          >
            <Plus className="size-3" aria-hidden="true" />
            Connect Proxmox
          </button>
        ) : (
          !full && (
            <button
              type="button"
              onClick={() => setOpened(null)}
              aria-label="Add an integration"
              title="Add an integration"
              className="-mr-1.5 grid size-6 shrink-0 place-items-center rounded text-muted-foreground hover:cursor-pointer hover:bg-background/60 hover:text-foreground focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-primary"
            >
              <Plus className="size-3.5" aria-hidden="true" />
            </button>
          )
        )}
      </div>
      <ul className={cn('space-y-0.5', integrations.length > 0 && 'mt-0.5')}>
        {integrations.map(integration => (
          <li key={integration.id}>
            <button
              type="button"
              onClick={() => setOpened(integration.id)}
              className="-mx-2 flex w-[calc(100%+1rem)] items-baseline gap-2 rounded-md px-2 py-1 text-left hover:cursor-pointer hover:bg-primary/5 focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-inset focus-visible:ring-primary"
            >
              <span
                aria-hidden="true"
                className={cn(
                  'size-1.5 shrink-0 -translate-y-px rounded-full',
                  integrationHealthy(integration) ? 'bg-status-ok' : 'bg-status-warn',
                )}
              />
              {/* One line: the name, then what it last read. */}
              <span className="min-w-0 truncate text-[11px] leading-tight">
                <span className="font-semibold">{integration.name}</span>{' '}
                <span className="text-[10px] text-muted-foreground">
                  {integration.last_error
                    ? 'The last reading failed'
                    : integration.summary
                      ? shortSummary(integration.summary)
                      : 'Not read yet'}
                </span>
              </span>
            </button>
          </li>
        ))}
      </ul>

      <ProxmoxDialog
        open={opened !== undefined}
        onOpenChange={open => !open && setOpened(undefined)}
        integrationId={opened ?? null}
        openBuildId={buildId}
        onProposal={onProposal}
      />
    </section>
  );
}
