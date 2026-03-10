import { createContext, useCallback, useContext, useEffect, useState } from 'react';
import {
  type AppTheme,
  type ThemeMode,
  type ThemeSettings,
  DEFAULT_THEME_ID,
  THEME_STORAGE_KEY,
  getThemeById,
  getThemeCatalog,
  normalizeThemeSettings,
  parseStoredThemeSettings,
  serializeThemeSettings,
} from '@/lib/theme-registry';

type ThemeProviderProps = {
  children: React.ReactNode;
  storageKey?: string;
};

type ThemeProviderState = {
  activeThemeId: string;
  activeTheme: AppTheme;
  resolvedMode: ThemeMode;
  themeSettings: ThemeSettings;
  themes: AppTheme[];
  setTheme: (themeId: string) => void;
  replaceThemeSettings: (themeSettings: ThemeSettings) => void;
};

const fallbackThemeSettings = normalizeThemeSettings({ activeThemeId: DEFAULT_THEME_ID, customThemes: [] });
const fallbackTheme = getThemeById(DEFAULT_THEME_ID, fallbackThemeSettings.customThemes);

const initialState: ThemeProviderState = {
  activeThemeId: fallbackTheme.id,
  activeTheme: fallbackTheme,
  resolvedMode: fallbackTheme.mode,
  themeSettings: fallbackThemeSettings,
  themes: getThemeCatalog(fallbackThemeSettings.customThemes),
  setTheme: () => null,
  replaceThemeSettings: () => null,
};

const ThemeProviderContext = createContext<ThemeProviderState>(initialState);

export function ThemeProvider({
  children,
  storageKey = THEME_STORAGE_KEY,
}: ThemeProviderProps) {
  const [themeSettings, setThemeSettings] = useState<ThemeSettings>(() => {
    if (typeof window === 'undefined') {
      return fallbackThemeSettings;
    }

    return parseStoredThemeSettings(localStorage.getItem(storageKey));
  });

  const normalizedThemeSettings = normalizeThemeSettings(themeSettings);
  const themes = getThemeCatalog(normalizedThemeSettings.customThemes);
  const activeTheme = getThemeById(normalizedThemeSettings.activeThemeId, normalizedThemeSettings.customThemes);
  const serializedThemeSettings = serializeThemeSettings(normalizedThemeSettings);

  const setTheme = useCallback((themeId: string) => {
    setThemeSettings(currentValue => ({
      ...normalizeThemeSettings(currentValue),
      activeThemeId: themeId,
    }));
  }, []);

  const replaceThemeSettings = useCallback((nextThemeSettings: ThemeSettings) => {
    setThemeSettings(normalizeThemeSettings(nextThemeSettings));
  }, []);

  useEffect(() => {
    const root = window.document.documentElement;
    root.classList.remove('light', 'dark');
    root.classList.add(activeTheme.mode);
    root.dataset.theme = activeTheme.id;

    for (const [tokenName, tokenValue] of Object.entries(activeTheme.tokens)) {
      root.style.setProperty(`--${tokenName}`, tokenValue);
    }

    localStorage.setItem(storageKey, serializedThemeSettings);
  }, [activeTheme, serializedThemeSettings, storageKey]);

  const value = {
    activeThemeId: activeTheme.id,
    activeTheme,
    resolvedMode: activeTheme.mode,
    themeSettings: normalizedThemeSettings,
    themes,
    setTheme,
    replaceThemeSettings,
  };

  return <ThemeProviderContext.Provider value={value}>{children}</ThemeProviderContext.Provider>;
}

export const useTheme = () => {
  const context = useContext(ThemeProviderContext);

  if (context === undefined) throw new Error('useTheme must be used within a ThemeProvider');

  return context;
};
