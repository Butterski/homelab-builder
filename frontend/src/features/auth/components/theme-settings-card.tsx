import { useRef, useState, type ChangeEvent } from 'react';
import { Download, Palette, Trash2, Upload } from 'lucide-react';
import { toast } from 'sonner';

import { useTheme } from '@/components/theme-provider';
import { Badge } from '@/components/ui/badge';
import { Button } from '@/components/ui/button';
import { Card, CardContent, CardDescription, CardHeader, CardTitle } from '@/components/ui/card';
import {
  Select,
  SelectContent,
  SelectItem,
  SelectTrigger,
  SelectValue,
} from '@/components/ui/select';
import { cn } from '@/lib/utils';
import { useAuth } from '@/features/admin/hooks/use-auth';
import {
  type AppTheme,
  type ThemeSettings,
  DEFAULT_THEME_ID,
  buildThemeExportPayload,
  normalizeThemeSettings,
  parseThemeImportPayload,
} from '@/lib/theme-registry';

function downloadThemeFile(fileName: string, payload: unknown) {
  const blob = new Blob([JSON.stringify(payload, null, 2)], { type: 'application/json' });
  const url = URL.createObjectURL(blob);
  const link = document.createElement('a');

  link.href = url;
  link.download = fileName;
  document.body.appendChild(link);
  link.click();
  document.body.removeChild(link);
  URL.revokeObjectURL(url);
}

function exportableTheme(theme: AppTheme) {
  return {
    id: theme.id,
    name: theme.name,
    description: theme.description,
    mode: theme.mode,
    tokens: theme.tokens,
  };
}

export function ThemeSettingsCard() {
  const fileInputRef = useRef<HTMLInputElement | null>(null);
  const { updateThemeSettings } = useAuth();
  const { activeTheme, activeThemeId, replaceThemeSettings, themeSettings, themes } = useTheme();
  const [isSaving, setIsSaving] = useState(false);

  async function persistThemeSettings(nextThemeSettings: ThemeSettings, successMessage?: string) {
    const normalizedSettings = normalizeThemeSettings(nextThemeSettings);
    replaceThemeSettings(normalizedSettings);
    setIsSaving(true);

    try {
      await updateThemeSettings(normalizedSettings);
      if (successMessage) {
        toast.success(successMessage);
      }
    } catch {
      toast.error('Failed to save theme settings.');
    } finally {
      setIsSaving(false);
    }
  }

  async function handleThemeChange(themeId: string) {
    await persistThemeSettings({
      ...themeSettings,
      activeThemeId: themeId,
    });
  }

  async function handleDeleteTheme(themeId: string) {
    const nextThemeSettings = normalizeThemeSettings({
      activeThemeId: activeThemeId === themeId ? DEFAULT_THEME_ID : activeThemeId,
      customThemes: themeSettings.customThemes.filter(theme => theme.id !== themeId),
    });

    await persistThemeSettings(nextThemeSettings, 'Custom theme removed.');
  }

  async function handleImportFile(file: File) {
    try {
      const payload = await file.text();
      const importResult = parseThemeImportPayload(payload, themeSettings.customThemes);
      const nextThemeSettings = normalizeThemeSettings({
        activeThemeId: importResult.activeThemeId ?? activeThemeId,
        customThemes: importResult.customThemes,
      });

      await persistThemeSettings(
        nextThemeSettings,
        `Imported ${importResult.importedThemes.length} theme${importResult.importedThemes.length === 1 ? '' : 's'}.`,
      );
    } catch (error) {
      toast.error(error instanceof Error ? error.message : 'Failed to import theme file.');
    }
  }

  function handleFileSelection(event: ChangeEvent<HTMLInputElement>) {
    const file = event.target.files?.[0];
    if (!file) {
      return;
    }

    void handleImportFile(file);
    event.target.value = '';
  }

  function handleExportActiveTheme() {
    downloadThemeFile(`${activeTheme.id}.theme.json`, exportableTheme(activeTheme));
    toast.success(`Exported ${activeTheme.name}.`);
  }

  function handleExportThemePack() {
    downloadThemeFile('hlbuilder-theme-pack.json', buildThemeExportPayload(themeSettings));
    toast.success('Theme pack exported.');
  }

  return (
    <Card>
      <CardHeader>
        <div className="flex items-start justify-between gap-4">
          <div>
            <CardTitle className="flex items-center gap-2 text-base">
              <Palette className="h-4 w-4" />
              Appearance
            </CardTitle>
            <CardDescription className="mt-1">
              Themes are stored in your backend preferences, can be exported as JSON, and can be imported back or shared with others.
            </CardDescription>
          </div>
          <Badge variant="secondary" className="uppercase">
            {activeTheme.mode}
          </Badge>
        </div>
      </CardHeader>
      <CardContent className="space-y-6">
        <div className="space-y-2">
          <p className="text-sm font-medium">Active Theme</p>
          <Select disabled={isSaving} value={activeThemeId} onValueChange={value => void handleThemeChange(value)}>
            <SelectTrigger className="w-full sm:w-[320px]">
              <SelectValue placeholder="Choose a theme" />
            </SelectTrigger>
            <SelectContent>
              {themes.map(theme => (
                <SelectItem key={theme.id} value={theme.id}>
                  {theme.name}
                </SelectItem>
              ))}
            </SelectContent>
          </Select>
        </div>

        <div className="grid gap-3 md:grid-cols-2 xl:grid-cols-3">
          {themes.map(theme => {
            const isActive = theme.id === activeThemeId;

            return (
              <div
                key={theme.id}
                role="button"
                tabIndex={0}
                onClick={() => void handleThemeChange(theme.id)}
                onKeyDown={event => {
                  if (event.key === 'Enter' || event.key === ' ') {
                    event.preventDefault();
                    void handleThemeChange(theme.id);
                  }
                }}
                className={cn(
                  'rounded-xl border p-4 text-left transition-colors hover:bg-accent/30',
                  isSaving && 'pointer-events-none opacity-70',
                  isActive ? 'border-primary bg-accent/40' : 'border-border bg-card',
                )}
              >
                <div className="flex items-start justify-between gap-3">
                  <div>
                    <p className="font-medium">{theme.name}</p>
                    <p className="mt-1 text-xs text-muted-foreground">
                      {theme.description ?? 'Custom imported theme'}
                    </p>
                  </div>
                  <div className="flex items-center gap-2">
                    <Badge variant={theme.builtin ? 'outline' : 'secondary'}>
                      {theme.builtin ? 'preset' : 'custom'}
                    </Badge>
                    {!theme.builtin && (
                      <button
                        type="button"
                        className="rounded-md p-1 text-muted-foreground transition-colors hover:bg-accent hover:text-foreground"
                        onClick={event => {
                          event.stopPropagation();
                          void handleDeleteTheme(theme.id);
                        }}
                        aria-label={`Delete ${theme.name}`}
                      >
                        <Trash2 className="h-4 w-4" />
                      </button>
                    )}
                  </div>
                </div>
                <div className="mt-4 flex gap-2">
                  <span className="h-8 flex-1 rounded-md border" style={{ backgroundColor: theme.tokens.background }} />
                  <span className="h-8 flex-1 rounded-md border" style={{ backgroundColor: theme.tokens.card }} />
                  <span className="h-8 flex-1 rounded-md border" style={{ backgroundColor: theme.tokens.primary }} />
                  <span className="h-8 flex-1 rounded-md border" style={{ backgroundColor: theme.tokens.accent }} />
                </div>
              </div>
            );
          })}
        </div>

        <div className="flex flex-wrap gap-3">
          <input
            ref={fileInputRef}
            type="file"
            accept="application/json,.json"
            className="hidden"
            onChange={handleFileSelection}
          />
          <Button variant="outline" disabled={isSaving} onClick={() => fileInputRef.current?.click()}>
            <Upload className="h-4 w-4" />
            Import Theme JSON
          </Button>
          <Button variant="outline" disabled={isSaving} onClick={handleExportActiveTheme}>
            <Download className="h-4 w-4" />
            Export Active Theme
          </Button>
          <Button
            variant="outline"
            disabled={isSaving || themeSettings.customThemes.length === 0}
            onClick={handleExportThemePack}
          >
            <Download className="h-4 w-4" />
            Export Theme Pack
          </Button>
        </div>

        <div className="rounded-xl border border-dashed border-border bg-muted/30 p-4 text-sm text-muted-foreground">
          Edit an exported JSON file, then import it here. Any imported custom themes are saved into your account preferences and follow you across devices.
        </div>
      </CardContent>
    </Card>
  );
}