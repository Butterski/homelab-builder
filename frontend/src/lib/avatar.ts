/** Up to two initials: "Ada Lovelace" is AL, "local" is L. */
export function initialsOf(name: string | undefined): string {
  const words = (name ?? '').trim().split(/\s+/).filter(Boolean);
  if (words.length === 0) return '?';
  const first = words[0][0];
  const last = words.length > 1 ? words[words.length - 1][0] : '';
  return (first + last).toUpperCase();
}

/**
 * Accounts made without Google (the local owner, a development login) carry
 * the address of a generated cartoon instead of a picture. That is not a
 * picture of anybody, and fetching it tells a third party who is working here.
 */
export function isGeneratedAvatar(src: string | undefined): boolean {
  return !!src && /^https?:\/\/([a-z0-9-]+\.)*dicebear\.com\//i.test(src);
}
