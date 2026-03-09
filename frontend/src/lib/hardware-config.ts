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
  canConnectToAny: boolean; // Can connect directly to any other node without needing a network hub
}

export const HARDWARE_FEATURES: Record<HardwareType, HardwareFeatures> = {
  server:       { hasCPU: true,  hasRAM: true,  hasStorage: true,  canHostVMs: true,  isCompute: true,  hasDynamicPorts: true, isNetworked: true,  canBeNested: false, canHostNested: true,  canConnectToAny: false },
  pc:           { hasCPU: true,  hasRAM: true,  hasStorage: true,  canHostVMs: true,  isCompute: true,  hasDynamicPorts: false, isNetworked: true,  canBeNested: false, canHostNested: true,  canConnectToAny: false },
  minipc:       { hasCPU: true,  hasRAM: true,  hasStorage: true,  canHostVMs: true,  isCompute: true,  hasDynamicPorts: false, isNetworked: true,  canBeNested: false, canHostNested: true,  canConnectToAny: false },
  sbc:          { hasCPU: true,  hasRAM: true,  hasStorage: true,  canHostVMs: true,  isCompute: true,  hasDynamicPorts: false, isNetworked: true,  canBeNested: false, canHostNested: true,  canConnectToAny: false },
  iot:          { hasCPU: true,  hasRAM: true,  hasStorage: true,  canHostVMs: true,  isCompute: true,  hasDynamicPorts: false, isNetworked: true,  canBeNested: false, canHostNested: true,  canConnectToAny: true },
  nas:          { hasCPU: true,  hasRAM: true,  hasStorage: true,  canHostVMs: true,  isCompute: true,  hasDynamicPorts: false, isNetworked: true,  canBeNested: false, canHostNested: true,  canConnectToAny: false },
  router:       { hasCPU: false, hasRAM: false, hasStorage: false, canHostVMs: false, isCompute: false, hasDynamicPorts: true,  isNetworked: true,  canBeNested: false, canHostNested: false, canConnectToAny: true },
  switch:       { hasCPU: false, hasRAM: false, hasStorage: false, canHostVMs: false, isCompute: false, hasDynamicPorts: true,  isNetworked: true,  canBeNested: false, canHostNested: false, canConnectToAny: true },
  modem:        { hasCPU: false, hasRAM: false, hasStorage: false, canHostVMs: false, isCompute: false, hasDynamicPorts: true,  isNetworked: true,  canBeNested: false, canHostNested: false, canConnectToAny: true },
  ups:          { hasCPU: false, hasRAM: false, hasStorage: false, canHostVMs: false, isCompute: false, hasDynamicPorts: true,  isNetworked: false, canBeNested: false, canHostNested: false, canConnectToAny: true },
  disk:         { hasCPU: false, hasRAM: false, hasStorage: true,  canHostVMs: false, isCompute: false, hasDynamicPorts: false, isNetworked: false, canBeNested: true,  canHostNested: false, canConnectToAny: false },
  gpu:          { hasCPU: false, hasRAM: true,  hasStorage: false, canHostVMs: false, isCompute: false, hasDynamicPorts: false, isNetworked: false, canBeNested: true,  canHostNested: false, canConnectToAny: false },
  pdu:          { hasCPU: false, hasRAM: false, hasStorage: false, canHostVMs: false, isCompute: false, hasDynamicPorts: false, isNetworked: false, canBeNested: false, canHostNested: false, canConnectToAny: false },
  access_point: { hasCPU: false, hasRAM: false, hasStorage: false, canHostVMs: false, isCompute: false, hasDynamicPorts: false, isNetworked: true,  canBeNested: false, canHostNested: false, canConnectToAny: false },
  hba:          { hasCPU: false, hasRAM: false, hasStorage: false, canHostVMs: false, isCompute: false, hasDynamicPorts: false, isNetworked: false, canBeNested: true,  canHostNested: false, canConnectToAny: true },
  pcie:         { hasCPU: false, hasRAM: false, hasStorage: false, canHostVMs: false, isCompute: false, hasDynamicPorts: false, isNetworked: false, canBeNested: true,  canHostNested: false, canConnectToAny: false },
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
export const canNodeConnectToAny = (type: HardwareType) => HARDWARE_FEATURES[type]?.canConnectToAny ?? false;
