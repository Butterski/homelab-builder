import { useState, useMemo } from 'react';
import { useBuilderStore } from '../store/builder-store';
import { Card, CardContent } from '../../../components/ui/card';
import { Button } from '../../../components/ui/button';
import { Progress } from '../../../components/ui/progress';
import { Activity, ChevronDown, ChevronUp, Cpu, HardDrive, Package } from 'lucide-react';
import { cn } from '../../../lib/utils';
import type { HardwareType } from '../../../types';

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

        const isCompute = (t: HardwareType) => ['server', 'pc', 'minipc', 'sbc', 'nas'].includes(t);

        hardwareNodes.forEach(node => {
            if (!isCompute(node.type)) return;

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
                    // Disks, NAS, HBA contribute storage
                    if (['disk', 'nas', 'hba'].includes(comp.type)) {
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
                node.vms.forEach(vm => {
                    usedCpuThreads += vm.cpu_cores || 1;
                    usedRamMb += vm.ram_mb || 512;
                    // Mock storage for now as services don't strictly define it yet in vms
                    usedStorageGb += 10; 
                });
            }
        });

        const ramPercent = totalRamMb > 0 ? (usedRamMb / totalRamMb) * 100 : 0;
        const cpuPercent = totalCpuThreads > 0 ? (usedCpuThreads / totalCpuThreads) * 100 : 0;
        const storagePercent = totalStorageGb > 0 ? (usedStorageGb / totalStorageGb) * 100 : 0;

        return {
            totalRamMb, usedRamMb, ramPercent,
            totalCpuThreads, usedCpuThreads, cpuPercent,
            totalStorageGb, usedStorageGb, storagePercent,
            hasCompute: totalRamMb > 0 || totalCpuThreads > 0
        };
    }, [hardwareNodes]);

    if (!stats.hasCompute) return null;

    const maxPercent = Math.max(stats.cpuPercent, stats.ramPercent, stats.storagePercent);

    let lightColor = 'bg-green-500';
    let pingColor = 'bg-green-400 animate-ping';
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
        if (percent >= 90) return "bg-destructive";
        if (percent >= 75) return "bg-amber-500";
        return "bg-primary";
    };

    return (
        <div className="absolute top-4 left-1/2 -translate-x-1/2 z-50 transition-all duration-300 pointer-events-auto">
            <Card className={cn(`shadow-none overflow-hidden transition-all duration-300 bg-card ${isExpanded ? 'w-[320px]' : 'w-[200px]'}`, cardBorder)}>
                <div 
                    className="flex justify-between items-center p-2 px-3 cursor-pointer hover:bg-muted/50"
                    onClick={() => setIsExpanded(!isExpanded)}
                >
                    <div className="flex items-center gap-2 text-sm font-semibold">
                        <Activity className={cn("h-4 w-4", maxPercent >= 90 ? "text-destructive" : maxPercent >= 75 ? "text-orange-500" : "text-primary")} />
                        Resource Usage
                        <span className="relative flex h-2 w-2 shrink-0 ml-1">
                            <span className={cn("absolute inline-flex h-full w-full rounded-full opacity-75", pingColor)} />
                            <span className={cn("relative inline-flex rounded-full h-2 w-2", lightColor)} />
                        </span>
                    </div>
                    <Button variant="ghost" size="icon" className="h-6 w-6">
                        {isExpanded ? <ChevronUp className="h-4 w-4" /> : <ChevronDown className="h-4 w-4" />}
                    </Button>
                </div>

                {isExpanded && (
                    <CardContent className="p-4 pt-2 space-y-4">
                        <div className="space-y-1.5">
                            <div className="flex justify-between items-center text-xs">
                                <span className="flex items-center gap-1.5 text-muted-foreground"><Cpu className="h-3.5 w-3.5" /> CPU Threads</span>
                                <span className="font-mono font-medium">{stats.usedCpuThreads} / {stats.totalCpuThreads}</span>
                            </div>
                            <Progress value={Math.min(stats.cpuPercent, 100)} className="h-2" indicatorClassName={getProgressColor(stats.cpuPercent)} />
                        </div>

                        <div className="space-y-1.5">
                            <div className="flex justify-between items-center text-xs">
                                <span className="flex items-center gap-1.5 text-muted-foreground"><Package className="h-3.5 w-3.5" /> Memory (RAM)</span>
                                <span className="font-mono font-medium">{Math.round(stats.usedRamMb/1024 * 10)/10}G / {Math.round(stats.totalRamMb/1024 * 10)/10}G</span>
                            </div>
                            <Progress value={Math.min(stats.ramPercent, 100)} className="h-2" indicatorClassName={getProgressColor(stats.ramPercent)} />
                        </div>

                        <div className="space-y-1.5">
                            <div className="flex justify-between items-center text-xs">
                                <span className="flex items-center gap-1.5 text-muted-foreground"><HardDrive className="h-3.5 w-3.5" /> Storage</span>
                                <span className="font-mono font-medium">{stats.usedStorageGb}G / {stats.totalStorageGb}G</span>
                            </div>
                            <Progress value={Math.min(stats.storagePercent, 100)} className="h-2" indicatorClassName={getProgressColor(stats.storagePercent)} />
                        </div>
                    </CardContent>
                )}
            </Card>
        </div>
    );
}
