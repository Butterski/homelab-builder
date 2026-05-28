import { useState, useMemo } from 'react';
import { useBuilderStore } from '../store/builder-store';
import { Card, CardContent } from '../../../components/ui/card';
import { Button } from '../../../components/ui/button';
import { Progress } from '../../../components/ui/progress';
import { Activity, ChevronDown, ChevronUp, Cpu, HardDrive, Package } from 'lucide-react';
import { cn } from '../../../lib/utils';
import type { HardwareType } from '../../../types';
import { isComputeNode, nodeHasStorage } from '../../../lib/hardware-config';
import { getVmResourceUsage } from '../lib/resource-usage';

// Helper to safely parse strings like "16GB" to numbers
const parseSpec = (val?: string | number): number => {
  if (!val) return 0;
  if (typeof val === 'number') return val;
  const matches = val.toString().match(/\d+/);
  return matches ? parseInt(matches[0], 10) : 0;
};

export function LiveResourceDashboard() {
  const { hardwareNodes } = useBuilderStore();
  const [isExpanded, setIsExpanded] = useState(false);

  const stats = useMemo(() => {
    let totalRamMb = 0;
    let totalCpuThreads = 0;
    let totalStorageGb = 0;

    let usedRamMb = 0;
    let usedCpuThreads = 0;
    let usedStorageGb = 0;

    let totalPowerDraw = 0;

    hardwareNodes.forEach(node => {
      // Calculate Power
      totalPowerDraw += node.power_draw || 0;
      if (node.internal_components) {
        node.internal_components.forEach(comp => {
          totalPowerDraw += comp.power_draw || 0;
        });
      }

      if (!isComputeNode(node.type)) return;

      // Capacity based on node details
      if (node.details) {
        totalCpuThreads += parseSpec(String(node.details.cpu));
        // Assume RAM is stored in GB if small number, else MB
        const ram = parseSpec(String(node.details.ram));
        totalRamMb += ram < 1024 ? ram * 1024 : ram;

        const storage = parseSpec(String(node.details.storage));
        totalStorageGb += storage;
      } else {
        // Generous default if no details provided yet
        totalCpuThreads += 4;
        totalRamMb += 8192;
        totalStorageGb += 256;
      }

      // Aggregate internal components (disks, NAS drives, GPUs) into totals
      if (node.internal_components) {
        node.internal_components.forEach(comp => {
          if (!comp.details) return;
          // Disks, NAS, etc contribute storage
          if (nodeHasStorage(comp.type as HardwareType)) {
            totalStorageGb += parseSpec(String(comp.details.storage));
          }
          // GPUs contribute VRAM as dedicated RAM
          if (comp.type === 'gpu') {
            const vram = parseSpec(String(comp.details.ram));
            totalRamMb += vram < 1024 ? vram * 1024 : vram;
          }
        });
      }

      // Usage based on deployed VMs/Services
      if (node.vms) {
        const usage = getVmResourceUsage(node.vms);
        usedCpuThreads += usage.cpu;
        usedRamMb += usage.ramMb;
        usedStorageGb += usage.storageGb;
      }
    });

    const ramPercent = totalRamMb > 0 ? (usedRamMb / totalRamMb) * 100 : 0;
    const cpuPercent = totalCpuThreads > 0 ? (usedCpuThreads / totalCpuThreads) * 100 : 0;
    const storagePercent = totalStorageGb > 0 ? (usedStorageGb / totalStorageGb) * 100 : 0;

    return {
      totalRamMb,
      usedRamMb,
      ramPercent,
      totalCpuThreads,
      usedCpuThreads,
      cpuPercent,
      totalStorageGb,
      usedStorageGb,
      storagePercent,
      totalPowerDraw,
      hasCompute: totalRamMb > 0 || totalCpuThreads > 0, // Wait, maybe we want to show power even without compute
    };
  }, [hardwareNodes]);

  const [costPerKwh, setCostPerKwh] = useState<number>(0.15); // e.g. $0.15 / kWh
  // Calculate running cost 24/7 for a month (730 hours)
  const monthlyCost = (stats.totalPowerDraw / 1000) * 730 * costPerKwh;

  if (!stats.hasCompute && stats.totalPowerDraw === 0) return null;

  const maxPercent = Math.max(stats.cpuPercent, stats.ramPercent, stats.storagePercent);

  let lightColor = 'bg-green-500';
  let pingColor = 'hidden';
  let cardBorder = 'border-border';

  if (maxPercent >= 90) {
    lightColor = 'bg-red-500';
    pingColor = 'bg-red-400 animate-ping';
    cardBorder = 'border-destructive shadow-[0_0_10px_rgba(239,68,68,0.3)]';
  } else if (maxPercent >= 75) {
    lightColor = 'bg-orange-500';
    pingColor = 'bg-orange-400 animate-ping';
    cardBorder = 'border-orange-500 shadow-[0_0_10px_rgba(249,115,22,0.3)]';
  } else if (maxPercent >= 60) {
    lightColor = 'bg-yellow-500';
    pingColor = 'bg-yellow-400 animate-ping';
  }

  const getProgressColor = (percent: number) => {
    if (percent >= 90) return 'bg-destructive';
    if (percent >= 75) return 'bg-amber-500';
    return 'bg-primary';
  };

  return (
    <div className="builder-resource-dashboard absolute top-4 right-4 z-50 transition-all duration-300 pointer-events-auto" data-hide-export="true">
      <Card
        className={cn(
          `shadow-none overflow-hidden transition-all duration-300 bg-card ${isExpanded ? 'w-[320px]' : 'w-48'}`,
          cardBorder,
        )}
      >
        <button
          type="button"
          className="flex justify-between items-center p-2 px-3 w-full hover:bg-muted/50"
          onClick={() => setIsExpanded(!isExpanded)}
        >
          <div className="flex items-center gap-2 text-sm font-semibold">
            <Activity
              className={cn(
                'size-4',
                maxPercent >= 90
                  ? 'text-destructive'
                  : maxPercent >= 75
                    ? 'text-orange-500'
                    : 'text-primary',
              )}
            />
            <span className="builder-resource-label">Resource Usage</span>
            <span className="relative flex size-2 shrink-0 ml-1">
              <span
                className={cn(
                  'absolute inline-flex h-full w-full rounded-full opacity-75',
                  pingColor,
                )}
              />
              <span className={cn('relative inline-flex rounded-full size-2', lightColor)} />
            </span>
          </div>
          <Button variant="ghost" size="icon" className="size-6">
            {isExpanded ? <ChevronUp className="size-4" /> : <ChevronDown className="size-4" />}
          </Button>
        </button>

        {isExpanded && (
          <CardContent className="p-4 pt-2 space-y-4">
            <div className="space-y-1.5">
              <div className="flex justify-between items-center text-xs">
                <span className="flex items-center gap-1.5 text-muted-foreground">
                  <Cpu className="size-3.5" /> CPU Threads
                </span>
                <span className="font-mono font-medium">
                  {stats.usedCpuThreads} / {stats.totalCpuThreads}
                </span>
              </div>
              <Progress
                value={Math.min(stats.cpuPercent, 100)}
                className="h-2"
                indicatorClassName={getProgressColor(stats.cpuPercent)}
              />
            </div>

            <div className="space-y-1.5">
              <div className="flex justify-between items-center text-xs">
                <span className="flex items-center gap-1.5 text-muted-foreground">
                  <Package className="size-3.5" /> Memory (RAM)
                </span>
                <span className="font-mono font-medium">
                  {Math.round((stats.usedRamMb / 1024) * 10) / 10}G /{' '}
                  {Math.round((stats.totalRamMb / 1024) * 10) / 10}G
                </span>
              </div>
              <Progress
                value={Math.min(stats.ramPercent, 100)}
                className="h-2"
                indicatorClassName={getProgressColor(stats.ramPercent)}
              />
            </div>

            <div className="space-y-1.5">
              <div className="flex justify-between items-center text-xs">
                <span className="flex items-center gap-1.5 text-muted-foreground">
                  <HardDrive className="size-3.5" /> Storage
                </span>
                <span className="font-mono font-medium">
                  {stats.usedStorageGb}G / {stats.totalStorageGb}G
                </span>
              </div>
              <Progress
                value={Math.min(stats.storagePercent, 100)}
                className="h-2"
                indicatorClassName={getProgressColor(stats.storagePercent)}
              />
            </div>

            {stats.totalPowerDraw > 0 && (
              <div className="pt-2 mt-2 border-t space-y-2">
                <div className="flex justify-between items-center text-xs">
                  <span className="flex items-center gap-1.5 text-muted-foreground">
                    <Activity className="size-3.5" /> Power Draw
                  </span>
                  <span className="font-mono font-medium">
                    {stats.totalPowerDraw} W
                  </span>
                </div>
                <div className="flex justify-between items-center text-xs">
                  <span className="flex items-center gap-1.5 text-muted-foreground whitespace-nowrap">
                    Cost/kWh
                  </span>
                  <div className="flex items-center">
                    <span className="text-muted-foreground mr-1">$</span>
                    <input
                      type="number"
                      step="0.01"
                      min="0"
                      className="w-16 bg-background border px-1 py-0.5 rounded text-right font-mono"
                      value={costPerKwh}
                      onChange={(e) => setCostPerKwh(parseFloat(e.target.value) || 0)}
                      onClick={(e) => e.stopPropagation()}
                    />
                  </div>
                </div>
                <div className="flex justify-between items-center text-xs uppercase font-bold text-muted-foreground bg-muted/30 p-2 rounded-md">
                  <span>Est. Monthly</span>
                  <span className="text-foreground tracking-wide font-mono">${monthlyCost.toFixed(2)} / mo</span>
                </div>
              </div>
            )}
          </CardContent>
        )}
      </Card>
    </div>
  );
}
