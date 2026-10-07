import { useState } from 'react';
import { Button } from '@/components/ui/button';
import { cn } from '@/lib/utils';
import { useBuilderStore } from '@/features/builder/store/builder-store';
import { useIntegrations } from '../api/integrations';
import { integrationHealthy, summaryLine, timeAgo } from '../lib/import-selection';
import { ProxmoxDialog } from './proxmox-dialog';

/**
 * The integrations of the account, on the inventory page: they are what says
 * which of the listed machines is in use, and as what.
 */
export function IntegrationsSection() {
  const { data } = useIntegrations();
  // The project the sidebar shows as open is the one a comparison starts with.
  const openBuildId = useBuilderStore(state => state.currentBuildId) ?? undefined;
  // undefined: closed; null: a new integration; otherwise the one to open.
  const [opened, setOpened] = useState<string | null | undefined>(undefined);

  if (!data || !data.availability.enabled) return null;
  const integrations = data.integrations;

  return (
    <section className="mt-12 border-t pt-8" aria-labelledby="integrations-title">
      <div className="flex flex-wrap items-end justify-between gap-4">
        <div className="min-w-0">
          <h2 id="integrations-title" className="text-xl font-semibold tracking-[-0.015em]">
            Integrations
          </h2>
          <p className="mt-1 max-w-2xl text-sm text-muted-foreground">
            Proxmox VE knows what really runs on your machines. Connected, it shows which item of
            this list each host is, and what a project plans beside what is deployed. HLBuilder only
            reads from it.
          </p>
        </div>
        {integrations.length < data.availability.limit && (
          <Button variant="outline" onClick={() => setOpened(null)}>
            Connect Proxmox
          </Button>
        )}
      </div>

      {integrations.length > 0 && (
        <div className="app-table-scroll mt-4">
          <table className="app-table min-w-[34rem]">
            <thead>
              <tr>
                <th scope="col">Name</th>
                <th scope="col">What it read</th>
                <th scope="col">Read</th>
                <th scope="col">
                  <span className="sr-only">Open</span>
                </th>
              </tr>
            </thead>
            <tbody>
              {integrations.map(integration => (
                <tr key={integration.id}>
                  <th scope="row">
                    {integration.name}
                    <span className="block text-xs font-normal text-muted-foreground">
                      {integration.source === 'paste' ? 'Pasted export' : integration.base_url}
                    </span>
                  </th>
                  <td>
                    {integration.summary ? summaryLine(integration.summary) : 'Nothing yet'}
                    {integration.last_error && (
                      <span className="block text-xs text-status-warn">
                        {integration.last_error}
                      </span>
                    )}
                  </td>
                  <td
                    className={cn(
                      'whitespace-nowrap',
                      !integrationHealthy(integration) && 'text-status-warn',
                    )}
                  >
                    {integration.synced_at ? timeAgo(integration.synced_at) : 'Never'}
                  </td>
                  <td className="is-end">
                    <button
                      type="button"
                      className="app-link hover:cursor-pointer"
                      onClick={() => setOpened(integration.id)}
                      aria-label={`Open ${integration.name}`}
                    >
                      Open
                    </button>
                  </td>
                </tr>
              ))}
            </tbody>
          </table>
        </div>
      )}

      <ProxmoxDialog
        open={opened !== undefined}
        onOpenChange={open => !open && setOpened(undefined)}
        integrationId={opened ?? null}
        openBuildId={openBuildId}
      />
    </section>
  );
}
