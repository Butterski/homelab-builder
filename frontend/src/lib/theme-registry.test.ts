import { describe, expect, it } from 'vitest';

import {
  DEFAULT_THEME_ID,
  buildThemeExportPayload,
  normalizeThemeSettings,
  parseThemeImportPayload,
  themeSettingsFromPreferences,
} from './theme-registry';

const sampleTheme = {
  id: 'ocean-night',
  name: 'Ocean Night',
  mode: 'dark' as const,
  description: 'Custom theme for tests.',
  tokens: {
    background: '#09141a',
    foreground: '#ecfeff',
    card: '#10212b',
    'card-foreground': '#ecfeff',
    popover: '#10212b',
    'popover-foreground': '#ecfeff',
    primary: '#67e8f9',
    'primary-foreground': '#082f49',
    secondary: '#1e293b',
    'secondary-foreground': '#ecfeff',
    muted: '#17222c',
    'muted-foreground': '#94a3b8',
    accent: '#155e75',
    'accent-foreground': '#ecfeff',
    destructive: '#ef4444',
    border: '#1f3a47',
    input: '#1f3a47',
    ring: '#67e8f9',
    'chart-1': '#67e8f9',
    'chart-2': '#34d399',
    'chart-3': '#f59e0b',
    'chart-4': '#818cf8',
    'chart-5': '#f472b6',
    sidebar: '#081118',
    'sidebar-foreground': '#ecfeff',
    'sidebar-primary': '#67e8f9',
    'sidebar-primary-foreground': '#082f49',
    'sidebar-accent': '#10212b',
    'sidebar-accent-foreground': '#ecfeff',
    'sidebar-border': '#1f3a47',
    'sidebar-ring': '#67e8f9',
  },
};

describe('theme registry', () => {
  it('falls back to backend theme settings when available', () => {
    const settings = themeSettingsFromPreferences({
      theme: 'light',
      themeSettings: {
        activeThemeId: 'overwatch-light',
        customThemes: [],
      },
    });

    expect(settings.activeThemeId).toBe('overwatch-light');
  });

  it('imports a single custom theme payload', () => {
    const result = parseThemeImportPayload(JSON.stringify(sampleTheme), []);

    expect(result.importedThemes).toHaveLength(1);
    expect(result.importedThemes[0].id).toBe('ocean-night');
    expect(result.activeThemeId).toBe('ocean-night');
  });

  it('normalizes invalid active theme ids back to the default theme', () => {
    const settings = normalizeThemeSettings({
      activeThemeId: 'missing-theme',
      customThemes: [],
    });

    expect(settings.activeThemeId).toBe(DEFAULT_THEME_ID);
  });

  it('exports only custom themes in the theme pack payload', () => {
    const payload = buildThemeExportPayload({
      activeThemeId: 'ocean-night',
      customThemes: [sampleTheme],
    });

    expect(payload.themes).toHaveLength(1);
    expect(payload.activeThemeId).toBe('ocean-night');
    expect(payload.themes[0]).toMatchObject({ id: 'ocean-night', builtin: undefined });
  });
});