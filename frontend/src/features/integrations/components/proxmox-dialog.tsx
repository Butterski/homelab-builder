import { useState } from 'react';
import { useNavigate } from 'react-router-dom';
import { Loader2 } from 'lucide-react';
import { toast } from 'sonner';
import { Button } from '@/components/ui/button';
import {
  Dialog,
  DialogContent,
  DialogDescription,
  DialogHeader,
  DialogTitle,
} from '@/components/ui/dialog';
import { cn } from '@/lib/utils';
import {
  useIntegrations,
  useSyncIntegration,
  type ImportResult,
  type Integration,
} from '../api/integrations';
import { summaryLine, timeAgo } from '../lib/import-selection';
import { ProxmoxConnection } from './proxmox-connection';
import { ProxmoxHosts } from './proxmox-hosts';
import { ProxmoxImport } from './proxmox-import';

type Tab = 'hosts' | 'import' | 'connection';

const TABS: { id: Tab; label: string }[] = [
  { id: 'hosts', label: 'Hosts and inventory' },
  { id: 'import', label: 'Compare and import' },
  { id: 'connection', label: 'Connection' },
];

type ProxmoxDialogProps = {
  open: boolean;
  onOpenChange: (open: boolean) => void;
  /** The integration to open; null starts a new one. */
  integrationId: string | null;
  /** The project open on the canvas, if the dialog is opened from it. */
  openBuildId?: string;
  /** Called with a proposal for the open project, which the canvas then shows for review. */
  onProposal?: (proposalId: string) => void;
};

const messageOf = (error: unknown, fallback: string) =>
  error instanceof Error && error.message ? error.message : fallback;

function Overview({ integration }: { integration: Integration }) {
  const sync = useSyncIntegration();
  const read = () =>
    sync.mutate(integration.id, {
      onSuccess: () => toast.success('Read the cluster again.'),
      onError: cause => toast.error(messageOf(cause, 'The cluster could not be read.')),
    });

  return (
    <div className="flex flex-wrap items-center justify-between gap-x-6 gap-y-2 border-b pb-4 text-sm">
      <div className="min-w-0">
        <p>
          {integration.summary ? summaryLine(integration.summary) : 'Nothing has been read yet.'}
        </p>
        <p className="text-xs text-muted-foreground">
          {integration.source === 'paste' ? 'From a pasted export' : integration.base_url}
          {integration.synced_at ? `, read ${timeAgo(integration.synced_at)}` : ''}
        </p>
        {integration.last_error && (
          <p className="mt-1 text-xs text-status-warn" role="alert">
            The last reading failed: {integration.last_error}
          </p>
        )}
      </div>
      {integration.source === 'api' && (
        <Button
          size="sm"
          variant="outline"
          onClick={read}
          disabled={sync.isPending || !integration.secret_usable}
        >
          {sync.isPending && <Loader2 className="animate-spin" aria-hidden="true" />}
          Read again
        </Button>
      )}
    </div>
  );
}

/**
 * Everything about one Proxmox integration: how it is reached, which machine
 * of the inventory each host is, and the comparison of what runs with what a
 * project plans. Nothing here writes to an existing project: an import ends in
 * a proposal that is reviewed on the canvas.
 */
export function ProxmoxDialog(props: ProxmoxDialogProps) {
  return (
    <Dialog open={props.open} onOpenChange={props.onOpenChange}>
      <DialogContent className="max-h-[92vh] max-w-5xl overflow-y-auto">
        {/* Mounted while the dialog is open, so every opening starts on its first tab. */}
        <ProxmoxDialogBody {...props} />
      </DialogContent>
    </Dialog>
  );
}

function ProxmoxDialogBody({
  onOpenChange,
  integrationId,
  openBuildId,
  onProposal,
}: ProxmoxDialogProps) {
  const navigate = useNavigate();
  const { data } = useIntegrations();
  // A connection made in this dialog is shown at once, before the list is read again.
  const [created, setCreated] = useState<Integration | null>(null);
  const [tab, setTab] = useState<Tab>('hosts');

  const currentId = integrationId ?? created?.id ?? null;
  const integration =
    data?.integrations.find(entry => entry.id === currentId) ??
    (created?.id === currentId ? created : null);
  const hasSnapshot = !!integration?.summary;
  const shown: Tab = integration && hasSnapshot ? tab : 'connection';

  const imported = (result: ImportResult) => {
    if (result.addresses_left_out) {
      toast.info(
        "The cluster's addresses do not fit this project's network, so the project keeps its own address plan.",
      );
    }
    const inPool = result.addresses_in_pool ?? 0;
    if (inPool > 0) {
      toast.info(
        inPool === 1
          ? "One real address lies in the DHCP range of the project's router, so that machine keeps the address the project gives it."
          : `${inPool} real addresses lie in the DHCP range of the project's router, so those machines keep the addresses the project gives them.`,
      );
    }
    if (result.outcome === 'nothing') {
      toast.info(result.summary);
      return;
    }
    onOpenChange(false);
    if (result.outcome === 'build' && result.build_id) {
      toast.success('Project created from what the cluster runs.', { description: result.summary });
      navigate(`/builder/${result.build_id}`);
      return;
    }
    if (result.outcome === 'proposal' && result.build_id && result.proposal_id) {
      if (result.build_id === openBuildId && onProposal) onProposal(result.proposal_id);
      else navigate(`/builder/${result.build_id}?proposal=${result.proposal_id}`);
    }
  };

  return (
    <>
      <DialogHeader className="pr-8">
        <DialogTitle>{integration ? integration.name : 'Connect Proxmox'}</DialogTitle>
        <DialogDescription>
          {integration
            ? 'What really runs on your hardware, read from Proxmox VE and never changed by HLBuilder.'
            : 'Read what really runs on your hardware, match the hosts to your inventory, and compare it with a project.'}
        </DialogDescription>
      </DialogHeader>

      {!data ? (
        <p className="text-sm text-muted-foreground">Loading…</p>
      ) : !data.availability.enabled ? (
        <p className="text-sm text-muted-foreground">
          Integrations are turned off on this instance. Whoever runs it can turn them on with{' '}
          <code className="app-figure">INTEGRATIONS_ENABLED=true</code>.
        </p>
      ) : (
        <>
          {integration && <Overview integration={integration} />}

          {integration && hasSnapshot && (
            <div role="tablist" aria-label="Proxmox integration" className="flex flex-wrap gap-2">
              {TABS.map(entry => (
                <button
                  key={entry.id}
                  type="button"
                  role="tab"
                  aria-selected={shown === entry.id}
                  onClick={() => setTab(entry.id)}
                  className={cn(
                    'app-filter',
                    shown === entry.id && 'border-foreground text-foreground',
                  )}
                >
                  {entry.label}
                </button>
              ))}
            </div>
          )}

          <div role={integration && hasSnapshot ? 'tabpanel' : undefined}>
            {shown === 'connection' && (
              <ProxmoxConnection
                key={integration?.id ?? 'new'}
                integration={integration ?? undefined}
                availability={data.availability}
                onSaved={saved => {
                  setCreated(saved);
                  if (saved.summary) setTab('hosts');
                }}
                onRemoved={() => onOpenChange(false)}
              />
            )}
            {shown === 'hosts' && integration && <ProxmoxHosts integration={integration} />}
            {shown === 'import' && integration && (
              <ProxmoxImport
                integration={integration}
                openBuildId={openBuildId}
                onImported={imported}
              />
            )}
          </div>
        </>
      )}
    </>
  );
}
