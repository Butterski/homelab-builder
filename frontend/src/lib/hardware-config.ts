import type { HardwareType } from '../types';

export interface HardwareFeatures {
  hasCPU: boolean;
  hasRAM: boolean;
  hasStorage: boolean;
  canHostVMs: boolean;
  isCompute: boolean; // Acts as compute node in live dashboard & node visuals
  hasDynamicPorts: boolean; // Renders dynamic port handles (e.g. switches, routers)
  isNetworked: boolean; // Assigned IPs by IPAM
  canBeNested: boolean; // Can be dragged into other nodes as an internal component
  canHostNested: boolean; // Can host other nested components inside it
}

export const HARDWARE_FEATURES: Record<HardwareType, HardwareFeatures> = {
  server:       { hasCPU: true,  hasRAM: true,  hasStorage: true,  canHostVMs: true,  isCompute: true,  hasDynamicPorts: false, isNetworked: true,  canBeNested: false, canHostNested: true },
  pc:           { hasCPU: true,  hasRAM: true,  hasStorage: true,  canHostVMs: true,  isCompute: true,  hasDynamicPorts: false, isNetworked: true,  canBeNested: false, canHostNested: true },
  minipc:       { hasCPU: true,  hasRAM: true,  hasStorage: true,  canHostVMs: true,  isCompute: true,  hasDynamicPorts: false, isNetworked: true,  canBeNested: false, canHostNested: true },
  sbc:          { hasCPU: true,  hasRAM: true,  hasStorage: true,  canHostVMs: true,  isCompute: true,  hasDynamicPorts: false, isNetworked: true,  canBeNested: false, canHostNested: true },
  iot:          { hasCPU: true,  hasRAM: true,  hasStorage: true,  canHostVMs: true,  isCompute: true,  hasDynamicPorts: false, isNetworked: true,  canBeNested: false, canHostNested: true },
  nas:          { hasCPU: true,  hasRAM: true,  hasStorage: true,  canHostVMs: true,  isCompute: true,  hasDynamicPorts: false, isNetworked: true,  canBeNested: false, canHostNested: true },
  router:       { hasCPU: false, hasRAM: false, hasStorage: false, canHostVMs: false, isCompute: false, hasDynamicPorts: true,  isNetworked: true,  canBeNested: false, canHostNested: false },
  switch:       { hasCPU: false, hasRAM: false, hasStorage: false, canHostVMs: false, isCompute: false, hasDynamicPorts: true,  isNetworked: true,  canBeNested: false, canHostNested: false },
  modem:        { hasCPU: false, hasRAM: false, hasStorage: false, canHostVMs: false, isCompute: false, hasDynamicPorts: true,  isNetworked: true,  canBeNested: false, canHostNested: false },
  ups:          { hasCPU: false, hasRAM: false, hasStorage: false, canHostVMs: false, isCompute: false, hasDynamicPorts: true,  isNetworked: false, canBeNested: false, canHostNested: false },
  disk:         { hasCPU: false, hasRAM: false, hasStorage: true,  canHostVMs: false, isCompute: false, hasDynamicPorts: false, isNetworked: false, canBeNested: true,  canHostNested: false },
  gpu:          { hasCPU: false, hasRAM: true,  hasStorage: false, canHostVMs: false, isCompute: false, hasDynamicPorts: false, isNetworked: false, canBeNested: true,  canHostNested: false }, // expects VRAM
  pdu:          { hasCPU: false, hasRAM: false, hasStorage: false, canHostVMs: false, isCompute: false, hasDynamicPorts: false, isNetworked: false, canBeNested: false, canHostNested: false },
  access_point: { hasCPU: false, hasRAM: false, hasStorage: false, canHostVMs: false, isCompute: false, hasDynamicPorts: false, isNetworked: true,  canBeNested: false, canHostNested: false },
  hba:          { hasCPU: false, hasRAM: false, hasStorage: false, canHostVMs: false, isCompute: false, hasDynamicPorts: false, isNetworked: false, canBeNested: true,  canHostNested: false },
  pcie:         { hasCPU: false, hasRAM: false, hasStorage: false, canHostVMs: false, isCompute: false, hasDynamicPorts: false, isNetworked: false, canBeNested: true,  canHostNested: false },
};

export const nodeHasCPU = (type: HardwareType) => HARDWARE_FEATURES[type]?.hasCPU ?? false;
export const nodeHasRAM = (type: HardwareType) => HARDWARE_FEATURES[type]?.hasRAM ?? false;
export const nodeHasStorage = (type: HardwareType) => HARDWARE_FEATURES[type]?.hasStorage ?? false;
export const canNodeHostVMs = (type: HardwareType) => HARDWARE_FEATURES[type]?.canHostVMs ?? false;
export const isComputeNode = (type: HardwareType) => HARDWARE_FEATURES[type]?.isCompute ?? false;
export const nodeHasDynamicPorts = (type: HardwareType) => HARDWARE_FEATURES[type]?.hasDynamicPorts ?? false;
export const isNetworkNode = (type: HardwareType) => HARDWARE_FEATURES[type]?.isNetworked ?? false;
export const canNodeBeNested = (type: HardwareType) => HARDWARE_FEATURES[type]?.canBeNested ?? false;
export const canNodeHostNested = (type: HardwareType) => HARDWARE_FEATURES[type]?.canHostNested ?? false;
