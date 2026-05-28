import { useReducer, useMemo, useEffect, useState } from 'react';
import { useBuilderStore } from '../store/builder-store';
import { buildApi } from '../api/builds';
import {
  generateAnsiblePlaybook,
  generateTraefikLabels,
  generateIpPlan,
} from '../lib/config-generator';
// allocateIPs removed
import type { IpAllocatorOptions } from '../lib/config-generator'; // Use type from lib
import { Button } from '../../../components/ui/button';
import { Input } from '../../../components/ui/input';
import {
  Download,
  Copy,
  Check,
  FileCode,
  Server,
  Settings,
  Globe,
  Package,
  AlertCircle,
  ChevronDown,
  Network,
  Home,
} from 'lucide-react';
import { Logo } from '../../../components/ui/logo';
import { toast } from 'sonner';

type Tab =
  | 'docker-compose'
  | 'env'
  | 'ansible-inventory'
  | 'ansible-playbook'
  | 'nginx'
  | 'traefik'
  | 'ip-plan';

const TABS: { id: Tab; label: string; icon: React.ElementType; ext: string }[] = [
  { id: 'docker-compose', label: 'Docker Compose', icon: Package, ext: 'docker-compose.yml' },
  { id: 'env', label: '.env', icon: Settings, ext: '.env' },
  { id: 'ansible-inventory', label: 'Ansible Inventory', icon: Server, ext: 'inventory.ini' },
  { id: 'ansible-playbook', label: 'Ansible Playbook', icon: FileCode, ext: 'playbook.yml' },
  { id: 'nginx', label: 'Nginx Config', icon: Globe, ext: 'nginx.conf' },
  { id: 'traefik', label: 'Traefik Labels', icon: Globe, ext: 'traefik-labels.yml' },
  { id: 'ip-plan', label: 'IP Address Plan', icon: Network, ext: 'ip-plan.txt' },
];

// IpLegend removed as it relied on client-side calculation

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
    <div className="rounded-xl border overflow-hidden">
      <div className="flex items-center justify-between px-4 py-2 bg-muted/60 border-b">
        <span className="text-xs font-mono text-muted-foreground">{filename}</span>
        <div className="flex gap-2">
          <Button size="sm" variant="ghost" className="h-7 px-2 text-xs" onClick={copy}>
            {copied ? (
              <Check className="size-3.5 text-green-500" />
            ) : (
              <Copy className="size-3.5" />
            )}
            {copied ? 'Copied!' : 'Copy'}
          </Button>
          <Button size="sm" variant="ghost" className="h-7 px-2 text-xs" onClick={download}>
            <Download className="size-3.5 mr-1" /> Download
          </Button>
        </div>
      </div>
      <pre className="overflow-auto p-4 text-xs font-mono bg-[#0d1117] text-[#e6edf3] max-h-125 leading-relaxed">
        <code>{content}</code>
      </pre>
    </div>
  );
}

// ─── Sub-Components ─────────────────────────────────────────────────────────────

function StatsBar({
  servicesCount,
  hardwareNodesCount,
  ipOpts,
}: {
  servicesCount: number;
  hardwareNodesCount: number;
  ipOpts: IpAllocatorOptions;
}) {
  return (
    <div className="flex flex-wrap gap-3">
      <div className="flex items-center gap-2 rounded-lg border bg-card px-4 py-2 text-sm">
        <Package className="size-4 text-primary" />
        <span className="font-medium">{servicesCount}</span>
        <span className="text-muted-foreground">containers/VMs</span>
      </div>
      <div className="flex items-center gap-2 rounded-lg border bg-card px-4 py-2 text-sm">
        <Server className="size-4 text-primary" />
        <span className="font-medium">{hardwareNodesCount}</span>
        <span className="text-muted-foreground">hardware nodes</span>
      </div>
      <div className="flex items-center gap-2 rounded-lg border bg-card px-4 py-2 text-sm">
        <Network className="size-4 text-primary" />
        <span className="font-medium font-mono">
          {ipOpts.baseIp}/{ipOpts.cidr}
        </span>
        <span className="text-muted-foreground">subnet</span>
      </div>
      {ipOpts.homeRouterMode && (
        <div className="flex items-center gap-2 rounded-lg border border-amber-300/50 bg-amber-500/10 px-4 py-2 text-sm">
          <Home className="size-4 text-amber-500" />
          <span className="text-amber-600 dark:text-amber-400">
            {ipOpts.homeReserve} IPs reserved for home devices
          </span>
        </div>
      )}
    </div>
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
    <div className="rounded-xl border bg-card overflow-hidden">
      <button
        type="button"
        className="w-full flex items-center justify-between px-4 py-3 text-sm font-medium hover:bg-muted/50 transition-colors"
        onClick={onToggle}
      >
        <span className="flex items-center gap-2">
          <Settings className="size-4 text-muted-foreground" />
          Generator Settings
        </span>
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
                <label htmlFor="lab-name" className="text-xs font-medium text-muted-foreground mb-1.5 block ">
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
                <label htmlFor="domain" className="text-xs font-medium text-muted-foreground mb-1.5 block">
                  Domain
                </label>
                <Input
                  id="domain"
                  value={domain}
                  onChange={e => onDomainChange(e.target.value)}
                  placeholder="homelab.local"
                  className="h-8 text-sm"
                />
                <p className="text-xs text-muted-foreground mt-1">
                  Used in Nginx/Traefik configs
                </p>
              </div>
            </div>

            {/* IP settings removed as they are now handled by backend */}
            <div className="text-sm text-muted-foreground italic p-4">
              IP Allocation settings are now managed securely by the backend.
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
  configBundle: {
    docker_compose: string;
    env: string;
    ansible_inventory: string;
    nginx: string;
  } | null;
  loadingCompose: boolean;
}

export default function ConfigGeneratorPage() {
  const { hardwareNodes, loadBuild, clearCurrentBuild } = useBuilderStore();
  
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
    }
  );

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

  const handleSelectBuild = async (id: string) => {
    if (!id) return;
    console.log(`[ConfigGen] Switching to build ID: ${id}`);
    dispatch({ loadingBuild: true, selectedBuildId: id });
    try {
      const fullBuild = await buildApi.get(id);
      console.log(`[ConfigGen] Fetched build: ${fullBuild.name}`, fullBuild);
      console.log(`[ConfigGen] Loading data into store...`, fullBuild);
      loadBuild(fullBuild.id, fullBuild.name, fullBuild);
      dispatch({ labName: fullBuild.name.toLowerCase().replace(/[^a-z0-9]/g, '-') });
      toast.success(`Loaded project: ${fullBuild.name}`);
      await loadConfigBundle(id);
    } catch (e) {
      console.error('[ConfigGen] Failed to load build', e);
      toast.error('Failed to load project - it may have been deleted');
      clearCurrentBuild();
      dispatch({ selectedBuildId: '' });
    } finally {
      dispatch({ loadingBuild: false });
    }
  };

  // Load project list on mount
  useEffect(() => {
    buildApi
      .list()
      .then(list => {
        dispatch({ builds: list.map(b => ({ id: b.id, name: b.name })) });
        const current = useBuilderStore.getState().currentBuildId;
        if (current) {
          dispatch({ selectedBuildId: current });
          loadConfigBundle(current);
        } else if (list.length > 0) {
          handleSelectBuild(list[0].id);
        }
      })
      .catch(err => console.error('Failed to list builds', err));
  }, []);

  // IP settings
  // IP settings (Defaults)
  // const [baseIp, setBaseIp] = useState('192.168.1.0')
  // const [cidr, setCidr] = useState(24)
  // const [homeRouterMode, setHomeRouterMode] = useState(false)
  // const [homeReserve, setHomeReserve] = useState(50)

  const ipOpts: IpAllocatorOptions = useMemo(
    () => ({
      baseIp: '192.168.1.0',
      cidr: 24,
      homeRouterMode: false,
      homeReserve: 50,
    }),
    [],
  );

  // Derive comprehensive service list from Visual Builder placements (hardwareNodes)
  const allServices = useMemo(() => {
    const services: any[] = []; // Using any to avoid strict Service type construction for minimal mock

    hardwareNodes.forEach(node => {
      node.vms?.forEach(vm => {
        if (vm.type === 'container' || vm.type === 'vm') {
          services.push({
            id: vm.id, // Use VM ID
            name: vm.name,
            description: 'Deployed in Visual Builder',
            category: 'other',
            icon: 'Package',
            official_website: '',
            docker_support: true,
            is_active: true,
            requirements: null,
            created_at: new Date().toISOString(),
          });
        }
      });
    });

    return services;
  }, [hardwareNodes]);

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
        return generateAnsiblePlaybook(allServices, hardwareNodes);
      case 'nginx':
        return configBundle?.nginx || fallbacks['nginx'];
      case 'traefik':
        return generateTraefikLabels(allServices, domain);
      case 'ip-plan':
        return generateIpPlan(hardwareNodes, ipOpts);
    }
  }

  const activeTabMeta = TABS.find(t => t.id === activeTab)!;
  const content = getContent(activeTab);

  return (
    <div className="space-y-6 max-w-6xl mx-auto py-8 px-6">
      {/* Header */}
      <div className="flex items-start justify-between flex-wrap gap-4">
        <div>
          <h1 className="text-3xl font-semibold tracking-tight">Config Generator</h1>
          <p className="text-muted-foreground mt-1">
            Generate deployment configs from your Visual Builder design
          </p>
        </div>

        <div className="flex items-center gap-3">
          {loadingBuild && (
            <span className="text-xs text-muted-foreground animate-pulse flex items-center gap-1.5">
              <Logo variant="loading" className="size-3" /> Loading&hellip;
            </span>
          )}
          <select
            className="h-9 w-50 rounded-md border border-input bg-background px-3 py-1 text-sm transition-colors focus-visible:outline-none focus-visible:ring-1 focus-visible:ring-ring"
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
        </div>

        <div className="flex gap-2 flex-wrap mr-16">
          {/* Import and Export moved to Projects Dashboard */}
        </div>
      </div>

      {/* Empty state */}
      {!hasContent && (
        <div className="rounded-xl border border-dashed p-12 text-center">
          <AlertCircle className="size-10 text-muted-foreground/40 mx-auto mb-4" />
          <h3 className="font-semibold text-lg mb-2">No lab design yet</h3>
          <p className="text-muted-foreground text-sm mb-4">
            Go to the <strong>Visual Builder</strong> and add services and hardware nodes, then come
            back here to generate configs.
          </p>
          <Button variant="outline" size="sm" asChild>
            <a href="/builder">Open Visual Builder →</a>
          </Button>
        </div>
      )}

      {hasContent && (
        <>
          {/* Stats bar */}
          <StatsBar
            servicesCount={allServices.length}
            hardwareNodesCount={hardwareNodes.length}
            ipOpts={ipOpts}
          />

          <SettingsPanel
            showSettings={showSettings}
            labName={labName}
            domain={domain}
            onToggle={() => dispatch({ showSettings: !showSettings })}
            onLabNameChange={(value) => dispatch({ labName: value })}
            onDomainChange={(value) => dispatch({ domain: value })}
          />

          {/* IP Zone Legend removed */}

          {/* Tab bar */}
          <div className="flex flex-wrap gap-2">
            {TABS.map(tab => {
              const Icon = tab.icon;
              return (
                <button
                  key={tab.id}
                  type="button"
                  onClick={() => dispatch({ activeTab: tab.id })}
                  className={`flex items-center gap-2 px-4 py-2 rounded-lg text-sm font-medium border transition-colors hover:cursor-pointer ${
                    activeTab === tab.id
                      ? 'bg-primary text-primary-foreground border-primary'
                      : 'border-border hover:bg-muted'
                  }`}
                >
                  <Icon className="size-4" />
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
              {TABS.map(tab => (
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
                  <Download className="size-3 mr-1" />
                  {tab.ext}
                </Button>
              ))}
            </div>
          </div>
        </>
      )}
    </div>
  );
}
