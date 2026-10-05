import { useMemo, useState } from 'react';
import { Check, Copy } from 'lucide-react';
import { toast } from 'sonner';
import { Button } from '@/components/ui/button';
import { cn } from '@/lib/utils';
import { mcpSnippets } from '../lib/mcp-snippets';

export function CopyButton({
  value,
  label,
  className,
}: {
  value: string;
  label: string;
  className?: string;
}) {
  const [copied, setCopied] = useState(false);

  const copy = async () => {
    try {
      await navigator.clipboard.writeText(value);
      setCopied(true);
      window.setTimeout(() => setCopied(false), 1500);
    } catch {
      toast.error('Could not copy. Select the text and copy it manually.');
    }
  };

  return (
    <Button
      type="button"
      variant="outline"
      size="sm"
      className={className}
      onClick={() => void copy()}
      aria-label={label}
    >
      {copied ? <Check /> : <Copy />}
      {copied ? 'Copied' : 'Copy'}
    </Button>
  );
}

/** Client setup instructions with a client picker. */
export function McpSnippetsView({ endpoint, token }: { endpoint: string; token?: string }) {
  const snippets = useMemo(() => mcpSnippets(endpoint, token), [endpoint, token]);
  const [activeId, setActiveId] = useState(snippets[0].id);
  const active = snippets.find(snippet => snippet.id === activeId) ?? snippets[0];

  return (
    <div className="space-y-2">
      <div className="flex flex-wrap gap-1" role="tablist" aria-label="MCP client">
        {snippets.map(snippet => (
          <button
            key={snippet.id}
            type="button"
            role="tab"
            aria-selected={snippet.id === active.id}
            onClick={() => setActiveId(snippet.id)}
            className={cn(
              'rounded-md border px-2.5 py-1 text-xs transition-colors hover:cursor-pointer focus-visible:outline-none focus-visible:ring-1 focus-visible:ring-ring',
              snippet.id === active.id
                ? 'border-primary bg-primary/10 text-foreground'
                : 'border-transparent text-muted-foreground hover:bg-accent',
            )}
          >
            {snippet.label}
          </button>
        ))}
      </div>
      <p className="text-xs text-muted-foreground">{active.hint}</p>
      <div className="relative">
        <pre className="max-h-64 overflow-auto rounded-md border bg-muted/40 p-3 pr-24 text-xs leading-relaxed">
          <code>{active.code}</code>
        </pre>
        <CopyButton
          value={active.code}
          label={`Copy ${active.label} configuration`}
          className="absolute right-2 top-2"
        />
      </div>
    </div>
  );
}
