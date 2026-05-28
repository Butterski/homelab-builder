import { useState, useMemo } from 'react';
import { useBuilderStore } from '../store/builder-store';
import { Card } from '../../../components/ui/card';
import { Input } from '../../../components/ui/input';
import { Label } from '../../../components/ui/label';
import { Button } from '../../../components/ui/button';
import { Zap, Info, ChevronDown } from 'lucide-react';

interface PieChartStats {
  totalPower: number;
  devicePowers: Array<{ id: string; name: string; type: string; power: number }>;
  powerByType: Record<string, number>;
  monthlyCost: number;
  yearlyCost: number;
  dailyCost: number;
}

function PowerPieChart({ stats, colors }: { stats: PieChartStats; colors: string[] }) {
  if (stats.totalPower === 0) {
    return null;
  }

  const radius = 25;
  const cx = 40;
  const cy = 40;
  let currentAngle = -90;
  const slices: React.ReactNode[] = [];
  let colorIdx = 0;

  const sortedDevices = stats.devicePowers.filter(d => d.power > 0);

  sortedDevices.forEach(device => {
    const slicePercent = device.power / stats.totalPower;
    const sliceAngle = slicePercent * 360;
    const startAngle = currentAngle;
    const endAngle = currentAngle + sliceAngle;

    const x1 = cx + radius * Math.cos((startAngle * Math.PI) / 180);
    const y1 = cy + radius * Math.sin((startAngle * Math.PI) / 180);
    const x2 = cx + radius * Math.cos((endAngle * Math.PI) / 180);
    const y2 = cy + radius * Math.sin((endAngle * Math.PI) / 180);

    const largeArc = sliceAngle > 180 ? 1 : 0;
    const pathData = [
      `M ${cx} ${cy}`,
      `L ${x1} ${y1}`,
      `A ${radius} ${radius} 0 ${largeArc} 1 ${x2} ${y2}`,
      'Z',
    ].join(' ');

    slices.push(
      <path 
        key={device.id} 
        d={pathData} 
        fill={colors[colorIdx % colors.length]} 
        opacity="0.85"
        stroke="rgba(0,0,0,0.1)"
        strokeWidth="0.5"
      />
    );

    colorIdx++;
    currentAngle = endAngle;
  });

  return (
    <div className="flex flex-col gap-2">
      <svg viewBox="0 0 80 80" className="size-20 mx-auto">
        {slices}
      </svg>
      
      {/* Legend - Compact */}
      <div className="w-full space-y-1 text-[9px]">
        {sortedDevices.map((device, idx) => (
          <div key={device.id} className="flex items-center gap-2">
            <div
              className="size-2 rounded-full shrink-0"
              style={{ backgroundColor: colors[idx % colors.length] }}
            />
            <div className="min-w-0 flex-1 flex justify-between">
              <p className="truncate">{device.name}</p>
              <p className="text-muted-foreground">{((device.power / stats.totalPower) * 100).toFixed(0)}%</p>
            </div>
          </div>
        ))}
      </div>
    </div>
  );
}

export function PowerUsagePanel() {
  const { hardwareNodes, updateHardware } = useBuilderStore();
  const [costPerKwh, setCostPerKwh] = useState<number>(0.15);
  const [expandedNodeId, setExpandedNodeId] = useState<string | null>(null);
  const [showChart, setShowChart] = useState(false);

  // Calculate power statistics
  const stats = useMemo(() => {
    let totalPower = 0;
    const devicePowers: Array<{ id: string; name: string; type: string; power: number }> = [];
    const powerByType: Record<string, number> = {};

    hardwareNodes.forEach(node => {
      const nodePower = node.power_draw || 0;
      totalPower += nodePower;
      
      if (nodePower > 0) {
        devicePowers.push({
          id: node.id,
          name: node.name,
          type: node.type,
          power: nodePower,
        });
      }

      powerByType[node.type] = (powerByType[node.type] || 0) + nodePower;
    });

    devicePowers.sort((a, b) => b.power - a.power);

    const monthlyCost = (totalPower / 1000) * 730 * costPerKwh;
    const yearlyCost = monthlyCost * 12;
    const dailyCost = monthlyCost / 30;

    return {
      totalPower,
      devicePowers,
      powerByType,
      monthlyCost,
      yearlyCost,
      dailyCost,
    };
  }, [hardwareNodes, costPerKwh]);

  const handlePowerUpdate = (nodeId: string, newPower: number) => {
    const node = hardwareNodes.find(n => n.id === nodeId);
    if (!node) return;
    
    updateHardware(nodeId, {
      ...node,
      power_draw: Math.max(0, newPower),
    });
  };

  const powerTips: Record<string, [number, number]> = {
    router: [15, 150],
    switch: [5, 300],
    server: [300, 1200],
    nas: [30, 150],
    pc: [150, 400],
    minipc: [5, 50],
    sbc: [5, 25],
    access_point: [10, 30],
    ups: [50, 500],
    modem: [5, 20],
    iot: [1, 20],
    disk: [0, 0],
    gpu: [50, 350],
    hba: [10, 30],
    pcie: [0, 20],
    pdu: [10, 50],
    rack: [0, 0],
  };

  return (
    <div className="flex flex-col h-full overflow-y-auto">
      {/* Header */}
      <div className="sticky top-0 z-10 p-3 border-b border-border/50 bg-background/95 backdrop-blur">
        <div className="flex items-center gap-2">
          <Zap className="size-4 text-primary shrink-0" />
          <div>
            <h2 className="text-sm font-bold">Power Usage</h2>
            <p className="text-[10px] text-muted-foreground leading-tight">Consumption</p>
          </div>
        </div>
      </div>

      {/* Content */}
      <div className="flex-1 space-y-2 p-3">
        {/* Quick Stats - Single Row */}
        <div className="bg-secondary/40 rounded-lg p-2.5 space-y-1.5 text-[11px]">
          <div className="flex justify-between items-center">
            <span className="text-muted-foreground">Total:</span>
            <span className="font-bold text-primary">{stats.totalPower}W</span>
          </div>
          <div className="flex justify-between items-center">
            <span className="text-muted-foreground">Month:</span>
            <span className="font-bold text-emerald-600 dark:text-emerald-400">${stats.monthlyCost.toFixed(2)}</span>
          </div>
          <div className="flex justify-between items-center">
            <span className="text-muted-foreground">Year:</span>
            <span className="font-bold text-sky-600 dark:text-sky-400">${stats.yearlyCost.toFixed(2)}</span>
          </div>
        </div>

        {/* Electricity Rate */}
        <div className="space-y-1.5">
          <Label className="text-[10px] font-semibold block">Rate ($/kWh)</Label>
          <div className="flex gap-1.5">
            <Input
              type="number"
              value={costPerKwh}
              onChange={e => setCostPerKwh(parseFloat(e.target.value) || 0)}
              step={0.01}
              min={0}
              className="h-7 text-xs flex-1"
            />
            <Button
              variant="outline"
              size="sm"
              onClick={() => setCostPerKwh(0.15)}
              className="text-[9px] h-7 px-2"
            >
              Reset
            </Button>
          </div>
          <p className="text-[9px] text-muted-foreground leading-tight">
            US: 0.12-0.14 · EU: 0.20-0.30 · AU: 0.25-0.35
          </p>
        </div>

        {/* Pie Chart Toggle */}
        {stats.totalPower > 0 && (
          <Button
            variant="outline"
            size="sm"
            onClick={() => setShowChart(!showChart)}
            className="w-full text-xs h-7"
          >
            {showChart ? 'Hide' : 'Show'} Distribution
          </Button>
        )}

        {/* Power Distribution Visualization - Optional */}
        {showChart && stats.totalPower > 0 && (
          <Card className="p-2 border">
            <PowerPieChart stats={stats} colors={['#3b82f6', '#ef4444', '#10b981', '#f59e0b', '#8b5cf6', '#ec4899', '#06b6d4', '#6366f1', '#84cc16', '#f97316']} />
          </Card>
        )}

        {/* Device Assignment - Compact */}
        <div className="space-y-1.5">
          <div className="flex items-center justify-between px-1">
            <h3 className="text-[10px] font-bold uppercase tracking-wide">Devices</h3>
            <Button
              variant="ghost"
              size="sm"
              className="size-4 p-0"
              title="PSU wattage × 0.3-0.5 = typical draw"
            >
              <Info className="size-3" />
            </Button>
          </div>

          {hardwareNodes.length === 0 ? (
            <p className="text-[9px] text-muted-foreground p-2 text-center">Add nodes to assign power</p>
          ) : (
            <div className="space-y-1">
              {hardwareNodes.map(node => {
                const currentPower = node.power_draw || 0;
                const isExpanded = expandedNodeId === node.id;
                const tip = powerTips[node.type as keyof typeof powerTips];
                const [minTip, maxTip] = tip || [0, 0];
                const avgTip = tip ? Math.round((minTip + maxTip) / 2) : 0;

                return (
                  <div key={node.id}>
                    <button
                      type="button"
                      onClick={() => setExpandedNodeId(isExpanded ? null : node.id)}
                      className={`w-full p-2 flex items-center justify-between rounded-lg text-left text-[11px] transition-colors ${
                        currentPower > 0
                          ? 'bg-primary/10 border border-primary/30 hover:bg-primary/15'
                          : 'bg-secondary/20 border border-secondary/30 hover:bg-secondary/30'
                      }`}
                    >
                      <div className="min-w-0 flex-1">
                        <p className="font-semibold truncate">{node.name}</p>
                        <p className="text-[9px] text-muted-foreground capitalize">{node.type.replace('_', ' ')}</p>
                      </div>
                      <div className="flex items-center gap-2 shrink-0">
                        <span className={`font-bold ${currentPower > 0 ? 'text-primary' : 'text-muted-foreground'}`}>
                          {currentPower}W
                        </span>
                        <ChevronDown
                          className={`size-3.5 text-muted-foreground transition-transform ${isExpanded ? 'rotate-180' : ''}`}
                        />
                      </div>
                    </button>

                    {/* Expanded - Compact */}
                    {isExpanded && (
                      <div className="bg-secondary/20 rounded-b-lg p-2 border border-t-0 border-secondary/30 space-y-2">
                        {/* Input */}
                        <div>
                          <Label className="text-[9px] font-semibold">Draw (W)</Label>
                          <Input
                            type="number"
                            value={currentPower}
                            onChange={e =>
                              handlePowerUpdate(node.id, Math.max(0, parseInt(e.target.value, 10) || 0))
                            }
                            step={5}
                            min={0}
                            className="h-6 text-xs"
                          />
                        </div>

                        {/* Slider */}
                        <input
                          type="range"
                          min={0}
                          max={Math.max(300, (maxTip || 0) * 2)}
                          value={currentPower}
                          onChange={e =>
                            handlePowerUpdate(node.id, parseFloat(e.target.value))
                          }
                          className="w-full h-1.5 accent-primary cursor-pointer"
                        />

                        {/* Buttons - Stacked if needed */}
                        {tip && tip[0] > 0 && (
                          <div className="flex gap-1 flex-wrap">
                            <Button
                              variant="outline"
                              size="sm"
                              onClick={() => handlePowerUpdate(node.id, minTip)}
                              className="flex-1 min-w-fit text-[9px] h-6 px-2"
                            >
                              Min: {minTip}W
                            </Button>
                            <Button
                              variant="outline"
                              size="sm"
                              onClick={() => handlePowerUpdate(node.id, avgTip)}
                              className="flex-1 min-w-fit text-[9px] h-6 px-2"
                            >
                              Avg: {avgTip}W
                            </Button>
                            <Button
                              variant="outline"
                              size="sm"
                              onClick={() => handlePowerUpdate(node.id, maxTip)}
                              className="flex-1 min-w-fit text-[9px] h-6 px-2"
                            >
                              Max: {maxTip}W
                            </Button>
                          </div>
                        )}

                        {/* Inline Tips - Super compact */}
                        {tip && tip[0] > 0 && (
                          <div className="text-[9px] text-muted-foreground bg-background/60 rounded p-1.5 space-y-1">
                            <p className="font-semibold">Typical Range</p>
                            <div className="grid grid-cols-2 gap-1 text-[8px]">
                              <span>Idle: ~{minTip}W</span>
                              <span>Peak: ~{maxTip}W</span>
                            </div>
                          </div>
                        )}
                      </div>
                    )}
                  </div>
                );
              })}
            </div>
          )}
        </div>

        {/* Top Consumers - One line each */}
        {stats.devicePowers.length > 0 && (
          <div className="text-[10px] space-y-1 pt-1 border-t border-border/30">
            <p className="font-semibold text-muted-foreground uppercase tracking-wide text-[9px]">Top Draw</p>
            {stats.devicePowers.slice(0, 3).map(item => (
              <div key={item.id} className="flex justify-between items-center text-[10px] px-1">
                <span className="truncate flex-1">{item.name}</span>
                <span className="font-bold text-primary">{item.power}W</span>
              </div>
            ))}
          </div>
        )}
      </div>
    </div>
  );
}
