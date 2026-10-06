/** "0.4 s", "12 s": how long a step took. */
export function formatDuration(ms: number): string {
  if (ms < 100) return '0.1 s';
  if (ms < 10_000) return `${(ms / 1000).toFixed(1)} s`;
  return `${Math.round(ms / 1000)} s`;
}
