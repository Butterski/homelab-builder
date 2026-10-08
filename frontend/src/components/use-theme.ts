import { createContext, use } from 'react';
import {
  type AppTheme,
  type ThemeMode,
  type ThemeSettings,
  DEFAULT_THEME_ID,
  getThemeCatalog,
  normalizeThemeSettings,
} from '@/lib/theme-registry';

type ThemeState = {
  activeThemeId: string;
  activeTheme: AppTheme;
  resolvedMode: ThemeMode;
  themeSettings: ThemeSettings;
  themes: AppTheme[];
  setTheme: (themeId: string) => void;
  replaceThemeSettings: (themeSettings: ThemeSettings) => void;
};

/** Theme state for a set of settings; what the provider hands down. */
export function themeState(
  themeSettings: ThemeSettings,
  setTheme: ThemeState['setTheme'],
  replaceThemeSettings: ThemeState['replaceThemeSettings'],
): ThemeState {
  const themes = getThemeCatalog(themeSettings.customThemes);
  const activeTheme = themes.find(theme => theme.id === themeSettings.activeThemeId) ?? themes.find(theme => theme.id === DEFAULT_THEME_ID)!;
  return {
    activeThemeId: activeTheme.id,
    activeTheme,
    resolvedMode: activeTheme.mode,
    themeSettings,
    themes,
    setTheme,
    replaceThemeSettings,
  };
}

// Outside a ThemeProvider the default theme applies.
export const ThemeContext = createContext<ThemeState>(
  themeState(normalizeThemeSettings({ activeThemeId: DEFAULT_THEME_ID, customThemes: [] }), () => null, () => null),
);

export const useTheme = () => use(ThemeContext);
