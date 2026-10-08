import { ExternalLink } from 'lucide-react';
import { sourceUrl } from '../lib/source-links';

/** A link to a file in the public repository, opened in a new tab. */
export function SourceLink({ path, children }: { path: string; children: string }) {
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
