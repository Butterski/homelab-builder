import { useBuilderStore } from '../store/builder-store';
import { Button } from '../../../components/ui/button';
import { ChevronRight, Cpu, Database, MemoryStick } from 'lucide-react';
import { useNavigate } from 'react-router-dom';
import { cn } from '../../../lib/utils';

// Simple Progress component if I don't want to install radix progress for now
function SimpleProgress({
  value,
  max = 100,
  className,
}: {
  value: number;
  max?: number;
  className?: string;
}) {
  const percentage = Math.min(100, (value / max) * 100);
  return (
    <div className={cn('h-2 w-full overflow-hidden rounded-full bg-secondary/20', className)}>
      <div
        className="h-full bg-primary transition-all duration-500 ease-in-out"
        style={{ width: `${percentage}%` }}
      />
    </div>
  );
}

export function BuilderPanel() {
  const { hardwareNodes, totalCpu, totalRam, totalStorage } = useBuilderStore();
  const navigate = useNavigate();

  if (hardwareNodes.length === 0) return null;

  const cpu = totalCpu();
  const ram = totalRam();
  const storage = totalStorage();

  // Approximate tiered max values for visualization (Entry level server)
  const maxCpu = 16;
  const maxRam = 64 * 1024;
  const maxStorage = 4000;

  const sidebarCollapsed = (() => {
    try {
      return localStorage.getItem('sidebar-collapsed') === 'true';
    } catch {
      return false;
    }
  })();
  const totalVMs = hardwareNodes.reduce((acc, node) => acc + (node.vms?.length || 0), 0);

  return (
    <div
      className={`fixed bottom-0 left-0 right-0 border-t border-border bg-card p-4 z-40 animate-in slide-in-from-bottom transition-all duration-300 ${sidebarCollapsed ? 'md:left-16' : 'md:left-64'}`}
    >
      <div className="container flex flex-col md:flex-row items-center justify-between gap-4">
        <div className="grid grid-cols-3 gap-8 w-full md:w-auto flex-1">
          <div className="space-y-1">
            <div className="flex items-center justify-between text-xs font-medium">
              <span className="flex items-center gap-1">
                <Cpu className="h-3 w-3" /> CPU
              </span>
              <span className="text-muted-foreground">{cpu} Cores</span>
            </div>
            <SimpleProgress value={cpu} max={maxCpu} />
          </div>
          <div className="space-y-1">
            <div className="flex items-center justify-between text-xs font-medium">
              <span className="flex items-center gap-1">
                <MemoryStick className="h-3 w-3" /> RAM
              </span>
              <span className="text-muted-foreground">{Math.round(ram / 1024)} GB</span>
            </div>
            <SimpleProgress value={ram} max={maxRam} />
          </div>
          <div className="space-y-1">
            <div className="flex items-center justify-between text-xs font-medium">
              <span className="flex items-center gap-1">
                <Database className="h-3 w-3" /> Storage
              </span>
              <span className="text-muted-foreground">{storage} GB</span>
            </div>
            <SimpleProgress value={storage} max={maxStorage} />
          </div>
        </div>

        <div className="flex items-center gap-4 w-full md:w-auto">
          <div className="text-right hidden md:block">
            <div className="text-sm font-semibold">{totalVMs} VMs Deployed</div>
            <div className="text-xs text-muted-foreground">
              Est. Cost: ~${cpu * 50 + (ram / 1024) * 10 + storage * 0.1}
            </div>
          </div>
          <Button
            onClick={() => navigate('/recommendations')}
            size="lg"
            className="w-full md:w-auto"
          >
            Next Step <ChevronRight className="ml-2 h-4 w-4" />
          </Button>
        </div>
      </div>
    </div>
  );
}
