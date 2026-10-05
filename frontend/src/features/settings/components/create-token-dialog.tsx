import { useState, type FormEvent } from 'react';
import { useQuery } from '@tanstack/react-query';
import { KeyRound, Loader2, TriangleAlert } from 'lucide-react';
import { toast } from 'sonner';
import { Button } from '@/components/ui/button';
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
import {
  Select,
  SelectContent,
  SelectItem,
  SelectTrigger,
  SelectValue,
} from '@/components/ui/select';
import { buildApi } from '@/features/builder/api/builds';
import { useCreateApiToken, type CreatedToken, type TokenScope } from '../api/api-tokens';
import { CopyButton, McpSnippetsView } from './mcp-snippets-view';

const ALL_BUILDS = 'all';
const NO_EXPIRY = 'never';

const EXPIRY_OPTIONS = [
  { value: '30', label: '30 days' },
  { value: '90', label: '90 days' },
  { value: '365', label: '1 year' },
  { value: NO_EXPIRY, label: 'No expiry' },
];

type CreateTokenDialogProps = {
  open: boolean;
  onOpenChange: (open: boolean) => void;
  endpoint: string;
};

export function CreateTokenDialog({ open, onOpenChange, endpoint }: CreateTokenDialogProps) {
  const createToken = useCreateApiToken();
  const { data: builds } = useQuery({
    queryKey: ['builds-list'],
    queryFn: () => buildApi.list(),
    enabled: open,
  });

  const [name, setName] = useState('');
  const [scope, setScope] = useState<TokenScope>('propose');
  const [buildId, setBuildId] = useState(ALL_BUILDS);
  const [expiry, setExpiry] = useState('90');
  const [created, setCreated] = useState<CreatedToken | null>(null);

  const reset = () => {
    setName('');
    setScope('propose');
    setBuildId(ALL_BUILDS);
    setExpiry('90');
    setCreated(null);
    createToken.reset();
  };

  const handleOpenChange = (next: boolean) => {
    if (!next) reset();
    onOpenChange(next);
  };

  const submit = async (event: FormEvent) => {
    event.preventDefault();
    try {
      const result = await createToken.mutateAsync({
        name: name.trim(),
        scope,
        build_id: buildId === ALL_BUILDS ? undefined : buildId,
        expires_in_days: expiry === NO_EXPIRY ? undefined : Number(expiry),
      });
      setCreated(result);
    } catch (error) {
      toast.error(error instanceof Error ? error.message : 'Could not create the token.');
    }
  };

  return (
    <Dialog open={open} onOpenChange={handleOpenChange}>
      <DialogContent className="max-w-xl">
        {created ? (
          <>
            <DialogHeader>
              <DialogTitle>Copy your token now</DialogTitle>
              <DialogDescription>
                This is the only time the token is shown. HLBuilder stores a hash of it, so it
                cannot be displayed again.
              </DialogDescription>
            </DialogHeader>
            <div className="space-y-4">
              <div className="flex items-center gap-2">
                <code
                  className="min-w-0 flex-1 overflow-x-auto rounded-md border bg-muted/40 px-3 py-2 font-mono text-xs"
                  data-testid="new-token"
                >
                  {created.token}
                </code>
                <CopyButton value={created.token} label="Copy token" />
              </div>
              <div className="flex items-start gap-2 rounded-md border border-amber-500/40 bg-amber-500/10 px-3 py-2 text-xs">
                <TriangleAlert className="mt-0.5 size-4 shrink-0 text-amber-500" aria-hidden="true" />
                <span>
                  Treat it like a password. Anyone with this token can read your builds
                  {created.record.scope === 'propose' ? ' and send you proposals' : ''}. You can
                  revoke it here at any time.
                </span>
              </div>
              <div>
                <h4 className="mb-2 text-sm font-medium">Connect a client</h4>
                <McpSnippetsView endpoint={endpoint} token={created.token} />
              </div>
            </div>
            <DialogFooter>
              <Button onClick={() => handleOpenChange(false)}>Done</Button>
            </DialogFooter>
          </>
        ) : (
          <form onSubmit={event => void submit(event)} className="space-y-4">
            <DialogHeader>
              <DialogTitle>Create access token</DialogTitle>
              <DialogDescription>
                A token lets one MCP client reach your account. Give each client its own token so
                you can revoke them separately.
              </DialogDescription>
            </DialogHeader>

            <div className="space-y-2">
              <Label htmlFor="token-name">Name</Label>
              <Input
                id="token-name"
                value={name}
                onChange={event => setName(event.target.value)}
                placeholder="e.g. Claude Code on my laptop"
                maxLength={80}
                required
                autoFocus
              />
            </div>

            <div className="space-y-2">
              <Label htmlFor="token-scope">Access</Label>
              <Select value={scope} onValueChange={value => setScope(value as TokenScope)}>
                <SelectTrigger id="token-scope" className="w-full">
                  <SelectValue />
                </SelectTrigger>
                <SelectContent>
                  <SelectItem value="propose">Read and propose changes</SelectItem>
                  <SelectItem value="read">Read only</SelectItem>
                </SelectContent>
              </Select>
              <p className="text-xs text-muted-foreground">
                {scope === 'propose'
                  ? 'The client can read your builds and send proposals. Nothing changes until you apply a proposal in the builder.'
                  : 'The client can read your builds and the catalogs. It cannot propose changes.'}
              </p>
            </div>

            <div className="grid gap-4 sm:grid-cols-2">
              <div className="space-y-2">
                <Label htmlFor="token-build">Builds</Label>
                <Select value={buildId} onValueChange={setBuildId}>
                  <SelectTrigger id="token-build" className="w-full">
                    <SelectValue />
                  </SelectTrigger>
                  <SelectContent>
                    <SelectItem value={ALL_BUILDS}>All my builds</SelectItem>
                    {(builds ?? []).map(build => (
                      <SelectItem key={build.id} value={build.id}>
                        Only: {build.name}
                      </SelectItem>
                    ))}
                  </SelectContent>
                </Select>
              </div>
              <div className="space-y-2">
                <Label htmlFor="token-expiry">Expires</Label>
                <Select value={expiry} onValueChange={setExpiry}>
                  <SelectTrigger id="token-expiry" className="w-full">
                    <SelectValue />
                  </SelectTrigger>
                  <SelectContent>
                    {EXPIRY_OPTIONS.map(option => (
                      <SelectItem key={option.value} value={option.value}>
                        {option.label}
                      </SelectItem>
                    ))}
                  </SelectContent>
                </Select>
              </div>
            </div>

            <DialogFooter>
              <Button type="button" variant="ghost" onClick={() => handleOpenChange(false)}>
                Cancel
              </Button>
              <Button type="submit" disabled={!name.trim() || createToken.isPending}>
                {createToken.isPending ? <Loader2 className="animate-spin" /> : <KeyRound />}
                Create token
              </Button>
            </DialogFooter>
          </form>
        )}
      </DialogContent>
    </Dialog>
  );
}
