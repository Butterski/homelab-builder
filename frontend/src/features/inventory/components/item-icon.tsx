// The canvas draws a firewall as a shield, and this list uses the canvas's sign
// for every kind of device. avoid-ai-design-ignore: I3
import {
  Battery,
  BoxSelect,
  Cable,
  CircuitBoard,
  Cpu,
  Gamepad2,
  Globe,
  HardDrive,
  Layers,
  Monitor,
  Package,
  Plug,
  Printer,
  Router,
  Server,
  Shield,
  Wifi,
  type LucideIcon,
} from 'lucide-react';

const ICONS: Record<string, LucideIcon> = {
  server_v2: Server,
  minipc: Monitor,
  pc: Monitor,
  sbc: Cpu,
  nas: HardDrive,
  router: Router,
  switch: CircuitBoard,
  firewall: Shield,
  access_point: Wifi,
  modem: Globe,
  ups: Battery,
  pdu: Battery,
  rack: BoxSelect,
  console: Gamepad2,
  iot: Printer,
  ram: Layers,
  disk: HardDrive,
  gpu: Layers,
  nic: Plug,
  hba: Plug,
  cpu: Cpu,
  dac: Cable,
  sfp: Plug,
  cable: Cable,
};

/** The icon of an inventory item's type: the one the canvas uses for that kind of thing. */
export function ItemIcon({ type, className }: { type: string; className?: string }) {
  const Icon = ICONS[type] ?? Package;
  return <Icon className={className} aria-hidden="true" />;
}
