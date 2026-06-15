import { useMemo } from 'react';
import type { Edge } from '@xyflow/react';
import {
  AlertTriangle,
  Battery,
  ClipboardCheck,
  Cpu,
  Download,
  Gauge,
  Network,
  Route,
  Server,
  Wand2,
  Zap,
  type LucideIcon,
} from 'lucide-react';
import {
  Dialog,
  DialogContent,
  DialogDescription,
  DialogFooter,
  DialogHeader,
  DialogTitle,
} from '../../../components/ui/dialog';
import { Button } from '../../../components/ui/button';
import { Badge } from '../../../components/ui/badge';
import { Progress } from '../../../components/ui/progress';
import { cn } from '../../../lib/utils';
import type { HardwareNode, HardwareNodeValidationIssue, HardwareType } from '../../../types';
import { isComputeNode, isNetworkNode, nodeHasStorage } from '../../../lib/hardware-config';
import { getVmResourceUsage } from '../lib/resource-usage';

type ReadinessReportDialogProps = {
  open: boolean;
  onOpenChange: (open: boolean) => void;
  hardwareNodes: HardwareNode[];
  edges: Edge[];
  validationIssues: HardwareNodeValidationIssue[];
  onGenerateConfig: () => void;
  onReassignIPs: () => void | Promise<void>;
};

type ReportSection = {
  id: string;
  label: string;
  score: number;
  message: string;
  icon: LucideIcon;
};

type ActionItem = {
  label: string;
  tone: 'critical' | 'warning' | 'info' | 'success';
};

type ReportStats = {
  totalNodes: number;
  networkNodes: number;
  computeNodes: number;
  vmCount: number;
  edgeCount: number;
  totalPowerWatts: number;
  cpuCapacity: number;
  usedCpu: number;
  ramCapacityMb: number;
  usedRamMb: number;
  storageCapacityGb: number;
  usedStorageGb: number;
  missingIPCount: number;
  orphanCount: number;
  validationErrorCount: number;
  validationWarningCount: number;
};

type ReadinessReport = {
  score: number;
  grade: string;
  tone: 'success' | 'warning' | 'critical';
  headline: string;
  sections: ReportSection[];
  actions: ActionItem[];
  stats: ReportStats;
};

function parseSpecNumber(value: unknown): number {
  if (typeof value === 'number') return Number.isFinite(value) ? value : 0;
  if (typeof value !== 'string') return 0;
  const match = value.match(/\d+(\.\d+)?/);
  return match ? Number(match[0]) : 0;
}

function normalizeRamMb(value: unknown): number {
  const numeric = parseSpecNumber(value);
  if (numeric === 0) return 0;
  return numeric < 1024 ? numeric * 1024 : numeric;
}

function isGatewayNode(node: HardwareNode): boolean {
  return (
    node.type === 'router' ||
    node.type === 'firewall' ||
    !!node.details?.routing_enabled ||
    !!node.details?.nat_enabled ||
    !!node.details?.dhcp_enabled ||
    !!node.details?.lan_gateway_ip
  );
}

function buildAdjacency(nodeIds: Set<string>, edges: Edge[]) {
  const adjacency = new Map<string, Set<string>>();
  nodeIds.forEach(id => adjacency.set(id, new Set()));

  edges.forEach(edge => {
    if (!nodeIds.has(edge.source) || !nodeIds.has(edge.target)) return;
    adjacency.get(edge.source)?.add(edge.target);
    adjacency.get(edge.target)?.add(edge.source);
  });

  return adjacency;
}

function reachableFromGateways(gatewayIds: string[], adjacency: Map<string, Set<string>>) {
  const reachable = new Set<string>();
  const queue = [...gatewayIds];

  while (queue.length > 0) {
    const current = queue.shift();
    if (!current || reachable.has(current)) continue;
    reachable.add(current);

    adjacency.get(current)?.forEach(next => {
      if (!reachable.has(next)) queue.push(next);
    });
  }

  return reachable;
}

function graphHasCycle(nodeIds: Set<string>, edges: Edge[]) {
  const parent = new Map<string, string>();
  nodeIds.forEach(id => parent.set(id, id));

  const find = (id: string): string => {
    const current = parent.get(id);
    if (!current || current === id) return id;
    const root = find(current);
    parent.set(id, root);
    return root;
  };

  const union = (a: string, b: string) => {
    const rootA = find(a);
    const rootB = find(b);
    if (rootA === rootB) return false;
    parent.set(rootB, rootA);
    return true;
  };

  for (const edge of edges) {
    if (!nodeIds.has(edge.source) || !nodeIds.has(edge.target)) continue;
    if (!union(edge.source, edge.target)) return true;
  }

  return false;
}

function clampScore(value: number) {
  if (!Number.isFinite(value)) return 0;
  return Math.max(0, Math.min(100, Math.round(value)));
}

function sectionTone(score: number) {
  if (score >= 80) return 'text-emerald-500';
  if (score >= 55) return 'text-amber-500';
  return 'text-destructive';
}

function actionToneClass(tone: ActionItem['tone']) {
  if (tone === 'critical') return 'border-destructive/30 bg-destructive/10 text-destructive';
  if (tone === 'warning') return 'border-amber-500/30 bg-amber-500/10 text-amber-700 dark:text-amber-300';
  if (tone === 'success') return 'border-emerald-500/30 bg-emerald-500/10 text-emerald-700 dark:text-emerald-300';
  return 'border-sky-500/30 bg-sky-500/10 text-sky-700 dark:text-sky-300';
}

function formatRam(mb: number) {
  if (mb <= 0) return '0 GB';
  return `${Math.round((mb / 1024) * 10) / 10} GB`;
}

function formatStorage(gb: number) {
  if (gb >= 1000) return `${Math.round((gb / 1000) * 10) / 10} TB`;
  return `${Math.round(gb)} GB`;
}

function summarizeResourceUsage(used: number, capacity: number) {
  if (capacity <= 0) return 0;
  return Math.round((used / capacity) * 100);
}

function computeReadinessReport(
  hardwareNodes: HardwareNode[],
  edges: Edge[],
  validationIssues: HardwareNodeValidationIssue[],
): ReadinessReport {
  const totalNodes = hardwareNodes.length;
  const networkNodes = hardwareNodes.filter(node => isNetworkNode(node.type));
  const computeNodes = hardwareNodes.filter(node => isComputeNode(node.type));
  const gateways = networkNodes.filter(isGatewayNode);
  const gatewayIds = gateways.map(node => node.id);
  const networkNodeIds = new Set(networkNodes.map(node => node.id));
  const adjacency = buildAdjacency(networkNodeIds, edges);
  const reachable = reachableFromGateways(gatewayIds, adjacency);
  const orphanNodes = networkNodes.filter(node => !gatewayIds.includes(node.id) && !reachable.has(node.id));
  const missingIPNodes = networkNodes.filter(node => !node.ip);
  const hasCycle = graphHasCycle(networkNodeIds, edges);
  const vmCount = hardwareNodes.reduce((count, node) => count + (node.vms?.length || 0), 0);
  const hasPowerProtection = hardwareNodes.some(node => node.type === 'ups' || node.type === 'pdu');

  let cpuCapacity = 0;
  let ramCapacityMb = 0;
  let storageCapacityGb = 0;
  let usedCpu = 0;
  let usedRamMb = 0;
  let usedStorageGb = 0;
  let totalPowerWatts = 0;
  let computeNodesWithSpecs = 0;

  hardwareNodes.forEach(node => {
    totalPowerWatts += node.power_draw || 0;
    node.internal_components?.forEach(component => {
      totalPowerWatts += component.power_draw || 0;
      if (nodeHasStorage(component.type as HardwareType)) {
        storageCapacityGb += parseSpecNumber(component.details?.storage);
      }
    });

    if (!isComputeNode(node.type)) return;

    const nodeCpu = parseSpecNumber(node.details?.cpu);
    const nodeRam = normalizeRamMb(node.details?.ram);
    const nodeStorage = parseSpecNumber(node.details?.storage);

    cpuCapacity += nodeCpu;
    ramCapacityMb += nodeRam;
    storageCapacityGb += nodeStorage;
    if (nodeCpu > 0 || nodeRam > 0 || nodeStorage > 0) computeNodesWithSpecs += 1;

    const usage = getVmResourceUsage(node.vms);
    usedCpu += usage.cpu;
    usedRamMb += usage.ramMb;
    usedStorageGb += usage.storageGb;
  });

  const validationErrorCount = validationIssues.filter(issue => issue.type === 'error').length;
  const validationWarningCount = validationIssues.filter(issue => issue.type === 'warning').length;
  const maxResourceUsage = Math.max(
    summarizeResourceUsage(usedCpu, cpuCapacity),
    summarizeResourceUsage(usedRamMb, ramCapacityMb),
    summarizeResourceUsage(usedStorageGb, storageCapacityGb),
  );

  const topologyScore = clampScore(
    (totalNodes > 0 ? 15 : 0) +
      (gateways.length > 0 ? 30 : 0) +
      (edges.length > 0 || totalNodes <= 1 ? 15 : 0) +
      (orphanNodes.length === 0 ? 25 : Math.max(0, 25 - orphanNodes.length * 8)) +
      (!hasCycle ? 15 : 5),
  );

  const addressingScore = clampScore(
    (networkNodes.length > 0 ? 20 : 0) +
      (gateways.some(node => !!node.ip || !!node.details?.lan_gateway_ip) ? 25 : 0) +
      (networkNodes.length > 0
        ? Math.round(((networkNodes.length - missingIPNodes.length) / networkNodes.length) * 35)
        : 0) +
      (validationErrorCount === 0 ? 15 : 0) +
      (validationWarningCount === 0 ? 5 : 0),
  );

  const capacityScore = clampScore(
    (computeNodes.length > 0 ? 25 : 0) +
      (vmCount > 0 ? 20 : 0) +
      (computeNodes.length > 0 ? Math.round((computeNodesWithSpecs / computeNodes.length) * 25) : 0) +
      (maxResourceUsage === 0 ? 10 : maxResourceUsage <= 75 ? 30 : maxResourceUsage <= 90 ? 18 : 5),
  );

  const deploymentScore = clampScore(
    (vmCount > 0 ? 35 : 0) +
      (missingIPNodes.length === 0 && networkNodes.length > 0 ? 25 : 0) +
      (validationErrorCount === 0 ? 20 : 0) +
      (computeNodes.length > 0 && gateways.length > 0 ? 20 : 0),
  );

  const resilienceScore = clampScore(
    (hasPowerProtection ? 35 : 10) +
      (gateways.length > 0 && networkNodes.length > 2 ? 20 : 0) +
      (computeNodes.length > 1 ? 20 : 8) +
      (totalPowerWatts > 0 ? 15 : 0) +
      (!hasCycle ? 10 : 0),
  );

  const sections: ReportSection[] = [
    {
      id: 'topology',
      label: 'Topology',
      score: topologyScore,
      message:
        gateways.length === 0
          ? 'No gateway or routing node is defined.'
          : orphanNodes.length > 0
            ? `${orphanNodes.length} network node${orphanNodes.length === 1 ? '' : 's'} cannot reach a gateway.`
            : hasCycle
              ? 'Core path is connected, with loop risk present.'
              : 'Core network path is connected.',
      icon: Network,
    },
    {
      id: 'addressing',
      label: 'IP Plan',
      score: addressingScore,
      message:
        missingIPNodes.length > 0
          ? `${missingIPNodes.length} network node${missingIPNodes.length === 1 ? '' : 's'} still need IPs.`
          : validationErrorCount > 0
            ? `${validationErrorCount} IP validation error${validationErrorCount === 1 ? '' : 's'} found.`
            : 'IP coverage is ready for this graph.',
      icon: Route,
    },
    {
      id: 'capacity',
      label: 'Capacity',
      score: capacityScore,
      message:
        computeNodes.length === 0
          ? 'No compute host is available for services.'
          : maxResourceUsage > 90
            ? 'One or more resources are over committed.'
            : vmCount === 0
              ? 'Compute is present, but no workloads are placed.'
              : 'Workloads fit the declared hardware envelope.',
      icon: Cpu,
    },
    {
      id: 'deployment',
      label: 'Deployment',
      score: deploymentScore,
      message:
        vmCount === 0
          ? 'Add containers or VMs before generating deployment files.'
          : missingIPNodes.length > 0
            ? 'Deployment files need a complete IP plan.'
            : 'Config generation has enough topology context.',
      icon: Server,
    },
    {
      id: 'resilience',
      label: 'Resilience',
      score: resilienceScore,
      message:
        !hasPowerProtection
          ? 'No UPS or PDU is included in the plan.'
          : computeNodes.length < 2
            ? 'Power is covered; compute is still a single-host design.'
            : 'Power and compute spread are represented.',
      icon: Battery,
    },
  ];

  const score = clampScore(sections.reduce((sum, section) => sum + section.score, 0) / sections.length);
  const tone = score >= 80 ? 'success' : score >= 55 ? 'warning' : 'critical';
  const grade = score >= 90 ? 'A' : score >= 80 ? 'B' : score >= 65 ? 'C' : score >= 50 ? 'D' : 'F';
  const headline =
    tone === 'success'
      ? 'This build is close to deployable.'
      : tone === 'warning'
        ? 'This build is promising, but has gaps.'
        : 'This build needs core planning work.';

  const actions: ActionItem[] = [];
  if (totalNodes === 0) {
    actions.push({ label: 'Add a gateway and first compute host.', tone: 'critical' });
  }
  if (gateways.length === 0) {
    actions.push({ label: 'Add a router, firewall, or routing-enabled server.', tone: 'critical' });
  }
  if (orphanNodes.length > 0) {
    actions.push({ label: `Connect ${orphanNodes.length} orphaned node${orphanNodes.length === 1 ? '' : 's'} to the routed graph.`, tone: 'critical' });
  }
  if (missingIPNodes.length > 0 || validationErrorCount > 0) {
    actions.push({ label: 'Reassign and validate IPs.', tone: validationErrorCount > 0 ? 'critical' : 'warning' });
  }
  if (computeNodes.length === 0) {
    actions.push({ label: 'Add a server, NAS, mini PC, SBC, or VPS for workloads.', tone: 'warning' });
  }
  if (computeNodes.length > 0 && computeNodesWithSpecs < computeNodes.length) {
    actions.push({ label: 'Fill CPU, RAM, and storage specs for every compute host.', tone: 'warning' });
  }
  if (vmCount === 0) {
    actions.push({ label: 'Place at least one VM or container onto a compute host.', tone: 'info' });
  }
  if (maxResourceUsage > 90) {
    actions.push({ label: 'Reduce workload load or increase host resources.', tone: 'critical' });
  }
  if (!hasPowerProtection && totalNodes > 1) {
    actions.push({ label: 'Add UPS/PDU coverage to make the plan operational.', tone: 'info' });
  }
  if (actions.length === 0) {
    actions.push({ label: 'Generate configs and export the diagram for the deployment runbook.', tone: 'success' });
  }

  return {
    score,
    grade,
    tone,
    headline,
    sections,
    actions: actions.slice(0, 5),
    stats: {
      totalNodes,
      networkNodes: networkNodes.length,
      computeNodes: computeNodes.length,
      vmCount,
      edgeCount: edges.length,
      totalPowerWatts,
      cpuCapacity,
      usedCpu,
      ramCapacityMb,
      usedRamMb,
      storageCapacityGb,
      usedStorageGb,
      missingIPCount: missingIPNodes.length,
      orphanCount: orphanNodes.length,
      validationErrorCount,
      validationWarningCount,
    },
  };
}

function StatTile({
  label,
  value,
  icon: Icon,
}: {
  label: string;
  value: string;
  icon: LucideIcon;
}) {
  return (
    <div className="rounded-md border border-border/70 bg-muted/20 p-3">
      <div className="flex items-center gap-2 text-xs text-muted-foreground">
        <Icon className="size-3.5" />
        <span>{label}</span>
      </div>
      <div className="mt-1 text-lg font-semibold tracking-tight">{value}</div>
    </div>
  );
}

export function ReadinessReportDialog({
  open,
  onOpenChange,
  hardwareNodes,
  edges,
  validationIssues,
  onGenerateConfig,
  onReassignIPs,
}: ReadinessReportDialogProps) {
  const report = useMemo(
    () => computeReadinessReport(hardwareNodes, edges, validationIssues),
    [hardwareNodes, edges, validationIssues],
  );

  const scoreColor =
    report.tone === 'success'
      ? 'text-emerald-500'
      : report.tone === 'warning'
        ? 'text-amber-500'
        : 'text-destructive';

  const scoreBar =
    report.tone === 'success'
      ? 'bg-emerald-500'
      : report.tone === 'warning'
        ? 'bg-amber-500'
        : 'bg-destructive';

  return (
    <Dialog open={open} onOpenChange={onOpenChange}>
      <DialogContent className="max-h-[88vh] max-w-5xl overflow-y-auto p-0">
        <div className="border-b bg-muted/20 px-6 py-5">
          <DialogHeader className="gap-3 sm:flex-row sm:items-start sm:justify-between sm:space-y-0">
            <div className="min-w-0 space-y-2">
              <Badge variant="outline" className="w-fit gap-1.5">
                <ClipboardCheck className="size-3.5" />
                Build Readiness
              </Badge>
              <div>
                <DialogTitle className="text-2xl">Deployment Readiness Report</DialogTitle>
                <DialogDescription>{report.headline}</DialogDescription>
              </div>
            </div>
            <div className="shrink-0 text-right">
              <div className={cn('text-5xl font-semibold leading-none tracking-tight', scoreColor)}>
                {report.grade}
              </div>
              <div className="mt-1 text-xs text-muted-foreground">{report.score}/100</div>
            </div>
          </DialogHeader>
          <Progress value={report.score} className="mt-5 h-2" indicatorClassName={scoreBar} />
        </div>

        <div className="space-y-6 px-6 py-5">
          <div className="grid gap-3 sm:grid-cols-2 lg:grid-cols-4">
            <StatTile icon={Network} label="Topology" value={`${report.stats.totalNodes} nodes / ${report.stats.edgeCount} links`} />
            <StatTile icon={Route} label="IP Coverage" value={`${report.stats.networkNodes - report.stats.missingIPCount}/${report.stats.networkNodes}`} />
            <StatTile icon={Cpu} label="Compute Load" value={`${report.stats.usedCpu}/${report.stats.cpuCapacity || 0} cores`} />
            <StatTile icon={Zap} label="Power Plan" value={report.stats.totalPowerWatts > 0 ? `${report.stats.totalPowerWatts} W` : 'Not set'} />
          </div>

          <div className="grid gap-4 lg:grid-cols-[1.2fr_0.8fr]">
            <section className="space-y-3">
              <div className="flex items-center gap-2 text-sm font-semibold">
                <Gauge className="size-4" />
                Planning Score
              </div>
              <div className="space-y-2">
                {report.sections.map(section => {
                  const Icon = section.icon;
                  return (
                    <div key={section.id} className="rounded-md border border-border/70 p-3">
                      <div className="flex items-start justify-between gap-3">
                        <div className="min-w-0">
                          <div className="flex items-center gap-2 text-sm font-medium">
                            <Icon className={cn('size-4', sectionTone(section.score))} />
                            <span>{section.label}</span>
                          </div>
                          <p className="mt-1 text-xs text-muted-foreground">{section.message}</p>
                        </div>
                        <span className={cn('font-mono text-sm font-semibold', sectionTone(section.score))}>
                          {section.score}
                        </span>
                      </div>
                      <Progress
                        value={section.score}
                        className="mt-3 h-1.5"
                        indicatorClassName={section.score >= 80 ? 'bg-emerald-500' : section.score >= 55 ? 'bg-amber-500' : 'bg-destructive'}
                      />
                    </div>
                  );
                })}
              </div>
            </section>

            <section className="space-y-3">
              <div className="flex items-center gap-2 text-sm font-semibold">
                <AlertTriangle className="size-4" />
                Action Queue
              </div>
              <div className="space-y-2">
                {report.actions.map(action => (
                  <div
                    key={action.label}
                    className={cn('rounded-md border px-3 py-2 text-sm', actionToneClass(action.tone))}
                  >
                    {action.label}
                  </div>
                ))}
              </div>

              <div className="rounded-md border border-border/70 bg-muted/20 p-3">
                <div className="text-sm font-semibold">Resource Envelope</div>
                <div className="mt-2 grid gap-2 text-xs text-muted-foreground">
                  <div className="flex justify-between gap-3">
                    <span>CPU</span>
                    <span className="font-mono text-foreground">
                      {report.stats.usedCpu}/{report.stats.cpuCapacity || 0} cores
                    </span>
                  </div>
                  <div className="flex justify-between gap-3">
                    <span>RAM</span>
                    <span className="font-mono text-foreground">
                      {formatRam(report.stats.usedRamMb)} / {formatRam(report.stats.ramCapacityMb)}
                    </span>
                  </div>
                  <div className="flex justify-between gap-3">
                    <span>Storage</span>
                    <span className="font-mono text-foreground">
                      {formatStorage(report.stats.usedStorageGb)} / {formatStorage(report.stats.storageCapacityGb)}
                    </span>
                  </div>
                  <div className="flex justify-between gap-3">
                    <span>Validation</span>
                    <span className="font-mono text-foreground">
                      {report.stats.validationErrorCount} errors / {report.stats.validationWarningCount} warnings
                    </span>
                  </div>
                </div>
              </div>
            </section>
          </div>
        </div>

        <DialogFooter className="border-t bg-muted/20 px-6 py-4">
          <Button variant="outline" onClick={() => void onReassignIPs()}>
            <Wand2 className="size-4" />
            Reassign IPs
          </Button>
          <Button onClick={onGenerateConfig}>
            <Download className="size-4" />
            Generate Config
          </Button>
        </DialogFooter>
      </DialogContent>
    </Dialog>
  );
}
