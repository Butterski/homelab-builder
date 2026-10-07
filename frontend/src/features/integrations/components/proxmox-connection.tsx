import { useId, useState } from 'react';
import { Loader2 } from 'lucide-react';
import { toast } from 'sonner';
import { Button } from '@/components/ui/button';
import { ConfirmDialog } from '@/components/ui/confirm-dialog';
import { Input } from '@/components/ui/input';
import { Label } from '@/components/ui/label';
import { Textarea } from '@/components/ui/textarea';
import {
  useDeleteIntegration,
  useSaveIntegration,
  useTestIntegration,
  type Certificate,
  type Integration,
  type IntegrationAvailability,
  type IntegrationInput,
  type IntegrationTestResult,
} from '../api/integrations';
import { summaryLine, timeAgo } from '../lib/import-selection';

/** The commands that make a token which can read and nothing else. */
export const TOKEN_COMMANDS = [
  'pveum user add hlbuilder@pve --comment "HLBuilder, read-only"',
  'pveum user token add hlbuilder@pve hlbuilder',
  "pveum acl modify / --users hlbuilder@pve --tokens 'hlbuilder@pve!hlbuilder' --roles PVEAuditor",
].join('\n');

export const EXPORT_COMMAND = 'pvesh get /cluster/resources --output-format json';

type Mode = 'api' | 'paste';

type ProxmoxConnectionProps = {
  /** The integration to change; without it a new one is made. */
  integration?: Integration;
  availability: IntegrationAvailability;
  onSaved: (integration: Integration) => void;
  onRemoved: () => void;
};

const messageOf = (error: unknown, fallback: string) =>
  error instanceof Error && error.message ? error.message : fallback;

/** What a host presented as its certificate, for the owner to compare. */
function CertificateFacts({ certificate }: { certificate: Certificate }) {
  return (
    <dl className="mt-2 grid gap-x-4 gap-y-1 text-xs sm:grid-cols-[auto_minmax(0,1fr)]">
      <dt className="text-muted-foreground">SHA-256</dt>
      <dd className="app-figure break-all">{certificate.fingerprint}</dd>
      <dt className="text-muted-foreground">Issued to</dt>
      <dd className="break-all">{certificate.subject || 'not stated'}</dd>
      <dt className="text-muted-foreground">Valid until</dt>
      <dd>{new Date(certificate.not_after).toLocaleDateString()}</dd>
    </dl>
  );
}

/**
 * How HLBuilder reaches a Proxmox cluster: over its API with a read-only
 * token, or not at all, from an export the owner pastes. The form tries a
 * connection before it stores one, and a certificate nobody vouches for is
 * shown for the owner to check rather than accepted.
 */
export function ProxmoxConnection({
  integration,
  availability,
  onSaved,
  onRemoved,
}: ProxmoxConnectionProps) {
  const id = useId();
  const testConnection = useTestIntegration();
  const saveIntegration = useSaveIntegration();
  const deleteIntegration = useDeleteIntegration();

  const [mode, setMode] = useState<Mode>(
    integration
      ? integration.source
      : availability.live && availability.allow_private
        ? 'api'
        : 'paste',
  );
  const [name, setName] = useState(integration?.name ?? 'Proxmox');
  const [baseUrl, setBaseUrl] = useState(integration?.base_url ?? '');
  const [tokenId, setTokenId] = useState(integration?.token_id ?? '');
  const [secret, setSecret] = useState('');
  const [fingerprint, setFingerprint] = useState(integration?.tls_fingerprint ?? '');
  const [exportText, setExportText] = useState('');
  const [result, setResult] = useState<IntegrationTestResult | null>(null);
  /** The values the last successful test was made with. */
  const [testedWith, setTestedWith] = useState('');
  const [error, setError] = useState('');
  const [confirmingRemoval, setConfirmingRemoval] = useState(false);

  const current = JSON.stringify([baseUrl.trim(), tokenId.trim(), secret, fingerprint]);
  const tested = result?.ok === true && testedWith === current;
  const storedSecretFits =
    !!integration?.has_secret &&
    baseUrl.trim() === integration.base_url &&
    tokenId.trim() === integration.token_id;
  const canTest =
    baseUrl.trim() !== '' && tokenId.trim() !== '' && (secret.trim() !== '' || storedSecretFits);
  const pending =
    testConnection.isPending || saveIntegration.isPending || deleteIntegration.isPending;

  // Proxmox shows a new token as "user@realm!name" and its secret; pasted
  // together as "id=secret" they are taken apart.
  const changeTokenId = (value: string) => {
    const pasted = value.trim().match(/^(?:PVEAPIToken=)?([^=\s]+![^=\s]+)=(\S+)$/);
    if (pasted) {
      setTokenId(pasted[1]);
      setSecret(pasted[2]);
      return;
    }
    setTokenId(value);
  };

  const test = async (trusted = fingerprint) => {
    setError('');
    try {
      const outcome = await testConnection.mutateAsync({
        integration_id: !secret.trim() && storedSecretFits ? integration?.id : undefined,
        base_url: baseUrl.trim(),
        token_id: tokenId.trim(),
        secret: secret.trim() || undefined,
        tls_fingerprint: trusted || undefined,
      });
      setResult(outcome);
      if (outcome.ok)
        setTestedWith(JSON.stringify([baseUrl.trim(), tokenId.trim(), secret, trusted]));
    } catch (cause) {
      setResult(null);
      setError(messageOf(cause, 'The connection could not be tried.'));
    }
  };

  const trust = (certificate: Certificate) => {
    setFingerprint(certificate.fingerprint);
    void test(certificate.fingerprint);
  };

  const save = async () => {
    setError('');
    const input: IntegrationInput =
      mode === 'paste'
        ? { name: name.trim(), export: exportText }
        : {
            name: name.trim(),
            base_url: baseUrl.trim(),
            token_id: tokenId.trim(),
            tls_fingerprint: fingerprint,
            ...(secret.trim() ? { secret: secret.trim() } : {}),
          };
    try {
      const saved = await saveIntegration.mutateAsync({ id: integration?.id, input });
      setSecret('');
      setExportText('');
      if (saved.last_error) {
        toast.warning(`Saved, but the cluster could not be read: ${saved.last_error}`);
      } else {
        toast.success(mode === 'paste' ? 'The export was read.' : `Connected to ${saved.name}.`);
      }
      onSaved(saved);
    } catch (cause) {
      setError(messageOf(cause, 'The integration could not be saved.'));
    }
  };

  const remove = async () => {
    if (!integration) return;
    try {
      await deleteIntegration.mutateAsync(integration.id);
      toast.success(`Removed ${integration.name}.`);
      onRemoved();
    } catch (cause) {
      setError(messageOf(cause, 'The integration could not be removed.'));
    }
  };

  // An integration keeps the way it was made: a pasted export has no address
  // to call, and a connection is not replaced by a paste.
  const modes: { id: Mode; label: string; off: boolean }[] = [
    {
      id: 'api',
      label: 'Connect to the API',
      off: !availability.live || integration?.source === 'paste',
    },
    { id: 'paste', label: 'Paste an export', off: integration?.source === 'api' },
  ];

  return (
    <div className="grid gap-5">
      {!integration && (
        <div className="flex flex-wrap gap-2" role="group" aria-label="How to read the cluster">
          {modes.map(option => (
            <button
              key={option.id}
              type="button"
              className="app-filter disabled:cursor-not-allowed disabled:opacity-50"
              aria-pressed={mode === option.id}
              disabled={option.off}
              onClick={() => setMode(option.id)}
            >
              {option.label}
            </button>
          ))}
        </div>
      )}

      {!availability.live && !integration && (
        <p className="text-sm text-muted-foreground">
          This instance cannot keep a token secret: it has no master key (
          <code className="app-figure">SECRETS_KEY</code>
          ). It reads pasted exports only.
        </p>
      )}
      {availability.live && !availability.allow_private && mode === 'api' && (
        <p className="border-l-2 border-status-warn pl-3 text-sm">
          This instance runs on the internet and may not call private addresses, so it cannot reach
          a Proxmox host on your home network. Paste an export instead, or run your own copy of
          HLBuilder next to the cluster.
        </p>
      )}

      <div className="max-w-sm">
        <Label htmlFor={`${id}-name`} className="text-xs text-muted-foreground">
          Name
        </Label>
        <Input
          id={`${id}-name`}
          className="mt-1"
          value={name}
          onChange={event => setName(event.target.value)}
          maxLength={80}
          placeholder="Proxmox"
        />
      </div>

      {mode === 'api' ? (
        <>
          <div className="grid gap-3 sm:grid-cols-2">
            <div className="sm:col-span-2">
              <Label htmlFor={`${id}-url`} className="text-xs text-muted-foreground">
                Address
              </Label>
              <Input
                id={`${id}-url`}
                className="mt-1 font-mono"
                value={baseUrl}
                onChange={event => setBaseUrl(event.target.value)}
                placeholder="e.g. https://192.168.10.10:8006"
                autoComplete="off"
                spellCheck={false}
              />
            </div>
            <div>
              <Label htmlFor={`${id}-token`} className="text-xs text-muted-foreground">
                Token ID
              </Label>
              <Input
                id={`${id}-token`}
                className="mt-1 font-mono"
                value={tokenId}
                onChange={event => changeTokenId(event.target.value)}
                placeholder="e.g. hlbuilder@pve!hlbuilder"
                autoComplete="off"
                spellCheck={false}
              />
            </div>
            <div>
              <Label htmlFor={`${id}-secret`} className="text-xs text-muted-foreground">
                Secret
              </Label>
              <Input
                id={`${id}-secret`}
                type="password"
                className="mt-1 font-mono"
                value={secret}
                onChange={event => setSecret(event.target.value)}
                placeholder={
                  storedSecretFits
                    ? 'Stored. Leave empty to keep it.'
                    : 'The value Proxmox shows once'
                }
                autoComplete="off"
                spellCheck={false}
              />
            </div>
          </div>

          <details className="text-sm">
            <summary className="cursor-pointer font-medium">How to make a read-only token</summary>
            <div className="grid gap-2 pt-3 text-muted-foreground">
              <p>
                In a shell on a Proxmox host. The second command prints the secret once. The role
                PVEAuditor can look at everything and change nothing.
              </p>
              <pre className="app-code">{TOKEN_COMMANDS}</pre>
            </div>
          </details>

          {result && !result.ok && result.certificate && result.error_kind === 'certificate' && (
            <div className="border-l-2 border-status-warn pl-3 text-sm" role="alert">
              <p className="font-medium">
                The host&apos;s certificate is not signed by a public authority.
              </p>
              <p className="mt-1 text-muted-foreground">
                That is the default on Proxmox. Nothing was sent to the host yet. Compare the
                fingerprint with the one Proxmox shows for the node under System, Certificates (or
                with <code className="app-figure">pvenode cert info</code>), then trust it. Only
                this certificate is accepted from then on.
              </p>
              <CertificateFacts certificate={result.certificate} />
              <Button
                size="sm"
                className="mt-3"
                onClick={() => trust(result.certificate!)}
                disabled={pending}
              >
                Trust this certificate and try again
              </Button>
            </div>
          )}
          {result && !result.ok && result.certificate && result.error_kind === 'fingerprint' && (
            <div className="border-l-2 border-destructive pl-3 text-sm" role="alert">
              <p className="font-medium">
                The host presents a different certificate than the one you trusted.
              </p>
              <p className="mt-1 text-muted-foreground">
                If you renewed it, check the new fingerprint and trust it. If you did not, something
                else is answering at this address.
              </p>
              <CertificateFacts certificate={result.certificate} />
              <Button
                size="sm"
                variant="outline"
                className="mt-3"
                onClick={() => trust(result.certificate!)}
                disabled={pending}
              >
                Trust the new certificate and try again
              </Button>
            </div>
          )}
          {result &&
            !result.ok &&
            result.error_kind !== 'certificate' &&
            result.error_kind !== 'fingerprint' && (
              <p className="border-l-2 border-destructive pl-3 text-sm" role="alert">
                {result.error}
              </p>
            )}
          {tested && result?.summary && (
            <div className="border-l-2 border-status-ok pl-3 text-sm" role="status">
              <p className="font-medium">Connected.</p>
              <p className="mt-0.5 text-muted-foreground">{summaryLine(result.summary)}</p>
              {result.notes.map(note => (
                <p key={note} className="mt-1 text-muted-foreground">
                  {note}
                </p>
              ))}
            </div>
          )}

          <p className="text-xs text-muted-foreground">
            The secret is encrypted with this instance&apos;s master key before it is stored, is
            never shown again and is sent only to this address. HLBuilder reads the cluster and
            changes nothing: every request it makes is a GET.
            {fingerprint && (
              <>
                {' '}
                Trusted certificate: <span className="app-figure">{fingerprint.slice(0, 23)}…</span>
              </>
            )}
          </p>
        </>
      ) : (
        <div className="grid gap-3">
          <p className="text-sm text-muted-foreground">
            Run this in a shell on any host of the cluster and paste what it prints. It lists hosts,
            guests and storage with their sizes; processor models and addresses are read over the
            API only.
          </p>
          <pre className="app-code">{EXPORT_COMMAND}</pre>
          <div>
            <Label htmlFor={`${id}-export`} className="text-xs text-muted-foreground">
              Export
            </Label>
            <Textarea
              id={`${id}-export`}
              rows={6}
              className="mt-1 font-mono text-xs"
              value={exportText}
              onChange={event => setExportText(event.target.value)}
              placeholder='[{"type":"node","node":"pve01", …}]'
              spellCheck={false}
            />
          </div>
          {integration?.synced_at && (
            <p className="text-xs text-muted-foreground">
              The export in use was pasted {timeAgo(integration.synced_at)}.
            </p>
          )}
        </div>
      )}

      {error && (
        <p role="alert" className="text-sm text-destructive">
          {error}
        </p>
      )}

      <div className="flex flex-wrap items-center justify-between gap-2 border-t pt-4">
        {integration ? (
          <Button
            variant="ghost"
            className="text-destructive hover:text-destructive"
            onClick={() => setConfirmingRemoval(true)}
            disabled={pending}
          >
            Remove this integration
          </Button>
        ) : (
          <span />
        )}
        <div className="flex flex-wrap gap-2">
          {mode === 'api' ? (
            <>
              <Button variant="outline" onClick={() => void test()} disabled={!canTest || pending}>
                {testConnection.isPending && (
                  <Loader2 className="animate-spin" aria-hidden="true" />
                )}
                Test connection
              </Button>
              <Button onClick={() => void save()} disabled={!tested || pending}>
                {saveIntegration.isPending && (
                  <Loader2 className="animate-spin" aria-hidden="true" />
                )}
                Save and read the cluster
              </Button>
            </>
          ) : (
            <Button onClick={() => void save()} disabled={exportText.trim() === '' || pending}>
              {saveIntegration.isPending && <Loader2 className="animate-spin" aria-hidden="true" />}
              Read the export
            </Button>
          )}
        </div>
      </div>

      <ConfirmDialog
        open={confirmingRemoval}
        onOpenChange={setConfirmingRemoval}
        title={`Remove ${integration?.name ?? 'this integration'}?`}
        description="Its stored secret and what was read from it are deleted. Your inventory and your projects stay as they are."
        confirmLabel="Remove"
        onConfirm={() => void remove()}
      />
    </div>
  );
}
