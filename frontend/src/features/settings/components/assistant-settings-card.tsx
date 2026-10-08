import { useState, type FormEvent } from 'react';
import { useMutation } from '@tanstack/react-query';
import { ExternalLink, Loader2, PlugZap, Save, Sparkles } from 'lucide-react';
import { toast } from 'sonner';
import { Button } from '@/components/ui/button';
import { Card, CardContent, CardDescription, CardHeader, CardTitle } from '@/components/ui/card';
import { Input } from '@/components/ui/input';
import { Label } from '@/components/ui/label';
import {
  Select,
  SelectContent,
  SelectItem,
  SelectTrigger,
  SelectValue,
} from '@/components/ui/select';
import { Switch } from '@/components/ui/switch';
import { errorMessage } from '@/lib/utils';
import {
  assistantSettingsApi,
  useAssistantSettings,
  useDeleteAssistantKey,
  useUpdateAssistantSettings,
  type AssistantSettings,
  type AssistantSettingsUpdate,
  type ProviderPreset,
  type ProviderTestResult,
} from '../api/assistant-settings';
import { KeyProtectionPanel } from './key-protection-panel';

type Draft = { provider?: string; model?: string; baseUrl?: string; apiKey?: string };

/** The address a preset suggests, when this instance is allowed to call it. */
function suggestedBaseUrl(preset: ProviderPreset | undefined, allowPrivate: boolean): string {
  if (!preset?.custom_base_url || !preset.base_url) return '';
  return allowPrivate || preset.base_url.startsWith('https://') ? preset.base_url : '';
}

function missingSetup(settings: AssistantSettings, preset: ProviderPreset | undefined): string {
  if (!preset) return 'Choose a provider below.';
  if (settings.has_key && !settings.key_usable) {
    return 'The stored key can no longer be read. Enter it again below.';
  }
  if (preset.key_required && !settings.has_key) return 'Enter an API key below.';
  if (preset.custom_base_url && !settings.base_url) return 'Enter the endpoint address below.';
  if (!settings.model) return 'Choose a model below.';
  return 'Finish the setup below.';
}

function statusText(settings: AssistantSettings, preset: ProviderPreset | undefined): string {
  if (!settings.enabled) return 'Off. The Assistant button is hidden in the builder.';
  if (settings.ready) return 'Ready. Open a build and click Assistant in the toolbar.';
  return `On, but not ready yet. ${missingSetup(settings, preset)}`;
}

function AssistantSettingsForm({ settings }: { settings: AssistantSettings }) {
  const toggle = useUpdateAssistantSettings();
  const save = useUpdateAssistantSettings();
  const deleteKey = useDeleteAssistantKey();
  const test = useMutation({ mutationFn: assistantSettingsApi.test });

  // Only what the user changed is kept here; everything else follows the saved settings.
  const [draft, setDraft] = useState<Draft>({});
  const [check, setCheck] = useState<{ destination: string; result: ProviderTestResult } | null>(
    null,
  );

  const form = {
    provider: draft.provider ?? settings.provider,
    model: draft.model ?? settings.model,
    baseUrl: draft.baseUrl ?? settings.base_url,
    apiKey: draft.apiKey ?? '',
  };
  const savedPreset = settings.providers.find(preset => preset.id === settings.provider);
  const preset = settings.providers.find(candidate => candidate.id === form.provider);
  const model = form.model.trim();
  const baseUrl = preset?.custom_base_url ? form.baseUrl.trim() : '';
  const apiKey = form.apiKey.trim();

  const providerChanged = form.provider !== settings.provider;
  const destinationChanged = providerChanged || baseUrl !== settings.base_url;
  const dirty = destinationChanged || model !== settings.model || apiKey !== '';
  const keyWillBeRemoved = settings.has_key && destinationChanged && apiKey === '';

  const destination = `${settings.provider}|${settings.base_url}`;
  const shownCheck =
    check && check.destination === destination && !providerChanged ? check.result : null;
  const models = shownCheck?.ok ? shownCheck.models : [];

  const chooseProvider = (id: string) => {
    if (id === settings.provider) {
      setDraft(current => ({ apiKey: current.apiKey }));
      return;
    }
    const next = settings.providers.find(candidate => candidate.id === id);
    setDraft(current => ({
      apiKey: current.apiKey,
      provider: id,
      model: next?.default_model ?? '',
      baseUrl: suggestedBaseUrl(next, settings.allow_private_endpoints),
    }));
  };

  const checkConnection = async (target: string) => {
    try {
      const result = await test.mutateAsync();
      setCheck({ destination: target, result });
    } catch (error) {
      setCheck({
        destination: target,
        result: { ok: false, models: [], error: errorMessage(error, 'Could not reach the provider.') },
      });
    }
  };

  const submit = async (event: FormEvent) => {
    event.preventDefault();
    const changes: AssistantSettingsUpdate = {};
    if (providerChanged) changes.provider = form.provider;
    if (preset?.custom_base_url && destinationChanged) changes.base_url = baseUrl;
    if (providerChanged || model !== settings.model) changes.model = model;
    if (apiKey) changes.api_key = apiKey;
    try {
      const saved = await save.mutateAsync(changes);
      // Clearing the draft also empties the key field: the key is not kept in the page.
      setDraft({});
      toast.success('Assistant settings saved.');
      const keyless = saved.providers.find(p => p.id === saved.provider)?.key_required === false;
      if ((changes.api_key || destinationChanged) && (saved.key_usable || keyless)) {
        void checkConnection(`${saved.provider}|${saved.base_url}`);
      }
    } catch (error) {
      toast.error(errorMessage(error, 'Could not save the assistant settings.'));
    }
  };

  const setEnabled = async (enabled: boolean) => {
    try {
      await toggle.mutateAsync({ enabled });
    } catch (error) {
      toast.error(errorMessage(error, 'Could not change the assistant setting.'));
    }
  };

  const removeKey = async () => {
    try {
      await deleteKey.mutateAsync();
      toast.success('The stored key was deleted.');
    } catch (error) {
      toast.error(errorMessage(error, 'Could not delete the key.'));
    }
  };

  const canCheck =
    !dirty && !!savedPreset && (settings.key_usable || !savedPreset.key_required) && !test.isPending;

  return (
    <>
      <div className="flex items-center justify-between gap-4 rounded-md border px-3 py-3">
        <div className="space-y-0.5">
          <Label htmlFor="assistant-enabled">Show the assistant in the builder</Label>
          <p className="text-xs text-muted-foreground" data-testid="assistant-status">
            {statusText(settings, savedPreset)}
          </p>
        </div>
        <Switch
          id="assistant-enabled"
          checked={settings.enabled}
          disabled={toggle.isPending}
          onCheckedChange={checked => void setEnabled(checked)}
        />
      </div>

      <form onSubmit={event => void submit(event)} className="space-y-4">
        <div className="space-y-2">
          <Label htmlFor="assistant-provider">Provider</Label>
          <Select value={form.provider} onValueChange={chooseProvider}>
            <SelectTrigger id="assistant-provider" className="w-full">
              <SelectValue placeholder="Choose a provider" />
            </SelectTrigger>
            <SelectContent>
              {settings.providers.map(option => (
                <SelectItem key={option.id} value={option.id}>
                  {option.label}
                </SelectItem>
              ))}
            </SelectContent>
          </Select>
          {preset?.note && <p className="text-xs text-muted-foreground">{preset.note}</p>}
        </div>

        {preset?.custom_base_url && (
          <div className="space-y-2">
            <Label htmlFor="assistant-base-url">Endpoint address</Label>
            <Input
              id="assistant-base-url"
              value={form.baseUrl}
              onChange={event => setDraft(current => ({ ...current, baseUrl: event.target.value }))}
              placeholder={preset.base_url || 'https://llm.example.com/v1'}
              spellCheck={false}
              autoComplete="off"
            />
            <p className="text-xs text-muted-foreground">
              {settings.allow_private_endpoints
                ? 'The HLBuilder server calls this address, so it must be reachable from the server, not only from your browser.'
                : 'This instance only calls public https addresses. Private and local network addresses are refused.'}
            </p>
          </div>
        )}

        {preset && (
          <div className="space-y-2">
            <div className="flex items-center justify-between gap-2">
              <Label htmlFor="assistant-api-key">
                API key{preset.key_required ? '' : ' (optional)'}
              </Label>
              {preset.key_help_url && (
                <a
                  href={preset.key_help_url}
                  target="_blank"
                  rel="noreferrer"
                  className="inline-flex items-center gap-1 text-xs text-primary underline-offset-4 hover:underline"
                >
                  Get a key
                  <ExternalLink className="size-3" aria-hidden="true" />
                </a>
              )}
            </div>
            <Input
              id="assistant-api-key"
              type="password"
              value={form.apiKey}
              onChange={event => setDraft(current => ({ ...current, apiKey: event.target.value }))}
              placeholder={
                settings.has_key && !providerChanged
                  ? 'Type a new key to replace the stored one'
                  : 'Paste your API key'
              }
              spellCheck={false}
              autoComplete="new-password"
              maxLength={500}
            />
            <p className="text-xs text-muted-foreground" data-testid="assistant-key-state">
              {keyWillBeRemoved
                ? 'Saving a different provider or address deletes the stored key. Enter the key for the new one.'
                : settings.has_key
                  ? `A key is stored encrypted${settings.key_hint ? ` (ends in ${settings.key_hint})` : ''}. It cannot be shown again, only replaced or deleted.`
                  : 'No key is stored. It is encrypted before it is saved and never sent back to this page.'}
            </p>
          </div>
        )}

        {preset && (
          <div className="space-y-2">
            <Label htmlFor="assistant-model">Model</Label>
            <Input
              id="assistant-model"
              value={form.model}
              onChange={event => setDraft(current => ({ ...current, model: event.target.value }))}
              placeholder={preset.default_model || 'Model name'}
              list="assistant-model-options"
              spellCheck={false}
              autoComplete="off"
              maxLength={200}
            />
            <datalist id="assistant-model-options">
              {models.map(name => (
                <option key={name} value={name} />
              ))}
            </datalist>
            <p className="text-xs text-muted-foreground">
              Use a model that supports tool calling. Check the connection to list the models your
              key can use.
            </p>
          </div>
        )}

        <div className="flex flex-wrap items-center gap-2">
          <Button type="submit" size="sm" disabled={!dirty || !preset || save.isPending}>
            {save.isPending ? <Loader2 className="animate-spin" /> : <Save />}
            Save
          </Button>
          <Button
            type="button"
            size="sm"
            variant="outline"
            disabled={!canCheck}
            title={dirty ? 'Save your changes first' : undefined}
            onClick={() => void checkConnection(destination)}
          >
            {test.isPending ? <Loader2 className="animate-spin" /> : <PlugZap />}
            Check connection
          </Button>
          {dirty && (
            <Button type="button" size="sm" variant="ghost" onClick={() => setDraft({})}>
              Discard changes
            </Button>
          )}
        </div>

        {shownCheck &&
          (shownCheck.ok ? (
            <p className="text-sm text-emerald-600 dark:text-emerald-400" role="status">
              {shownCheck.models.length > 0
                ? `Connection works. ${shownCheck.models.length} models are available in the Model field.`
                : 'Connection works. The provider did not list its models, so type the model name.'}
            </p>
          ) : (
            <p className="text-sm text-destructive" role="alert">
              {shownCheck.error || 'The provider did not accept the request.'}
            </p>
          ))}
      </form>

      <section className="space-y-2 text-sm">
        <h3 className="font-medium">What the provider receives</h3>
        <ul className="list-disc space-y-1 pl-5 text-muted-foreground">
          <li>Your chat messages and the assistant&apos;s replies.</li>
          <li>
            The build you have open, as the assistant reads it: device names, types and specs, IP
            addresses, connections, VMs and services.
          </li>
          <li>
            Hardware and service catalog entries it looks up. Nothing from your other builds, and
            not your email or login.
          </li>
        </ul>
        <p className="text-xs text-muted-foreground">
          HLBuilder has no model or key of its own. Every request goes to the provider you chose
          and is billed to your account there. The assistant can only propose changes; you apply
          or reject each one in the builder.
        </p>
      </section>

      <KeyProtectionPanel
        settings={settings}
        deleting={deleteKey.isPending}
        onDeleteKey={() => void removeKey()}
      />
    </>
  );
}

/** Settings card for the in-app assistant: on/off, provider, model and the user's own key. */
export function AssistantSettingsCard() {
  const { data: settings, isLoading, isError } = useAssistantSettings();
  const deleteKey = useDeleteAssistantKey();

  const removeKey = async () => {
    try {
      await deleteKey.mutateAsync();
      toast.success('The stored key was deleted.');
    } catch (error) {
      toast.error(errorMessage(error, 'Could not delete the key.'));
    }
  };

  return (
    <Card id="assistant">
      <CardHeader>
        <CardTitle className="flex items-center gap-2 text-base">
          <Sparkles className="size-4 text-primary" aria-hidden="true" />
          AI assistant
        </CardTitle>
        <CardDescription>
          A chat panel in the builder that can read the open build and propose changes to it. It
          is off until you turn it on, and it uses your own account with a model provider.
        </CardDescription>
      </CardHeader>
      <CardContent className="space-y-6">
        {isLoading && <p className="text-sm text-muted-foreground">Loading assistant settings…</p>}
        {isError && (
          <p className="text-sm text-destructive">Could not load the assistant settings.</p>
        )}
        {settings && !settings.available && (
          <>
            <p className="rounded-md border border-amber-500/40 bg-amber-500/10 px-3 py-2 text-sm">
              The assistant is turned off on this instance. An administrator can enable it with{' '}
              <code className="font-mono text-xs">ASSISTANT_ENABLED=true</code>; a public instance
              also needs <code className="font-mono text-xs">SECRETS_KEY</code> to encrypt stored
              keys.
            </p>
            {settings.has_key && (
              <KeyProtectionPanel
                settings={settings}
                deleting={deleteKey.isPending}
                onDeleteKey={() => void removeKey()}
              />
            )}
          </>
        )}
        {settings?.available && <AssistantSettingsForm settings={settings} />}
      </CardContent>
    </Card>
  );
}
