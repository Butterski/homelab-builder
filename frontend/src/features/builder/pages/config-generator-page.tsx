import { useReducer, useMemo, useEffect, useEffectEvent, useState } from 'react';
import { Link } from 'react-router-dom';
import { useBuilderStore } from '../store/builder-store';
import { buildApi, type Build, type ConfigBundle } from '../api/builds';
import { gameServersContent } from '../../gaming/lib/game-compose';
import {
  generateAnsiblePlaybook,
  generateTraefikLabels,
  generateIpPlan,
} from '../lib/config-generator';
import { Page, PageHeader } from '../../../components/layout/page';
import { Button } from '../../../components/ui/button';
import { Input } from '../../../components/ui/input';
import { ChevronDown } from 'lucide-react';
import { toast } from 'sonner';

type Tab =
  | 'docker-compose'
  | 'env'
  | 'ansible-inventory'
  | 'ansible-playbook'
  | 'nginx'
  | 'traefik'
  | 'ip-plan'
  | 'game-servers';

const TABS: { id: Tab; label: string; ext: string }[] = [
  { id: 'docker-compose', label: 'Docker Compose', ext: 'docker-compose.yml' },
  { id: 'env', label: '.env', ext: '.env' },
  { id: 'ansible-inventory', label: 'Ansible Inventory', ext: 'inventory.ini' },
  { id: 'ansible-playbook', label: 'Ansible Playbook', ext: 'playbook.yml' },
  { id: 'nginx', label: 'Nginx Config', ext: 'nginx.conf' },
  { id: 'traefik', label: 'Traefik Labels', ext: 'traefik-labels.yml' },
  { id: 'ip-plan', label: 'IP Address Plan', ext: 'ip-plan.txt' },
  { id: 'game-servers', label: 'Game Servers', ext: 'game-servers.yml' },
];

// ─── Code Block ───────────────────────────────────────────────────────────────
function CodeBlock({ content, filename }: { content: string; filename: string }) {
  const [copied, setCopied] = useState(false);

  const copy = () => {
    navigator.clipboard.writeText(content);
    setCopied(true);
    setTimeout(() => setCopied(false), 2000);
  };

  const download = () => {
    const blob = new Blob([content], { type: 'text/plain' });
    const url = URL.createObjectURL(blob);
    const a = document.createElement('a');
    a.href = url;
    a.download = filename;
    a.click();
    URL.revokeObjectURL(url);
  };

  return (
    <div className="overflow-hidden rounded-lg border">
      <div className="flex items-center justify-between border-b px-4 py-1.5">
        <span className="font-mono text-xs text-muted-foreground">{filename}</span>
        <div className="flex gap-1">
          <Button size="sm" variant="ghost" className="h-7 px-2 text-xs" onClick={copy}>
            {copied ? 'Copied' : 'Copy'}
          </Button>
          <Button size="sm" variant="ghost" className="h-7 px-2 text-xs" onClick={download}>
            Download
          </Button>
        </div>
      </div>
      <pre className="max-h-125 overflow-auto bg-muted/50 p-4 font-mono text-xs leading-relaxed text-foreground">
        <code>{content}</code>
      </pre>
    </div>
  );
}

// ─── Sub-Components ─────────────────────────────────────────────────────────────

function StatsBar({
  servicesCount,
  hardwareNodesCount,
}: {
  servicesCount: number;
  hardwareNodesCount: number;
}) {
  return (
    <dl className="flex flex-wrap gap-x-10 gap-y-2 border-b pb-4 text-sm">
      <div>
        <dt className="text-muted-foreground">Containers and VMs</dt>
        <dd className="app-figure text-lg">{servicesCount}</dd>
      </div>
      <div>
        <dt className="text-muted-foreground">Hardware nodes</dt>
        <dd className="app-figure text-lg">{hardwareNodesCount}</dd>
      </div>
    </dl>
  );
}

function SettingsPanel({
  showSettings,
  labName,
  domain,
  onToggle,
  onLabNameChange,
  onDomainChange,
}: {
  showSettings: boolean;
  labName: string;
  domain: string;
  onToggle: () => void;
  onLabNameChange: (value: string) => void;
  onDomainChange: (value: string) => void;
}) {
  return (
    <div className="overflow-hidden rounded-lg border">
      <button
        type="button"
        aria-expanded={showSettings}
        className="flex w-full items-center justify-between px-4 py-2.5 text-sm font-medium transition-colors hover:cursor-pointer hover:bg-muted/50"
        onClick={onToggle}
      >
        <span>Generator settings</span>
        {showSettings ? (
          <ChevronDown className="size-4 hover:cursor-pointer rotate-180 transition-transform duration-200" />
        ) : (
          <ChevronDown className="size-4 hover:cursor-pointer transition-transform duration-200" />
        )}
      </button>
      <div
        className="grid transition-all duration-300 ease-in-out"
        style={{ gridTemplateRows: showSettings ? '1fr' : '0fr' }}
      >
        <div className="overflow-hidden">
          <div className="border-t p-4 space-y-4">
            {/* Row 1: general */}
            <div className="grid grid-cols-1 sm:grid-cols-2 gap-4">
              <div>
                <label
                  htmlFor="lab-name"
                  className="text-xs font-medium text-muted-foreground mb-1.5 block "
                >
                  Lab Name
                </label>
                <Input
                  id="lab-name"
                  value={labName}
                  onChange={e => onLabNameChange(e.target.value)}
                  placeholder="my-homelab"
                  className="h-8 text-sm"
                />
                <p className="text-xs text-muted-foreground mt-1">Used for export filename</p>
              </div>
              <div>
                <label
                  htmlFor="domain"
                  className="text-xs font-medium text-muted-foreground mb-1.5 block"
                >
                  Domain
                </label>
                <Input
                  id="domain"
                  value={domain}
                  onChange={e => onDomainChange(e.target.value)}
                  placeholder="homelab.local"
                  className="h-8 text-sm"
                />
                <p className="text-xs text-muted-foreground mt-1">Used in Nginx/Traefik configs</p>
              </div>
            </div>
          </div>
        </div>
      </div>
    </div>
  );
}

// ─── Main Page ────────────────────────────────────────────────────────────────

interface ConfigState {
  activeTab: Tab;
  domain: string;
  labName: string;
  showSettings: boolean;
  builds: { id: string; name: string }[];
  selectedBuildId: string;
  loadingBuild: boolean;
  configBundle: ConfigBundle | null;
  loadingCompose: boolean;
}

export default function ConfigGeneratorPage() {
  const hardwareNodes = useBuilderStore(state => state.hardwareNodes);
  const openBuild = useBuilderStore(state => state.openBuild);
  const clearCurrentBuild = useBuilderStore(state => state.clearCurrentBuild);

  const [state, dispatch] = useReducer(
    (state: ConfigState, newState: Partial<ConfigState>) => ({ ...state, ...newState }),
    {
      activeTab: 'docker-compose',
      domain: 'homelab.local',
      labName: 'my-homelab',
      showSettings: false,
      builds: [],
      selectedBuildId: '',
      loadingBuild: false,
      configBundle: null,
      loadingCompose: false,
    },
  );
  const [downloadingBundle, setDownloadingBundle] = useState(false);

  const {
    activeTab,
    domain,
    labName,
    showSettings,
    builds,
    selectedBuildId,
    loadingBuild,
    configBundle,
    loadingCompose,
  } = state;

  // Load config bundle from backend
  const loadConfigBundle = async (id: string) => {
    dispatch({ loadingCompose: true });
    try {
      const res = await buildApi.generateConfig(id);
      dispatch({ configBundle: res });
    } catch (err) {
      console.error('Failed to generate compose', err);
      dispatch({ configBundle: null });
    } finally {
      dispatch({ loadingCompose: false });
    }
  };

  const downloadCompleteBundle = async () => {
    if (!selectedBuildId) {
      toast.error('Select a project first.');
      return;
    }
    setDownloadingBundle(true);
    try {
      const { blob, filename } = await buildApi.downloadExportBundle(selectedBuildId);
      const url = URL.createObjectURL(blob);
      const anchor = document.createElement('a');
      anchor.href = url;
      anchor.download = filename;
      anchor.click();
      URL.revokeObjectURL(url);
      toast.success('Complete export bundle downloaded.');
    } catch (error) {
      console.error('Complete export failed', error);
      toast.error('Could not generate the complete export bundle.');
    } finally {
      setDownloadingBundle(false);
    }
  };

  // Opens a project here. It goes through the store's queue, so a save that is
  // still on its way from the builder lands before the configs are generated.
  const handleSelectBuild = async (id: string, announce = true) => {
    if (!id) return;
    dispatch({ loadingBuild: true, selectedBuildId: id });
    try {
      await openBuild(id);
      const name = useBuilderStore.getState().projectName;
      dispatch({ labName: name.toLowerCase().replace(/[^a-z0-9]/g, '-') });
      if (announce) toast.success(`Loaded project: ${name}`);
      await loadConfigBundle(id);
    } catch (e) {
      console.error('[ConfigGen] Failed to load build', e);
      toast.error('Failed to load project - it may have been deleted');
      clearCurrentBuild();
      dispatch({ selectedBuildId: '', configBundle: null });
    } finally {
      dispatch({ loadingBuild: false });
    }
  };

  // The page follows the project that is open. It never opens one by itself:
  // which project is "current" is the user's choice.
  const followOpenProject = useEffectEvent((list: Build[]) => {
    dispatch({ builds: list.map(b => ({ id: b.id, name: b.name })) });
    const current = useBuilderStore.getState().currentBuildId;
    if (current && list.some(build => build.id === current)) {
      void handleSelectBuild(current, false);
    } else if (current) {
      // It was deleted elsewhere.
      clearCurrentBuild();
    }
  });
  useEffect(() => {
    buildApi
      .list()
      .then(list => followOpenProject(list))
      .catch(err => console.error('Failed to list builds', err));
  }, []);

  // The web services placed on the canvas. Game servers are not web apps:
  // they have their own tab and no proxy labels.
  const allServices = useMemo(
    () =>
      hardwareNodes.flatMap(node =>
        (node.vms ?? []).filter(
          vm => !vm.details?.game && (vm.type === 'container' || vm.type === 'vm'),
        ),
      ),
    [hardwareNodes],
  );

  const hasContent = allServices.length > 0 || hardwareNodes.length > 0;

  function getContent(tab: Tab): string {
    const fallbacks = {
      'docker-compose': '# No containers deployed.',
      env: '# No environment variables required.',
      'ansible-inventory': '# No hardware added.',
      nginx: '# Nginx not required.',
    };

    if (loadingCompose) return '# Generating from backend...';

    switch (tab) {
      case 'docker-compose':
        return configBundle?.docker_compose || fallbacks['docker-compose'];
      case 'env':
        return configBundle?.env || fallbacks['env'];
      case 'ansible-inventory':
        return configBundle?.ansible_inventory || fallbacks['ansible-inventory'];
      case 'ansible-playbook':
        return generateAnsiblePlaybook(allServices);
      case 'nginx':
        return configBundle?.nginx || fallbacks['nginx'];
      case 'traefik':
        return generateTraefikLabels(allServices, domain);
      case 'ip-plan':
        return generateIpPlan(hardwareNodes);
      case 'game-servers':
        return gameServersContent(configBundle?.game_compose);
    }
  }

  // The game server tab only appears for builds that have game servers.
  const hasGameServers = (configBundle?.game_compose?.length ?? 0) > 0;
  const tabs = TABS.filter(tab => tab.id !== 'game-servers' || hasGameServers);
  const activeTabMeta = tabs.find(t => t.id === activeTab) ?? tabs[0];
  const content = getContent(activeTabMeta.id);

  return (
    <Page className="space-y-6">
      <PageHeader
        title="Config Generator"
        lede="Deployment files written from your design on the canvas."
        actions={
          <>
            {loadingBuild && <span className="text-sm text-muted-foreground">Loading&hellip;</span>}
            <select
              aria-label="Project"
              className="h-9 min-w-0 flex-1 rounded-md border border-input bg-background px-3 text-sm focus-visible:outline-none focus-visible:ring-1 focus-visible:ring-ring sm:w-56 sm:flex-none"
              value={selectedBuildId}
              onChange={e => handleSelectBuild(e.target.value)}
            >
              <option value="" disabled>
                Select Project
              </option>
              {builds.map(b => (
                <option key={b.id} value={b.id}>
                  {b.name}
                </option>
              ))}
            </select>
            <Button
              onClick={downloadCompleteBundle}
              disabled={!selectedBuildId || downloadingBundle}
            >
              {downloadingBundle ? 'Building bundle...' : 'Download the complete bundle'}
            </Button>
          </>
        }
      />

      {/* Empty states */}
      {!selectedBuildId && (
        <div className="app-empty-state px-6 py-10">
          <h2 className="font-semibold">Choose a project</h2>
          <p className="mt-1 text-sm text-muted-foreground">
            {builds.length > 0
              ? 'Pick a project above to generate its configs.'
              : 'Create a project first, then come back here to generate its configs.'}
          </p>
          {builds.length === 0 && (
            <Button variant="outline" className="mt-4" asChild>
              <Link to="/">Go to Projects</Link>
            </Button>
          )}
        </div>
      )}
      {selectedBuildId && !hasContent && !loadingBuild && (
        <div className="app-empty-state px-6 py-10">
          <h2 className="font-semibold">No lab design yet</h2>
          <p className="mt-1 max-w-xl text-sm text-muted-foreground">
            Add services and hardware on the canvas, then come back here to generate configs.
          </p>
          <Button variant="outline" className="mt-4" asChild>
            <Link to={`/builder/${selectedBuildId}`}>Open the canvas</Link>
          </Button>
        </div>
      )}

      {hasContent && (
        <>
          {/* Stats bar */}
          <StatsBar servicesCount={allServices.length} hardwareNodesCount={hardwareNodes.length} />

          <SettingsPanel
            showSettings={showSettings}
            labName={labName}
            domain={domain}
            onToggle={() => dispatch({ showSettings: !showSettings })}
            onLabNameChange={value => dispatch({ labName: value })}
            onDomainChange={value => dispatch({ domain: value })}
          />

          {/* IP Zone Legend removed */}

          {/* The files, one tab each */}
          <div
            className="flex gap-x-6 overflow-x-auto border-b text-sm"
            role="tablist"
            aria-label="Files"
          >
            {tabs.map(tab => {
              const selected = activeTabMeta.id === tab.id;
              return (
                <button
                  key={tab.id}
                  type="button"
                  role="tab"
                  aria-selected={selected}
                  onClick={() => dispatch({ activeTab: tab.id })}
                  className={`-mb-px shrink-0 whitespace-nowrap border-b-2 pb-2.5 transition-colors hover:cursor-pointer focus-visible:outline-2 focus-visible:outline-offset-2 focus-visible:outline-ring ${
                    selected
                      ? 'border-foreground font-medium text-foreground'
                      : 'border-transparent text-muted-foreground hover:text-foreground'
                  }`}
                >
                  {tab.label}
                </button>
              );
            })}
          </div>

          {/* Code block */}
          <CodeBlock content={content} filename={activeTabMeta.ext} />

          {/* Download all */}
          <div className="flex items-center justify-between border-t pt-4 flex-wrap gap-3">
            <p className="text-sm text-muted-foreground">
              Download all configs as individual files, or export the full lab design as JSON.
            </p>
            <div className="flex flex-wrap gap-2">
              {tabs.map(tab => (
                <Button
                  key={tab.id}
                  variant="ghost"
                  size="sm"
                  className="text-xs"
                  onClick={() => {
                    const c = getContent(tab.id);
                    const blob = new Blob([c], { type: 'text/plain' });
                    const url = URL.createObjectURL(blob);
                    const a = document.createElement('a');
                    a.href = url;
                    a.download = tab.ext;
                    a.click();
                    URL.revokeObjectURL(url);
                  }}
                >
                  {tab.ext}
                </Button>
              ))}
            </div>
          </div>
        </>
      )}
    </Page>
  );
}
