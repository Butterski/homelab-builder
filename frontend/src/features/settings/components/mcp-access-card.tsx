import { useEffect, useState } from 'react';
import { useQuery } from '@tanstack/react-query';
import { formatDistanceToNow } from 'date-fns';
import { ExternalLink, KeyRound, Plug, Trash2 } from 'lucide-react';
import { toast } from 'sonner';
import { Badge } from '@/components/ui/badge';
import { Button } from '@/components/ui/button';
import { Card, CardContent, CardDescription, CardHeader, CardTitle } from '@/components/ui/card';
import { ConfirmDialog } from '@/components/ui/confirm-dialog';
import { getAuthConfig } from '@/features/auth/lib/auth-config';
import { buildApi } from '@/features/builder/api/builds';
import { useApiTokens, useRevokeApiToken, type ApiToken } from '../api/api-tokens';
import { mcpEndpointUrl } from '../lib/mcp-snippets';
import { SOURCE_PATHS, sourceUrl } from '../lib/source-links';
import { CreateTokenDialog } from './create-token-dialog';
import { CopyButton, McpSnippetsView } from './mcp-snippets-view';

function relative(date: string | undefined, fallback: string): string {
  return date ? formatDistanceToNow(new Date(date), { addSuffix: true }) : fallback;
}

function expiryText(token: ApiToken): string {
  if (!token.expires_at) return 'No expiry';
  const expires = new Date(token.expires_at);
  return expires.getTime() <= Date.now()
    ? 'Expired'
    : `Expires ${formatDistanceToNow(expires, { addSuffix: true })}`;
}

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

/** Settings card for connecting MCP clients with personal access tokens. */
export function McpAccessCard() {
  const endpoint = mcpEndpointUrl();
  const { data, isLoading, isError } = useApiTokens();
  const revokeToken = useRevokeApiToken();
  const { data: builds } = useQuery({ queryKey: ['builds-list'], queryFn: () => buildApi.list() });
  const [createOpen, setCreateOpen] = useState(false);
  const [revoking, setRevoking] = useState<ApiToken | null>(null);
  const [mcpEnabled, setMcpEnabled] = useState(true);

  useEffect(() => {
    let cancelled = false;
    void getAuthConfig().then(config => {
      if (!cancelled) setMcpEnabled(config.mcp_enabled);
    });
    return () => {
      cancelled = true;
    };
  }, []);

  const tokens = data?.tokens ?? [];
  const limit = data?.limit ?? 20;
  const buildName = (id: string) => builds?.find(build => build.id === id)?.name ?? 'one build';

  const revoke = async (token: ApiToken) => {
    try {
      await revokeToken.mutateAsync(token.id);
      toast.success(`Revoked "${token.name}".`);
    } catch (error) {
      toast.error(error instanceof Error ? error.message : 'Could not revoke the token.');
    }
  };

  return (
    <Card id="mcp">
      <CardHeader>
        <CardTitle className="flex items-center gap-2 text-base">
          <Plug className="size-4 text-primary" aria-hidden="true" />
          MCP access
        </CardTitle>
        <CardDescription>
          Connect an LLM client such as Claude Code, Cursor or VS Code to your account over the
          Model Context Protocol, so it can see your builds and help design them.
        </CardDescription>
      </CardHeader>
      <CardContent className="space-y-6">
        {!mcpEnabled && (
          <p className="rounded-md border border-amber-500/40 bg-amber-500/10 px-3 py-2 text-sm">
            MCP access is turned off on this instance. An administrator can enable it with{' '}
            <code className="font-mono text-xs">MCP_ENABLED=true</code>.
          </p>
        )}

        <section className="space-y-2">
          <h3 className="text-sm font-medium">Endpoint</h3>
          <div className="flex items-center gap-2">
            <code className="min-w-0 flex-1 overflow-x-auto rounded-md border bg-muted/40 px-3 py-2 font-mono text-xs">
              {endpoint}
            </code>
            <CopyButton value={endpoint} label="Copy endpoint URL" />
          </div>
        </section>

        <section className="space-y-2 text-sm">
          <h3 className="font-medium">What a client can do</h3>
          <ul className="list-disc space-y-1 pl-5 text-muted-foreground">
            <li>
              Read your builds, validate their network, and search the hardware and service
              catalogs.
            </li>
            <li>
              Propose changes. A proposal changes nothing by itself: you review it in the builder
              with a preview and choose Apply or Reject.
            </li>
            <li>
              Reach only what its token allows. A token can be read-only, and can be limited to a
              single build.
            </li>
          </ul>
          <p className="text-xs text-muted-foreground">
            Tokens are stored as SHA-256 hashes, so they cannot be read back from the database.
            Check it yourself: <SourceLink path={SOURCE_PATHS.tokenService}>token storage</SourceLink>
            , <SourceLink path={SOURCE_PATHS.mcpServer}>MCP endpoint</SourceLink>,{' '}
            <SourceLink path={SOURCE_PATHS.proposalService}>proposal handling</SourceLink>,{' '}
            <SourceLink path={SOURCE_PATHS.mcpDocs}>setup guide</SourceLink>.
          </p>
        </section>

        <section className="space-y-3">
          <div className="flex items-center justify-between gap-2">
            <h3 className="text-sm font-medium">
              Access tokens{' '}
              <span className="font-normal text-muted-foreground">
                ({tokens.length}/{limit})
              </span>
            </h3>
            <Button
              size="sm"
              onClick={() => setCreateOpen(true)}
              disabled={!mcpEnabled || tokens.length >= limit}
            >
              <KeyRound />
              Create token
            </Button>
          </div>

          {isLoading && <p className="text-sm text-muted-foreground">Loading tokens…</p>}
          {isError && <p className="text-sm text-destructive">Could not load your tokens.</p>}
          {!isLoading && !isError && tokens.length === 0 && (
            <p className="rounded-md border border-dashed px-3 py-4 text-center text-sm text-muted-foreground">
              No tokens yet. Create one to connect your first client.
            </p>
          )}
          {tokens.length > 0 && (
            <ul className="divide-y rounded-md border">
              {tokens.map(token => (
                <li key={token.id} className="flex items-center gap-3 px-3 py-2.5">
                  <div className="min-w-0 flex-1">
                    <div className="flex flex-wrap items-center gap-2 text-sm font-medium">
                      <span className="truncate">{token.name}</span>
                      <Badge variant={token.scope === 'propose' ? 'default' : 'secondary'}>
                        {token.scope === 'propose' ? 'Read + propose' : 'Read only'}
                      </Badge>
                      {token.build_id && (
                        <Badge variant="outline" className="max-w-48 truncate">
                          {buildName(token.build_id)}
                        </Badge>
                      )}
                    </div>
                    <p className="mt-0.5 truncate text-xs text-muted-foreground">
                      <code className="font-mono">{token.prefix}…</code> · Created{' '}
                      {relative(token.created_at, 'recently')} · Last used{' '}
                      {relative(token.last_used_at, 'never')} · {expiryText(token)}
                    </p>
                  </div>
                  <Button
                    variant="ghost"
                    size="sm"
                    className="shrink-0 text-destructive hover:text-destructive"
                    onClick={() => setRevoking(token)}
                    aria-label={`Revoke ${token.name}`}
                  >
                    <Trash2 />
                    Revoke
                  </Button>
                </li>
              ))}
            </ul>
          )}
        </section>

        <details className="group rounded-md border px-3 py-2">
          <summary className="cursor-pointer text-sm font-medium">Client setup</summary>
          <div className="pt-3">
            <McpSnippetsView endpoint={endpoint} />
          </div>
        </details>
      </CardContent>

      <CreateTokenDialog open={createOpen} onOpenChange={setCreateOpen} endpoint={endpoint} />
      <ConfirmDialog
        open={revoking !== null}
        onOpenChange={open => !open && setRevoking(null)}
        title={`Revoke "${revoking?.name ?? ''}"?`}
        description="The client using this token loses access immediately. This cannot be undone."
        confirmLabel="Revoke"
        onConfirm={() => {
          if (revoking) void revoke(revoking);
        }}
      />
    </Card>
  );
}
