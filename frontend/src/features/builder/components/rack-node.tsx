import { memo, useMemo } from 'react';
import { type NodeProps } from '@xyflow/react';
import type { HardwareSpec } from '../../../types';
import { useBuilderStore } from '../store/builder-store';

// ─── Constants ──────────────────────────────────────────────────────────────

export const RACK_U_HEIGHT_PX = 90; // pixels per U slot
export const RACK_WIDTH_PX = 280;   // rack width in pixels
export const RACK_HEADER_PX = 40;   // header height
export const RACK_FOOTER_PX = 8;    // bottom padding
export const RACK_RAIL_WIDTH = 28;  // left rail for U numbers

// Default U-heights for device types
export const DEFAULT_DEVICE_U: Record<string, number> = {
  server: 2,
  switch: 1,
  router: 2,
  nas: 2,
  pc: 4,
  minipc: 1,
  sbc: 1,
  access_point: 1,
  ups: 4,
  pdu: 1,
  hba: 1,
  gpu: 2,
  disk: 1,
  pcie: 1,
  iot: 1,
  modem: 1,
};

type RackNodeData = {
  label: string;
  type: 'rack';
  id: string;
  details?: HardwareSpec;
};

// ─── Main RackNode component ────────────────────────────────────────────────

export const RackNode = memo(({ data, selected, id }: NodeProps) => {
  const nodeData = data as unknown as RackNodeData;
  const rackSize = nodeData.details?.rack_size || 24;
  const hardwareNodes = useBuilderStore(state => state.hardwareNodes);

  // Compute usedU dynamically from children in the store
  const usedU = useMemo(() => {
    return hardwareNodes
      .filter(n => n.parent_id === id)
      .reduce((sum, n) => sum + (n.details?.rack_units || DEFAULT_DEVICE_U[n.type] || 1), 0);
  }, [hardwareNodes, id]);

  const totalHeight = RACK_HEADER_PX + rackSize * RACK_U_HEIGHT_PX + RACK_FOOTER_PX;

  // Generate U-slot markers
  const uSlots = useMemo(() => {
    const slots = [];
    for (let u = 1; u <= rackSize; u++) {
      slots.push(u);
    }
    return slots;
  }, [rackSize]);

  const capacityPct = rackSize > 0 ? Math.round((usedU / rackSize) * 100) : 0;
  const isNearFull = capacityPct > 80;

  return (
    <div
      className="rack-node-container"
      style={{
        width: RACK_WIDTH_PX,
        height: totalHeight,
        borderColor: selected ? '#8b5cf6' : undefined,
      }}
    >
      {/* Rack Header */}
      <div className="rack-node-header">
        <div className="rack-node-header-title">
          <svg className="rack-node-icon" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2" strokeLinecap="round" strokeLinejoin="round">
            <rect x="2" y="2" width="20" height="20" rx="2" />
            <line x1="2" y1="8" x2="22" y2="8" />
            <line x1="2" y1="14" x2="22" y2="14" />
            <circle cx="18" cy="5" r="1" />
            <circle cx="18" cy="11" r="1" />
            <circle cx="18" cy="17" r="1" />
          </svg>
          <span className="rack-node-name" title={nodeData.label}>
            {nodeData.label}
          </span>
        </div>
        <span className={`rack-node-capacity ${isNearFull ? 'rack-node-capacity-warn' : ''}`}>
          {usedU}/{rackSize}U
        </span>
      </div>

      {/* Rack Body with U-slot grid */}
      <div className="rack-node-body" style={{ height: rackSize * RACK_U_HEIGHT_PX }}>
        {/* Left rail with U numbers */}
        <div className="rack-node-rail" style={{ width: RACK_RAIL_WIDTH }}>
          {uSlots.map(u => (
            <div
              key={u}
              className="rack-node-u-label"
              style={{ height: RACK_U_HEIGHT_PX }}
            >
              {u}
            </div>
          ))}
        </div>

        {/* Main slot area — children are rendered here by React Flow */}
        <div className="rack-node-slots">
          {uSlots.map(u => (
            <div
              key={u}
              className={`rack-node-slot ${u % 2 === 0 ? 'rack-node-slot-even' : ''}`}
              style={{ height: RACK_U_HEIGHT_PX }}
            />
          ))}
        </div>
      </div>
    </div>
  );
});

RackNode.displayName = 'RackNode';
