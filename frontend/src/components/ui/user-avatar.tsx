import { useState } from 'react';
import { initialsOf, isGeneratedAvatar } from '../../lib/avatar';
import { cn } from '../../lib/utils';

type UserAvatarProps = {
  name?: string;
  /** The picture of the account, when the sign-in provider gave one. */
  src?: string;
  className?: string;
};

/**
 * A user's picture, or their initials when there is none or it does not load.
 * The initials are drawn here; nothing is asked of an avatar service.
 */
export function UserAvatar({ name, src, className }: UserAvatarProps) {
  const [failed, setFailed] = useState(false);
  const frame = cn('size-8 shrink-0 rounded-full bg-muted', className);

  if (src && !failed && !isGeneratedAvatar(src)) {
    return (
      <img
        src={src}
        alt=""
        referrerPolicy="no-referrer"
        className={cn(frame, 'object-cover')}
        onError={() => setFailed(true)}
      />
    );
  }
  return (
    <span
      aria-hidden="true"
      className={cn(
        frame,
        'grid place-items-center border border-border text-xs font-semibold leading-none text-foreground',
      )}
    >
      {initialsOf(name)}
    </span>
  );
}
