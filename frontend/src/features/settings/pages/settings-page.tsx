import { useEffect } from 'react';
import { useLocation, useNavigate } from 'react-router-dom';
import { ChevronLeft } from 'lucide-react';
import { ThemeSettingsCard } from '@/features/auth/components/theme-settings-card';
import { AssistantSettingsCard } from '../components/assistant-settings-card';
import { McpAccessCard } from '../components/mcp-access-card';

export default function SettingsPage() {
  const navigate = useNavigate();
  const { hash } = useLocation();

  // Links such as /settings#assistant open on that section.
  useEffect(() => {
    if (!hash) return;
    document.getElementById(hash.slice(1))?.scrollIntoView?.({ block: 'start' });
  }, [hash]);

  return (
    <div className="flex min-h-screen flex-col bg-background p-6">
      <button
        onClick={() => navigate(-1)}
        type="button"
        className="mb-8 flex w-fit items-center gap-1.5 text-sm text-muted-foreground transition-colors hover:cursor-pointer hover:text-foreground"
      >
        <ChevronLeft className="size-4" />
        Back
      </button>

      <div className="mx-auto w-full max-w-4xl space-y-6">
        <header>
          <h1 className="text-2xl font-semibold tracking-tight">Settings</h1>
          <p className="text-sm text-muted-foreground">
            Appearance, the AI assistant, and how LLM clients may work with your builds.
          </p>
        </header>

        <section id="appearance">
          <ThemeSettingsCard />
        </section>
        <AssistantSettingsCard />
        <McpAccessCard />
      </div>
    </div>
  );
}
