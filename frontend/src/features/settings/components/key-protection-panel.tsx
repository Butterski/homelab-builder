import { useState } from 'react';
import { format } from 'date-fns';
import { ExternalLink, Loader2, ShieldCheck, Trash2 } from 'lucide-react';
import { Button } from '@/components/ui/button';
import { ConfirmDialog } from '@/components/ui/confirm-dialog';
import type { AssistantSettings } from '../api/assistant-settings';
import { SOURCE_PATHS, sourceUrl } from '../lib/source-links';

type KeyProtectionPanelProps = {
  settings: AssistantSettings;
  deleting: boolean;
  onDeleteKey: () => void;
};

function SourceLink({ path, children }: { path: string; children: string }) {
  return (
    <a
      href={sourceUrl(path)}
      target="_blank"
      rel="noreferrer"
      className="inline-flex items-center gap-1 text-primary underline-offset-4 hover:underline"
    >
      {children}
      <ExternalLink className="size-3" aria-hidden="true" />
    </a>
  );
}

function when(value: string | null, fallback: string): string {
  return value ? format(new Date(value), 'PPp') : fallback;
}

/**
 * Explains why the provider key is kept on the server and shows the record that
 * is actually stored, with links to the code that handles it. The aim is that
 * nobody has to take the protection on trust.
 */
export function KeyProtectionPanel({ settings, deleting, onDeleteKey }: KeyProtectionPanelProps) {
  const [confirmOpen, setConfirmOpen] = useState(false);
  const storage = settings.key_storage;
  const masterKeyInDatabase = (storage?.master_key_source ?? settings.master_key_source) === 'database';

  return (
    <section
      className="space-y-4 rounded-lg border bg-muted/20 p-4 text-sm"
      aria-labelledby="key-protection-title"
    >
      <h3 id="key-protection-title" className="flex items-center gap-2 font-medium">
        <ShieldCheck className="size-4 text-primary" aria-hidden="true" />
        How your key is protected
      </h3>

      <div className="space-y-1.5">
        <h4 className="text-xs font-semibold uppercase tracking-wider text-muted-foreground">
          Why it is kept on the server
        </h4>
        <ul className="list-disc space-y-1 pl-5 text-muted-foreground">
          <li>
            The assistant reads your build and prepares proposals on the server, with the same
            code that serves MCP clients. Calling the model from there keeps one path to secure
            and to check.
          </li>
          <li>
            The key never has to sit in your browser, where a script on the page or a browser
            extension could read it.
          </li>
          <li>It works with every provider, including ones that refuse calls from a browser.</li>
        </ul>
      </div>

      <div className="space-y-1.5">
        <h4 className="text-xs font-semibold uppercase tracking-wider text-muted-foreground">
          What happens to it
        </h4>
        <ul className="list-disc space-y-1 pl-5 text-muted-foreground">
          <li>
            It is encrypted with AES-256-GCM before it is written to the database, with a fresh
            random nonce.
          </li>
          <li>
            The encryption is tied to your account, so the stored value cannot be decrypted from
            another account&apos;s row.
          </li>
          <li>
            It is never sent back. No response from HLBuilder contains it; this page only
            receives its last four characters.
          </li>
          <li>
            It is decrypted in memory for one chat request, sent only to the provider you chose,
            and not written to logs.
          </li>
          <li>
            If you change the provider or the endpoint address, the stored key is deleted instead
            of being sent somewhere new.
          </li>
        </ul>
      </div>

      <div className="space-y-1.5">
        <h4 className="text-xs font-semibold uppercase tracking-wider text-muted-foreground">
          What it does not protect against
        </h4>
        <p className="text-muted-foreground">
          The server has to decrypt the key to use it, so whoever operates this instance could do
          the same. Use a key with a spending limit, or run HLBuilder yourself to keep full
          control.{' '}
          {masterKeyInDatabase
            ? 'This instance generated its encryption key and keeps it in its own database. That protects a leaked copy of the settings table, not a copy of the whole database. An administrator can move the key out of the database by setting SECRETS_KEY.'
            : 'The encryption key of this instance is supplied through its environment and is not stored in the database.'}
        </p>
      </div>

      <div className="space-y-2">
        <h4 className="text-xs font-semibold uppercase tracking-wider text-muted-foreground">
          What is stored for you right now
        </h4>
        {storage ? (
          <>
            <dl
              className="grid grid-cols-[auto_1fr] gap-x-4 gap-y-1 rounded-md border bg-background/60 p-3 font-mono text-xs"
              data-testid="key-storage-record"
            >
              <dt className="text-muted-foreground">algorithm</dt>
              <dd>{storage.algorithm}</dd>
              <dt className="text-muted-foreground">nonce</dt>
              <dd className="break-all">{storage.nonce_hex}</dd>
              <dt className="text-muted-foreground">ciphertext</dt>
              <dd className="break-all">
                {storage.ciphertext_preview}… ({storage.ciphertext_bytes} bytes)
              </dd>
              <dt className="text-muted-foreground">sha-256</dt>
              <dd className="break-all">{storage.ciphertext_sha256}…</dd>
              <dt className="text-muted-foreground">bound to</dt>
              <dd className="break-all">{storage.bound_to}</dd>
              <dt className="text-muted-foreground">master key</dt>
              <dd>
                {storage.master_key_source === 'env' ? 'server environment' : 'instance database'}{' '}
                (version {storage.master_key_version})
              </dd>
              <dt className="text-muted-foreground">stored</dt>
              <dd>{when(storage.stored_at, 'unknown')}</dd>
              <dt className="text-muted-foreground">last used</dt>
              <dd>{when(storage.last_used_at, 'never')}</dd>
            </dl>
            <p className="text-xs text-muted-foreground">
              This is the encrypted record, not your key. The key itself cannot be displayed.
            </p>
            <Button
              variant="outline"
              size="sm"
              className="text-destructive hover:text-destructive"
              disabled={deleting}
              onClick={() => setConfirmOpen(true)}
            >
              {deleting ? <Loader2 className="animate-spin" /> : <Trash2 />}
              Delete stored key
            </Button>
          </>
        ) : (
          <p className="text-muted-foreground">Nothing. No key is stored for your account.</p>
        )}
      </div>

      <p className="text-xs text-muted-foreground">
        Check it yourself: <SourceLink path={SOURCE_PATHS.keyEncryption}>encryption</SourceLink>,{' '}
        <SourceLink path={SOURCE_PATHS.keyStorage}>key storage</SourceLink> and{' '}
        <SourceLink path={SOURCE_PATHS.keyStorageTests}>its tests</SourceLink>, where the key is
        used (<SourceLink path={SOURCE_PATHS.anthropicClient}>Anthropic</SourceLink>,{' '}
        <SourceLink path={SOURCE_PATHS.openAIClient}>OpenAI-compatible</SourceLink>),{' '}
        <SourceLink path={SOURCE_PATHS.endpointGuard}>endpoint address checks</SourceLink>,{' '}
        <SourceLink path={SOURCE_PATHS.chatAgent}>the chat loop</SourceLink>, and the{' '}
        <SourceLink path={SOURCE_PATHS.assistantSecurityDocs}>security notes</SourceLink>.
      </p>

      <ConfirmDialog
        open={confirmOpen}
        onOpenChange={setConfirmOpen}
        title="Delete the stored key?"
        description="The encrypted key is removed from the database right away. The assistant stops working until you enter a key again."
        confirmLabel="Delete key"
        onConfirm={onDeleteKey}
      />
    </section>
  );
}
