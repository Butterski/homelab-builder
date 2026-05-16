import { Logo } from "./logo";

interface LoadingScreenProps {
  message?: string;
}

export function LoadingScreen({ message = "Loading..." }: LoadingScreenProps) {
  return (
    <div className="flex flex-col items-center justify-center w-full h-full min-h-[50vh] flex-1">
      <div className="relative">
        <Logo className="size-24 mb-6 z-10 relative drop-shadow-xl" variant="loading" />
        {/* Glowing drop shadow base beneath the floating logo */}
        <div className="absolute bottom-4 left-1/2 -translate-x-1/2 w-16 h-4 bg-primary/20 blur-xl rounded-full z-0 animate-pulse"></div>
        <div className="absolute bottom-2 left-1/2 -translate-x-1/2 w-12 h-2 bg-primary/30 blur-md rounded-full z-0 animate-pulse" style={{ animationDelay: '0.15s' }}></div>
      </div>
      <p className="text-lg font-medium text-muted-foreground tracking-wide animate-pulse">{message}</p>
    </div>
  );
}
