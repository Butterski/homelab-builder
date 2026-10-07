import { useEffect } from 'react';
import { useLocation } from 'react-router-dom';
import { Page, PageHeader } from '@/components/layout/page';
import { ThemeSettingsCard } from '@/features/auth/components/theme-settings-card';
import { AssistantSettingsCard } from '../components/assistant-settings-card';
import { McpAccessCard } from '../components/mcp-access-card';

export default function SettingsPage() {
  const { hash } = useLocation();

  // Links such as /settings#assistant open on that section.
  useEffect(() => {
    if (!hash) return;
    document.getElementById(hash.slice(1))?.scrollIntoView?.({ block: 'start' });
  }, [hash]);

  return (
    <Page width="narrow" className="pb-16">
      <PageHeader
        title="Settings"
        lede="Appearance, the AI assistant, and how LLM clients may work with your builds."
      />

      <div className="space-y-6 pt-6">
        <section id="appearance" className="scroll-mt-6">
          <ThemeSettingsCard />
        </section>
        <AssistantSettingsCard />
        <McpAccessCard />
      </div>
    </Page>
  );
}
