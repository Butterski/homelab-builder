/** "1 node", "3 nodes", "2 boxes" with `many` given. */
export function plural(count: number, one: string, many = `${one}s`): string {
  return `${count} ${count === 1 ? one : many}`;
}

/** Megabytes as people say them: 512 is "512 MB", 4096 is "4 GB", 31985 is "31.2 GB". */
export function formatMemory(mb: number): string {
  if (!Number.isFinite(mb) || mb <= 0) return '0 GB';
  if (mb < 1024) return `${Math.round(mb)} MB`;
  const gb = mb / 1024;
  return `${Number.isInteger(gb) ? gb : gb.toFixed(1)} GB`;
}
