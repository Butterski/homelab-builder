import { Logo } from './logo';

interface LoadingScreenProps {
  message?: string;
}

/** What is shown while a screen is on its way: the mark, moving, and one line saying what is loading. */
export function LoadingScreen({ message = 'Loading...' }: LoadingScreenProps) {
  return (
    <div
      className="flex h-full min-h-[50vh] w-full flex-1 flex-col items-center justify-center gap-5"
      role="status"
    >
      <Logo className="size-16" variant="loading" />
      <p className="text-sm text-muted-foreground">{message}</p>
    </div>
  );
}
