import { describe, expect, it, vi, beforeEach, afterEach } from 'vitest';

import { api } from './api';
import type { ThemeSettings } from './theme-registry';

const sampleThemeSettings: ThemeSettings = {
  activeThemeId: 'midnight-lab',
  customThemes: [
    {
      id: 'midnight-lab',
      name: 'Midnight Lab',
      mode: 'dark',
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
    },
  ],
};

describe('theme API endpoints', () => {
  const fetchMock = vi.fn();

  beforeEach(() => {
    vi.stubGlobal('fetch', fetchMock);
    localStorage.setItem('auth_token', 'test-token');
  });

  afterEach(() => {
    vi.unstubAllGlobals();
    localStorage.clear();
    vi.clearAllMocks();
  });

  it('calls GET /auth/themes with bearer token', async () => {
    fetchMock.mockResolvedValueOnce({
      ok: true,
      status: 200,
      json: async () => sampleThemeSettings,
    });

    const result = await api.getThemeSettings();

    expect(result.activeThemeId).toBe('midnight-lab');
    expect(fetchMock).toHaveBeenCalledWith(
      expect.stringMatching(/\/auth\/themes$/),
      expect.objectContaining({
        method: 'GET',
        headers: expect.objectContaining({
          Authorization: 'Bearer test-token',
        }),
      }),
    );
  });

  it('calls PUT /auth/themes with the theme settings payload', async () => {
    fetchMock.mockResolvedValueOnce({
      ok: true,
      status: 200,
      json: async () => sampleThemeSettings,
    });

    await api.updateThemeSettings(sampleThemeSettings);

    expect(fetchMock).toHaveBeenCalledWith(
      expect.stringMatching(/\/auth\/themes$/),
      expect.objectContaining({
        method: 'PUT',
        body: JSON.stringify(sampleThemeSettings),
      }),
    );
  });
});