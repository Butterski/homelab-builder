import { Moon, Sun } from 'lucide-react';

import { api } from '../lib/api';
import { DEFAULT_THEME_ID, LIGHT_THEME_ID, normalizeThemeSettings } from '../lib/theme-registry';
import { useTheme } from './theme-provider';
import { Button } from './ui/button';

export function ThemeToggle() {
  const { resolvedMode, setTheme, themeSettings } = useTheme();

  return (
    <Button
      variant="ghost"
      size="icon"
      onClick={() => {
        const nextThemeId = resolvedMode === 'light' ? DEFAULT_THEME_ID : LIGHT_THEME_ID;
        const nextThemeSettings = normalizeThemeSettings({
          ...themeSettings,
          activeThemeId: nextThemeId,
        });

        setTheme(nextThemeId);
        if (localStorage.getItem('auth_token')) {
          api.updateThemeSettings(nextThemeSettings).catch(console.error);
        }
      }}
      className="rounded-full"
    >
      <Sun className="h-[1.2rem] w-[1.2rem] rotate-0 scale-100 transition-all dark:-rotate-90 dark:scale-0" />
      <Moon className="absolute h-[1.2rem] w-[1.2rem] rotate-90 scale-0 transition-all dark:rotate-0 dark:scale-100" />
      <span className="sr-only">Toggle theme</span>
    </Button>
  );
}
