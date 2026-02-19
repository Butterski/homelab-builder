import { useState } from 'react';
import {
  BaseEdge,
  EdgeLabelRenderer,
  getSmoothStepPath,
  useReactFlow,
  type EdgeProps,
} from '@xyflow/react';
import { Button } from '../../../components/ui/button';
import { Settings2, X } from 'lucide-react';
import {
  Popover,
  PopoverContent,
  PopoverTrigger,
} from "../../../components/ui/popover";
import { Label } from "../../../components/ui/label";
import { Input } from "../../../components/ui/input";
import { 
  Select, 
  SelectContent, 
  SelectItem, 
  SelectTrigger, 
  SelectValue 
} from "../../../components/ui/select";
import { useBuilderStore } from '../store/builder-store';
 
const SPEED_COLORS: Record<string, string> = {
  '100 MbE': '#94a3b8',   // slate-400
  '1 GbE': '#3b82f6',     // blue-500
  '2.5 GbE': '#22c55e',   // green-500
  '10 GbE': '#a855f7',    // purple-500
  '40 GbE': '#f97316',    // orange-500
  '100 GbE': '#ef4444',   // red-500
};

export function CustomEdge({
  id,
  sourceX,
  sourceY,
  targetX,
  targetY,
  sourcePosition,
  targetPosition,
  style = {},
  markerEnd,
  selected,
  data,
}: EdgeProps) {
  const { deleteElements } = useReactFlow();
  const updateEdge = useBuilderStore(s => s.updateEdge);
  const [isHovered, setIsHovered] = useState(false);
  const [edgePath, labelX, labelY] = getSmoothStepPath({
    sourceX,
    sourceY,
    sourcePosition,
    targetX,
    targetY,
    targetPosition,
    borderRadius: 15,
  });
 
  const onEdgeClick = (evt: React.MouseEvent) => {
    evt.stopPropagation();
    deleteElements({ edges: [{ id }] });
  };

  const speed = (data?.speed as string) || '1 GbE';
  const subnet = (data?.subnet as string) || '';
  const edgeColor = SPEED_COLORS[speed] || '#f97316';

  const handleSpeedChange = (val: string) => {
    updateEdge(id, { data: { ...(data || {}), speed: val } });
  };

  const handleSubnetChange = (val: string) => {
    updateEdge(id, { data: { ...(data || {}), subnet: val } });
  };
 
  return (
    <g 
      onMouseEnter={() => setIsHovered(true)} 
      onMouseLeave={() => setIsHovered(false)}
      className="react-flow__edge-path-selector"
    >
      <path
        d={edgePath}
        fill="none"
        strokeOpacity={0}
        strokeWidth={20}
        className="cursor-pointer"
      />
      <BaseEdge 
        path={edgePath} 
        markerEnd={markerEnd} 
        style={{
          ...style,
          stroke: edgeColor,
          strokeWidth: selected ? Math.max(Number(style.strokeWidth || 2), 4) : (style.strokeWidth || 2),
          transition: 'stroke 0.2s, stroke-width 0.2s',
          filter: selected ? 'brightness(1.2)' : 'none'
        }} 
      />
      <EdgeLabelRenderer>
        <div
          style={{
            position: 'absolute',
            transform: `translate(-50%, -50%) translate(${labelX}px,${labelY}px)`,
            pointerEvents: 'all',
            zIndex: selected || isHovered ? 50 : 10,
          }}
          className="flex flex-col items-center gap-1 nodrag nopan"
          onMouseEnter={() => setIsHovered(true)}
          onMouseLeave={() => setIsHovered(false)}
        >
          {/* Always show the speed/subnet badge if configured, or on hover */}
          <div className={`px-1.5 py-0.5 rounded text-[9px] font-mono bg-background border shadow-sm transition-opacity ${(!isHovered && !selected && speed === '1 GbE' && !subnet) ? 'opacity-0' : 'opacity-100'}`}>
            <span className="text-primary font-semibold">{speed}</span>
            {subnet && <span className="ml-1 text-muted-foreground">({subnet})</span>}
          </div>

          <div 
            className={`flex items-center gap-1 transition-opacity ${(isHovered || selected) ? 'opacity-100' : 'opacity-0'} pointer-events-auto`}
          >
            <Popover>
              <PopoverTrigger asChild>
                <Button
                  variant="ghost" 
                  size="icon"
                  className="h-6 w-6 rounded-full bg-background border shadow-sm transition-all text-muted-foreground hover:text-foreground hover:bg-muted"
                  title="Configure Connection"
                >
                  <Settings2 className="h-3 w-3" />
                </Button>
              </PopoverTrigger>
              <PopoverContent className="w-60 p-3" side="top" align="center">
                <div className="space-y-3">
                  <div className="space-y-1">
                    <h4 className="font-semibold text-xs text-muted-foreground uppercase tracking-wider">Edge Settings</h4>
                  </div>
                  <div className="space-y-2">
                    <Label className="text-xs">Connection Speed</Label>
                    <Select value={speed} onValueChange={handleSpeedChange}>
                      <SelectTrigger className="h-8 text-xs">
                        <SelectValue placeholder="Select speed" />
                      </SelectTrigger>
                      <SelectContent>
                        <SelectItem value="100 MbE">100 MbE</SelectItem>
                        <SelectItem value="1 GbE">1 GbE</SelectItem>
                        <SelectItem value="2.5 GbE">2.5 GbE</SelectItem>
                        <SelectItem value="10 GbE">10 GbE</SelectItem>
                        <SelectItem value="40 GbE">40 GbE</SelectItem>
                        <SelectItem value="100 GbE">100 GbE</SelectItem>
                      </SelectContent>
                    </Select>
                  </div>
                  <div className="space-y-2">
                    <Label className="text-xs">Subnet / VLAN (Optional)</Label>
                    <Input 
                      placeholder="e.g. VLAN 10 or 192.168.2.0/24" 
                      className="h-8 text-xs" 
                      value={subnet}
                      onChange={(e) => handleSubnetChange(e.target.value)}
                    />
                  </div>
                </div>
              </PopoverContent>
            </Popover>

            <Button
              variant="ghost" 
              size="icon"
              className="h-6 w-6 rounded-full bg-background border shadow-sm hover:bg-destructive hover:text-destructive-foreground active:scale-95 transition-all text-muted-foreground"
              onClick={onEdgeClick}
              title="Delete Connection"
            >
              <X className="h-3 w-3" />
            </Button>
          </div>
        </div>
      </EdgeLabelRenderer>
    </g>
  );
}
