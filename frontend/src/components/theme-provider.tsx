import { useCallback, useEffect, useMemo, useState } from 'react';
import {
  type ThemeSettings,
  THEME_STORAGE_KEY,
  normalizeThemeSettings,
  parseStoredThemeSettings,
  serializeThemeSettings,
} from '@/lib/theme-registry';
import { ThemeContext, themeState } from './use-theme';

export function ThemeProvider({ children }: { children: React.ReactNode }) {
  // Always normalized: every way in goes through normalizeThemeSettings.
  const [themeSettings, setThemeSettings] = useState<ThemeSettings>(() =>
    parseStoredThemeSettings(localStorage.getItem(THEME_STORAGE_KEY)),
  );

  const setTheme = useCallback((themeId: string) => {
    setThemeSettings(currentValue => normalizeThemeSettings({ ...currentValue, activeThemeId: themeId }));
  }, []);

  const replaceThemeSettings = useCallback((nextThemeSettings: ThemeSettings) => {
    setThemeSettings(normalizeThemeSettings(nextThemeSettings));
  }, []);

  const value = useMemo(
    () => themeState(themeSettings, setTheme, replaceThemeSettings),
    [themeSettings, setTheme, replaceThemeSettings],
  );
  const { activeTheme } = value;

  useEffect(() => {
    const root = window.document.documentElement;
    root.classList.remove('light', 'dark');
    root.classList.add(activeTheme.mode);
    root.dataset.theme = activeTheme.id;

    for (const [tokenName, tokenValue] of Object.entries(activeTheme.tokens)) {
      root.style.setProperty(`--${tokenName}`, tokenValue);
    }

    localStorage.setItem(THEME_STORAGE_KEY, serializeThemeSettings(themeSettings));
  }, [activeTheme, themeSettings]);

  return <ThemeContext.Provider value={value}>{children}</ThemeContext.Provider>;
}
