// ─── Rack Node Constants ──────────────────────────────────────────────────

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
