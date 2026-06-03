import { useMemo } from 'react';
import { Command } from 'cmdk';
import {
  AppWindow,
  BookOpen,
  CheckSquare,
  FileCode,
  HardDrive,
  Heart,
  LayoutDashboard,
  LayoutTemplate,
  Network,
  Search,
  Settings,
  User,
} from 'lucide-react';
import { useLocation, useNavigate } from 'react-router-dom';
import { toast } from 'sonner';
import {
  Dialog,
  DialogContent,
  DialogDescription,
  DialogTitle,
} from './ui/dialog';
import { cn } from '../lib/utils';
import { useAuth } from '../features/admin/hooks/use-auth';
import { useBuilderStore } from '../features/builder/store/builder-store';

type CommandAction = {
  id: string;
  label: string;
  hint: string;
  icon: React.ComponentType<{ className?: string }>;
  keywords: string[];
  run: () => void | Promise<void>;
  disabled?: boolean;
};

type CommandPaletteProps = {
  open: boolean;
  onOpenChange: (open: boolean) => void;
};

function ShortcutHint({ children }: { children: React.ReactNode }) {
  return (
    <kbd className="rounded border border-border bg-muted px-1.5 py-0.5 text-[10px] font-medium text-muted-foreground">
      {children}
    </kbd>
  );
}

export function CommandPalette({ open, onOpenChange }: CommandPaletteProps) {
  const navigate = useNavigate();
  const location = useLocation();
  const { user } = useAuth();
  const currentBuildId = useBuilderStore(s => s.currentBuildId);
  const projectName = useBuilderStore(s => s.projectName);
  const reassignAllIPs = useBuilderStore(s => s.reassignAllIPs);
  const validateNetwork = useBuilderStore(s => s.validateNetwork);

  const commands = useMemo<CommandAction[]>(() => {
    const go = (path: string) => () => {
      navigate(path);
      onOpenChange(false);
    };

    const items: CommandAction[] = [
      {
        id: 'projects',
        label: 'Open projects',
        hint: 'Project dashboard',
        icon: LayoutDashboard,
        keywords: ['home', 'dashboard', 'builds'],
        run: go('/'),
      },
      {
        id: 'active-project',
        label: currentBuildId ? `Open active project: ${projectName || 'Untitled project'}` : 'Open active project',
        hint: currentBuildId ? 'Current builder canvas' : 'No active project',
        icon: LayoutTemplate,
        keywords: ['builder', 'canvas', 'current'],
        disabled: !currentBuildId,
        run: go(currentBuildId ? `/builder/${currentBuildId}` : location.pathname),
      },
      {
        id: 'hardware',
        label: 'Open hardware catalog',
        hint: 'Compare devices',
        icon: HardDrive,
        keywords: ['catalog', 'parts', 'servers', 'nas'],
        run: go('/hardware'),
      },
      {
        id: 'services',
        label: 'Open service library',
        hint: 'Browse self-hosted apps',
        icon: AppWindow,
        keywords: ['apps', 'containers', 'services'],
        run: go('/services'),
      },
      {
        id: 'config',
        label: 'Open config generator',
        hint: 'Generate network config',
        icon: FileCode,
        keywords: ['router', 'configuration', 'export'],
        run: go('/generate'),
      },
      {
        id: 'guide',
        label: 'Open homelab guide',
        hint: 'Planning and Google SSO',
        icon: BookOpen,
        keywords: ['docs', 'help', 'sso', 'google'],
        run: go('/how-to-build-a-homelab'),
      },
      {
        id: 'checklist',
        label: 'Open setup guide',
        hint: 'Build checklist',
        icon: CheckSquare,
        keywords: ['tasks', 'steps', 'setup'],
        run: go('/checklist'),
      },
      {
        id: 'profile',
        label: 'Open profile',
        hint: user ? user.email : 'Sign in required',
        icon: User,
        keywords: ['account', 'theme', 'settings'],
        disabled: !user,
        run: go('/profile'),
      },
      {
        id: 'donate',
        label: 'Support HLBuilder',
        hint: 'Funding page',
        icon: Heart,
        keywords: ['donate', 'sponsor'],
        run: go('/donate'),
      },
    ];

    if (user?.is_admin) {
      items.push({
        id: 'admin',
        label: 'Open admin',
        hint: 'Admin tools',
        icon: Settings,
        keywords: ['management', 'users'],
        run: go('/admin'),
      });
    }

    items.push(
      {
        id: 'network-calculate',
        label: 'Recalculate network IPs',
        hint: currentBuildId ? 'Save, calculate, reload' : 'Requires an active project',
        icon: Network,
        keywords: ['ip', 'assign', 'calculate', 'router'],
        disabled: !currentBuildId,
        run: async () => {
          if (!currentBuildId) return;
          onOpenChange(false);
          await toast.promise(reassignAllIPs(), {
            loading: 'Recalculating network IPs...',
            success: 'Network IPs recalculated',
            error: 'Failed to recalculate network IPs',
          });
        },
      },
      {
        id: 'network-validate',
        label: 'Validate network',
        hint: currentBuildId ? 'Check topology issues' : 'Requires an active project',
        icon: Search,
        keywords: ['issues', 'topology', 'warnings'],
        disabled: !currentBuildId,
        run: async () => {
          if (!currentBuildId) return;
          onOpenChange(false);
          await toast.promise(validateNetwork(), {
            loading: 'Validating network...',
            success: 'Network validation complete',
            error: 'Network validation failed',
          });
        },
      },
    );

    return items;
  }, [currentBuildId, location.pathname, navigate, onOpenChange, projectName, reassignAllIPs, user, validateNetwork]);

  const runCommand = (action: CommandAction) => {
    if (action.disabled) return;
    void action.run();
  };

  return (
    <Dialog open={open} onOpenChange={onOpenChange}>
      <DialogContent className="overflow-hidden p-0 sm:max-w-2xl">
        <DialogTitle className="sr-only">Command palette</DialogTitle>
        <DialogDescription className="sr-only">
          Search navigation and common HLBuilder actions.
        </DialogDescription>
        <Command className="bg-popover text-popover-foreground" shouldFilter>
          <div className="flex items-center gap-3 border-b px-4">
            <Search className="size-4 shrink-0 text-muted-foreground" aria-hidden="true" />
            <Command.Input
              autoFocus
              placeholder="Search pages and actions..."
              className="h-14 flex-1 bg-transparent text-sm outline-none placeholder:text-muted-foreground"
            />
            <div className="hidden items-center gap-1 sm:flex">
              <ShortcutHint>Ctrl</ShortcutHint>
              <ShortcutHint>K</ShortcutHint>
            </div>
          </div>

          <Command.List className="max-h-[min(520px,70vh)] overflow-y-auto p-2">
            <Command.Empty className="px-3 py-8 text-center text-sm text-muted-foreground">
              No command found.
            </Command.Empty>
            <Command.Group heading="Navigation" className="command-group">
              {commands.slice(0, user?.is_admin ? 10 : 9).map(action => (
                <Command.Item
                  key={action.id}
                  value={`${action.label} ${action.keywords.join(' ')}`}
                  disabled={action.disabled}
                  onSelect={() => runCommand(action)}
                  className={cn(
                    'flex cursor-pointer items-center gap-3 rounded-lg px-3 py-2.5 text-sm outline-none transition-colors data-[selected=true]:bg-accent data-[selected=true]:text-accent-foreground',
                    action.disabled && 'cursor-not-allowed opacity-45',
                  )}
                >
                  <span className="flex size-8 items-center justify-center rounded-md border bg-background text-muted-foreground">
                    <action.icon className="size-4" aria-hidden="true" />
                  </span>
                  <span className="min-w-0 flex-1">
                    <span className="block truncate font-medium">{action.label}</span>
                    <span className="block truncate text-xs text-muted-foreground">{action.hint}</span>
                  </span>
                </Command.Item>
              ))}
            </Command.Group>

            <Command.Group heading="Builder actions" className="command-group">
              {commands.slice(user?.is_admin ? 10 : 9).map(action => (
                <Command.Item
                  key={action.id}
                  value={`${action.label} ${action.keywords.join(' ')}`}
                  disabled={action.disabled}
                  onSelect={() => runCommand(action)}
                  className={cn(
                    'flex cursor-pointer items-center gap-3 rounded-lg px-3 py-2.5 text-sm outline-none transition-colors data-[selected=true]:bg-accent data-[selected=true]:text-accent-foreground',
                    action.disabled && 'cursor-not-allowed opacity-45',
                  )}
                >
                  <span className="flex size-8 items-center justify-center rounded-md border bg-background text-muted-foreground">
                    <action.icon className="size-4" aria-hidden="true" />
                  </span>
                  <span className="min-w-0 flex-1">
                    <span className="block truncate font-medium">{action.label}</span>
                    <span className="block truncate text-xs text-muted-foreground">{action.hint}</span>
                  </span>
                </Command.Item>
              ))}
            </Command.Group>
          </Command.List>

          <div className="flex items-center justify-between border-t px-4 py-2 text-xs text-muted-foreground">
            <span>Type to search</span>
            <span>Enter to run</span>
          </div>
        </Command>
      </DialogContent>
    </Dialog>
  );
}
