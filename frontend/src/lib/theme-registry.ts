import presetThemeData from '@/theme/presets.json';

export const THEME_STORAGE_KEY = 'hlbuilder-theme-settings';
export const DEFAULT_THEME_ID = 'dark';
export const LIGHT_THEME_ID = 'light';

export const THEME_TOKEN_KEYS = [
  'background',
  'foreground',
  'card',
  'card-foreground',
  'popover',
  'popover-foreground',
  'primary',
  'primary-foreground',
  'secondary',
  'secondary-foreground',
  'muted',
  'muted-foreground',
  'accent',
  'accent-foreground',
  'destructive',
  'border',
  'input',
  'ring',
  'chart-1',
  'chart-2',
  'chart-3',
  'chart-4',
  'chart-5',
  'sidebar',
  'sidebar-foreground',
  'sidebar-primary',
  'sidebar-primary-foreground',
  'sidebar-accent',
  'sidebar-accent-foreground',
  'sidebar-border',
  'sidebar-ring',
] as const;

export type ThemeTokenKey = (typeof THEME_TOKEN_KEYS)[number];
export type ThemeMode = 'dark' | 'light';

export type ThemeTokens = Record<ThemeTokenKey, string>;

export type AppTheme = {
  id: string;
  name: string;
  description?: string;
  mode: ThemeMode;
  tokens: ThemeTokens;
  builtin?: boolean;
};

export type ThemeSettings = {
  activeThemeId: string;
  customThemes: AppTheme[];
};

export type ThemeImportPayload = {
  version: 1;
  themes: AppTheme[];
  activeThemeId?: string;
};

const presetThemes = normalizeThemeCollection((presetThemeData as { themes?: unknown[] }).themes ?? [], true);
const presetThemeMap = new Map(presetThemes.map(theme => [theme.id, theme]));

function isRecord(value: unknown): value is Record<string, unknown> {
  return typeof value === 'object' && value !== null && !Array.isArray(value);
}

function normalizeThemeId(value: string) {
  return value
    .trim()
    .toLowerCase()
    .replace(/[^a-z0-9]+/g, '-')
    .replace(/^-+|-+$/g, '');
}

function preferredSystemTheme(): ThemeMode {
  if (typeof window !== 'undefined' && window.matchMedia('(prefers-color-scheme: light)').matches) {
    return 'light';
  }

  return 'dark';
}

function normalizeTheme(candidate: unknown, builtin = false): AppTheme | null {
  if (!isRecord(candidate)) {
    return null;
  }

  const rawId = typeof candidate.id === 'string' ? normalizeThemeId(candidate.id) : '';
  const rawName = typeof candidate.name === 'string' ? candidate.name.trim() : '';
  const mode = candidate.mode === 'light' || candidate.mode === 'dark' ? candidate.mode : null;
  const rawTokens = isRecord(candidate.tokens) ? candidate.tokens : null;

  if (!rawId || !rawName || !mode || !rawTokens) {
    return null;
  }

  const tokens = {} as ThemeTokens;
  for (const tokenKey of THEME_TOKEN_KEYS) {
    const tokenValue = rawTokens[tokenKey];
    if (typeof tokenValue !== 'string' || !tokenValue.trim()) {
      return null;
    }

    tokens[tokenKey] = tokenValue.trim();
  }

  return {
    id: rawId,
    name: rawName,
    description: typeof candidate.description === 'string' ? candidate.description.trim() : undefined,
    mode,
    tokens,
    builtin,
  };
}

function normalizeThemeCollection(candidates: unknown[], builtin = false) {
  const themes: AppTheme[] = [];

  for (const candidate of candidates) {
    const theme = normalizeTheme(candidate, builtin);
    if (theme) {
      themes.push(theme);
    }
  }

  return themes;
}

function ensureUniqueCustomThemeId(theme: AppTheme, usedIds: Set<string>) {
  let nextId = theme.id;
  let index = 1;

  while (usedIds.has(nextId)) {
    nextId = `${theme.id}-${index}`;
    index += 1;
  }

  usedIds.add(nextId);
  return {
    ...theme,
    id: nextId,
    builtin: false,
  };
}

export function getPresetThemes() {
  return presetThemes.map(theme => ({ ...theme }));
}

export function getThemeCatalog(customThemes: AppTheme[]) {
  const normalizedCustomThemes = normalizeCustomThemes(customThemes);
  return [...getPresetThemes(), ...normalizedCustomThemes];
}

export function getThemeById(themeId: string, customThemes: AppTheme[]) {
  return getThemeCatalog(customThemes).find(theme => theme.id === themeId) ?? presetThemeMap.get(DEFAULT_THEME_ID)!;
}

export function getDefaultThemeSettings(): ThemeSettings {
  return {
    activeThemeId: DEFAULT_THEME_ID,
    customThemes: [],
  };
}

export function normalizeCustomThemes(customThemes: unknown) {
  if (!Array.isArray(customThemes)) {
    return [];
  }

  const normalizedThemes = normalizeThemeCollection(customThemes, false);
  const usedIds = new Set(presetThemes.map(theme => theme.id));

  return normalizedThemes.map(theme => ensureUniqueCustomThemeId(theme, usedIds));
}

export function normalizeThemeSettings(rawValue: unknown): ThemeSettings {
  if (!isRecord(rawValue)) {
    return getDefaultThemeSettings();
  }

  const customThemes = normalizeCustomThemes(rawValue.customThemes);
  const catalog = getThemeCatalog(customThemes);
  const activeThemeId = typeof rawValue.activeThemeId === 'string' ? normalizeThemeId(rawValue.activeThemeId) : DEFAULT_THEME_ID;
  const hasActiveTheme = catalog.some(theme => theme.id === activeThemeId);

  return {
    activeThemeId: hasActiveTheme ? activeThemeId : DEFAULT_THEME_ID,
    customThemes,
  };
}

export function themeSettingsFromPreferences(preferences: unknown): ThemeSettings {
  if (!isRecord(preferences)) {
    return getDefaultThemeSettings();
  }

  if (isRecord(preferences.themeSettings)) {
    return normalizeThemeSettings(preferences.themeSettings);
  }

  if (typeof preferences.theme === 'string') {
    const themeId = preferences.theme === 'system' ? preferredSystemTheme() : normalizeThemeId(preferences.theme);
    return {
      activeThemeId: themeId || DEFAULT_THEME_ID,
      customThemes: [],
    };
  }

  return getDefaultThemeSettings();
}

export function serializeThemeSettings(themeSettings: ThemeSettings) {
  return JSON.stringify(normalizeThemeSettings(themeSettings));
}

export function parseStoredThemeSettings(rawValue: string | null) {
  if (!rawValue) {
    return getDefaultThemeSettings();
  }

  try {
    return normalizeThemeSettings(JSON.parse(rawValue));
  } catch {
    return getDefaultThemeSettings();
  }
}

export function parseThemeImportPayload(rawValue: string, existingCustomThemes: AppTheme[]) {
  const parsedValue = JSON.parse(rawValue) as unknown;
  const nextCustomThemes = [...normalizeCustomThemes(existingCustomThemes)];
  const usedIds = new Set(getThemeCatalog(nextCustomThemes).map(theme => theme.id));
  const importedThemes: AppTheme[] = [];

  if (isRecord(parsedValue) && Array.isArray(parsedValue.themes)) {
    for (const theme of normalizeThemeCollection(parsedValue.themes, false)) {
      const normalizedTheme = ensureUniqueCustomThemeId(theme, usedIds);
      nextCustomThemes.push(normalizedTheme);
      importedThemes.push(normalizedTheme);
    }

    const importedActiveThemeId =
      typeof parsedValue.activeThemeId === 'string' ? normalizeThemeId(parsedValue.activeThemeId) : undefined;

    return {
      activeThemeId:
        importedActiveThemeId && importedThemes.some(theme => theme.id === importedActiveThemeId)
          ? importedActiveThemeId
          : importedThemes[0]?.id,
      customThemes: nextCustomThemes,
      importedThemes,
    };
  }

  const singleTheme = normalizeTheme(parsedValue, false);
  if (!singleTheme) {
    throw new Error('Invalid theme JSON. Expected a theme object or { themes: [...] }.');
  }

  const normalizedTheme = ensureUniqueCustomThemeId(singleTheme, usedIds);
  nextCustomThemes.push(normalizedTheme);

  return {
    activeThemeId: normalizedTheme.id,
    customThemes: nextCustomThemes,
    importedThemes: [normalizedTheme],
  };
}

export function buildThemeExportPayload(themeSettings: ThemeSettings): ThemeImportPayload {
  const normalizedThemeSettings = normalizeThemeSettings(themeSettings);
  const activeTheme = normalizedThemeSettings.customThemes.find(
    theme => theme.id === normalizedThemeSettings.activeThemeId,
  );

  return {
    version: 1,
    themes: normalizedThemeSettings.customThemes.map(theme => ({ ...theme, builtin: undefined })),
    activeThemeId: activeTheme?.id,
  };
}

export function createPreferencePayload(themeSettings: ThemeSettings) {
  const normalizedThemeSettings = normalizeThemeSettings(themeSettings);

  return {
    theme: normalizedThemeSettings.activeThemeId,
    themeSettings: normalizedThemeSettings,
  };
}