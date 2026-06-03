import React, { useRef, useState } from 'react';
import {
  HardDrive,
  Router,
  CircuitBoard,
  Plug,
  Layers,
  Package,
  Search,
  Server,
  ChevronDown,
  ExternalLink,
  Book,
  Heart,
  Monitor,
  Cpu,
  Wifi,
  Battery,
  LayoutGrid,
  AppWindow,
  Zap,
  Printer,
  Globe,
  BoxSelect,
  Shield,
  Cloud,
  Plus,
} from 'lucide-react';
import type { HardwareType } from '../../../types';
import { Card } from '../../../components/ui/card';
import { useUserSelections } from '../../catalog/api/use-services';
import { useHardwareFavorites } from '../../catalog/api/use-hardware';
import { useHardwareBlueprints } from '../../catalog/api/use-hardware-blueprints';
import { useBuilderStore } from '../store/builder-store';
import { Github } from '../../../components/icons/github';
import { PowerUsagePanel } from './power-usage-panel';
import { HardwareBlueprintCreator } from '../../catalog/components/hardware-blueprint-creator';
import { hardwareBlueprintToDragData, hardwareComponentToDragData } from '../lib/catalog-mapper';

// ─── Basic component types ─────────────────────────────────────────────────────
const HARDWARE_TOOLS: {
  type: HardwareType;
  label: string;
  icon: React.ElementType;
  color: string;
}[] = [
  { type: 'router', label: 'Router', icon: Router, color: 'text-purple-500' },
  { type: 'switch', label: 'Switch', icon: CircuitBoard, color: 'text-blue-500' },
  { type: 'server_v2', label: 'Server', icon: Server, color: 'text-orange-500' },
  { type: 'firewall', label: 'Firewall', icon: Shield, color: 'text-red-500' },
  { type: 'vps', label: 'VPS', icon: Cloud, color: 'text-sky-500' },
  { type: 'pc', label: 'PC', icon: Monitor, color: 'text-cyan-500' },
  { type: 'minipc', label: 'Mini PC', icon: Monitor, color: 'text-sky-500' },
  { type: 'sbc', label: 'SBC', icon: Cpu, color: 'text-green-500' },
  { type: 'nas', label: 'NAS', icon: HardDrive, color: 'text-emerald-500' },
  { type: 'disk', label: 'Disk', icon: HardDrive, color: 'text-gray-400' },
  { type: 'access_point', label: 'AP', icon: Wifi, color: 'text-yellow-500' },
  { type: 'gpu', label: 'GPU', icon: Layers, color: 'text-pink-500' },
  { type: 'hba', label: 'HBA', icon: Plug, color: 'text-indigo-500' },
  { type: 'ups', label: 'UPS', icon: Battery, color: 'text-lime-500' },
  { type: 'iot', label: 'IoT', icon: Printer, color: 'text-yellow-600' },
  { type: 'modem', label: 'Modem', icon: Globe, color: 'text-blue-600' },
  { type: 'rack', label: 'Rack', icon: BoxSelect, color: 'text-violet-500' },
];

// ─── Preset library ────────────────────────────────────────────────────────────
const PRESETS: {
  category: string;
  items: {
    label: string;
    type: HardwareType;
    icon: React.ElementType;
    sub: string;
    data: object;
  }[];
}[] = [
  {
    category: 'Single Board Computers',
    items: [
      {
        label: 'Raspberry Pi 5 8GB',
        type: 'sbc',
        icon: Cpu,
        sub: 'BCM2712 · 8GB · ~$90',
        data: {
          name: 'Raspberry Pi 5',
          details: { model: 'Raspberry Pi 5 (8GB BCM2712)', cpu: 4, ram: 8, price_est: 90 },
        },
      },
      {
        label: 'Raspberry Pi 4 4GB',
        type: 'sbc',
        icon: Cpu,
        sub: 'BCM2711 · 4GB · ~$55',
        data: {
          name: 'Raspberry Pi 4',
          details: { model: 'Raspberry Pi 4 (4GB BCM2711)', cpu: 4, ram: 4, price_est: 55 },
        },
      },
      {
        label: 'Orange Pi 5 Plus',
        type: 'sbc',
        icon: Cpu,
        sub: 'RK3588 · 16GB · ~$110',
        data: {
          name: 'Orange Pi 5 Plus',
          details: { model: 'Orange Pi 5 Plus (RK3588)', cpu: 8, ram: 16, price_est: 110 },
        },
      },
    ],
  },
  {
    category: 'Mini PCs',
    items: [
      {
        label: 'Intel NUC 13 i7',
        type: 'minipc',
        icon: Monitor,
        sub: 'i7-1360P · 32GB · ~$650',
        data: {
          name: 'Intel NUC 13',
          details: { model: 'NUC13ANHi7 (i7-1360P)', cpu: 12, ram: 32, price_est: 650 },
        },
      },
      {
        label: 'Beelink EQ12',
        type: 'minipc',
        icon: Monitor,
        sub: 'N100 · 16GB · ~$180',
        data: {
          name: 'Beelink EQ12',
          details: { model: 'EQ12 (Intel N100)', cpu: 4, ram: 16, price_est: 180 },
        },
      },
      {
        label: 'Minisforum MS-01',
        type: 'minipc',
        icon: Monitor,
        sub: 'i9-12900H · 64GB · ~$600',
        data: {
          name: 'Minisforum MS-01',
          details: { model: 'MS-01 (i9-12900H)', cpu: 14, ram: 64, price_est: 600 },
        },
      },
      {
        label: 'Beelink SER6 Pro',
        type: 'minipc',
        icon: Monitor,
        sub: 'R7-6800H · 32GB · ~$350',
        data: {
          name: 'Beelink SER6 Pro',
          details: { model: 'SER6 Pro (Ryzen 7 6800H)', cpu: 8, ram: 32, price_est: 350 },
        },
      },
    ],
  },
  {
    category: 'Servers',
    items: [
      {
        label: 'Dell PowerEdge R720',
        type: 'server_v2',
        icon: Server,
        sub: '2× E5-2670 · 128GB · ~$300',
        data: {
          name: 'Dell R720',
          details: { model: 'PowerEdge R720 (2× Xeon E5-2670)', cpu: 16, ram: 128, ports: 4, server_profile: 'hypervisor', hypervisor_enabled: true, app_host_enabled: true, price_est: 300 },
        },
      },
      {
        label: 'HP ProLiant DL380 G9',
        type: 'server_v2',
        icon: Server,
        sub: '2× E5-2680v4 · 256GB · ~$500',
        data: {
          name: 'HP DL380 G9',
          details: {
            model: 'ProLiant DL380 G9 (2× Xeon E5-2680v4)',
            cpu: 28,
            ram: 256,
            ports: 4,
            server_profile: 'hypervisor',
            hypervisor_enabled: true,
            app_host_enabled: true,
            price_est: 500,
          },
        },
      },
      {
        label: 'Supermicro X10SL7',
        type: 'server_v2',
        icon: Server,
        sub: 'E3-1245v3 · 32GB · ~$200',
        data: {
          name: 'Supermicro X10SL7',
          details: { model: 'X10SL7-F (Xeon E3-1245v3)', cpu: 4, ram: 32, ports: 2, server_profile: 'storage', storage_enabled: true, app_host_enabled: true, price_est: 200 },
        },
      },
    ],
  },
  {
    category: 'Firewall / Cloud',
    items: [
      {
        label: 'OPNsense Firewall',
        type: 'firewall',
        icon: Shield,
        sub: 'NAT - DHCP - 4-port',
        data: {
          name: 'OPNsense Firewall',
          details: {
            model: 'OPNsense / pfSense appliance',
            ports: 4,
            firewall_enabled: true,
            nat_enabled: true,
            routing_enabled: true,
            dhcp_enabled: true,
            subnet_mask: '255.255.255.0',
            network_zone: 'lan',
          },
        },
      },
      {
        label: 'Hetzner VPS',
        type: 'vps',
        icon: Cloud,
        sub: 'Cloud node - public IP',
        data: {
          name: 'Cloud VPS',
          details: {
            model: 'Hetzner CX',
            cpu: 2,
            ram: 4,
            storage: 40,
            ports: 2,
            provider: 'Hetzner',
            region: 'eu-central',
            network_zone: 'cloud',
          },
        },
      },
      {
        label: 'Server Gateway',
        type: 'server_v2',
        icon: Server,
        sub: 'Server as NAT/router',
        data: {
          name: 'Gateway Server',
          details: {
            model: 'Linux gateway host',
            cpu: 8,
            ram: 32,
            storage: 512,
            ports: 4,
            server_profile: 'gateway',
            routing_enabled: true,
            nat_enabled: true,
            firewall_enabled: true,
            dhcp_enabled: true,
            subnet_mask: '255.255.255.0',
          },
        },
      },
    ],
  },
  {
    category: 'NAS / Storage',
    items: [
      {
        label: 'Synology DS923+',
        type: 'nas',
        icon: HardDrive,
        sub: 'R1600 · 4GB · ~$550',
        data: {
          name: 'Synology DS923+',
          details: { model: 'DS923+ (Ryzen R1600)', cpu: 2, ram: 4, price_est: 550 },
        },
      },
      {
        label: 'Synology DS1522+',
        type: 'nas',
        icon: HardDrive,
        sub: 'R1600 · 8GB · ~$700',
        data: {
          name: 'Synology DS1522+',
          details: { model: 'DS1522+ (Ryzen R1600)', cpu: 2, ram: 8, price_est: 700 },
        },
      },
      {
        label: 'QNAP TS-464',
        type: 'nas',
        icon: HardDrive,
        sub: 'N5105 · 8GB · ~$500',
        data: {
          name: 'QNAP TS-464',
          details: { model: 'TS-464 (Intel N5105)', cpu: 4, ram: 8, price_est: 500 },
        },
      },
    ],
  },
  {
    category: 'Networking',
    items: [
      {
        label: 'Unifi UDM Pro',
        type: 'router',
        icon: Router,
        sub: 'Quad-core · 4GB · ~$380',
        data: {
          name: 'UDM Pro',
          details: { model: 'UniFi Dream Machine Pro', cpu: 4, ram: 4, price_est: 380 },
        },
      },
      {
        label: 'Cable Modem',
        type: 'modem',
        icon: Globe,
        sub: 'DOCSIS 3.1 · 1-port · ~$150',
        data: {
          name: 'Cable Modem',
          details: { model: 'Arris S33', ports: 1, price_est: 150 },
        },
      },
      {
        label: 'Unifi USW-24-PoE',
        type: 'switch',
        icon: CircuitBoard,
        sub: '24-port PoE · ~$300',
        data: {
          name: 'USW-24-PoE',
          details: { model: 'UniFi Switch 24 PoE', ports: 24, price_est: 300 },
        },
      },
      {
        label: 'TP-Link TL-SG108E',
        type: 'switch',
        icon: CircuitBoard,
        sub: '8-port managed · ~$30',
        data: {
          name: 'TL-SG108E',
          details: { model: 'TP-Link TL-SG108E', ports: 8, price_est: 30 },
        },
      },
    ],
  },
  {
    category: 'Add-in Cards',
    items: [
      {
        label: 'LSI 9300-8i HBA',
        type: 'hba',
        icon: Plug,
        sub: 'PCIe 3.0 · 8-port SAS/SATA · ~$80',
        data: {
          name: 'LSI 9300-8i',
          details: { model: 'LSI SAS 9300-8i', ports: 8, price_est: 80 },
        },
      },
      {
        label: 'NVIDIA RTX 3060',
        type: 'gpu',
        icon: Layers,
        sub: '12GB VRAM · ~$300',
        data: {
          name: 'RTX 3060',
          details: { model: 'NVIDIA GeForce RTX 3060', ram: 12, price_est: 300 },
        },
      },
      {
        label: 'Intel X550-T2 NIC',
        type: 'hba',
        icon: Plug,
        sub: '2× 10GbE · ~$120',
        data: {
          name: 'Intel X550-T2',
          details: { model: 'Intel X550-T2', ports: 2, price_est: 120 },
        },
      },
    ],
  },
  {
    category: 'Storage Drives',
    items: [
      {
        label: 'Seagate Exos 8TB',
        type: 'disk',
        icon: HardDrive,
        sub: 'HDD · SATA · ~$150',
        data: {
          name: 'Seagate Exos 8TB',
          details: { model: 'Seagate Exos X18 8TB', storage: 8000, price_est: 150 },
        },
      },
      {
        label: 'Samsung 870 EVO 2TB',
        type: 'disk',
        icon: HardDrive,
        sub: 'SSD · SATA · ~$130',
        data: {
          name: 'Samsung 870 EVO 2TB',
          details: { model: 'Samsung 870 EVO', storage: 2000, price_est: 130 },
        },
      },
      {
        label: 'WD Red Plus 4TB',
        type: 'disk',
        icon: HardDrive,
        sub: 'HDD · NAS-optimized · ~$90',
        data: {
          name: 'WD Red Plus 4TB',
          details: { model: 'WD Red Plus', storage: 4000, price_est: 90 },
        },
      },
    ],
  },
  {
    category: 'IoT & Peripherals',
    items: [
      {
        label: 'Network Printer',
        type: 'iot',
        icon: Printer,
        sub: 'Laser · Ethernet/Wi-Fi',
        data: {
          name: 'Printer',
          details: { model: 'Brother HL-L2390DW', price_est: 150 },
        },
      },
      {
        label: 'Smart Hub',
        type: 'iot',
        icon: Printer,
        sub: 'Zigbee/Z-Wave',
        data: {
          name: 'Home Assistant Hub',
          details: { model: 'Home Assistant Yellow', price_est: 120 },
        },
      },
    ],
  },
  {
    category: 'Server Racks',
    items: [
      {
        label: '4U Wall Mount',
        type: 'rack' as HardwareType,
        icon: BoxSelect,
        sub: '4U · Desktop / Wall mount',
        data: {
          name: '4U Rack',
          details: { model: '4U Wall Mount Enclosure', rack_size: 4 },
        },
      },
      {
        label: '12U Cabinet',
        type: 'rack' as HardwareType,
        icon: BoxSelect,
        sub: '12U · Small cabinet',
        data: {
          name: '12U Cabinet',
          details: { model: '12U Network Cabinet', rack_size: 12 },
        },
      },
      {
        label: '24U Half Rack',
        type: 'rack' as HardwareType,
        icon: BoxSelect,
        sub: '24U · Standard homelab',
        data: {
          name: '24U Rack',
          details: { model: '24U Server Rack', rack_size: 24 },
        },
      },
      {
        label: '42U Full Rack',
        type: 'rack' as HardwareType,
        icon: BoxSelect,
        sub: '42U · Full height',
        data: {
          name: '42U Rack',
          details: { model: '42U Full Server Rack', rack_size: 42 },
        },
      },
    ],
  },
];

export const HardwareToolbox = React.memo(function HardwareToolbox() {
  const { availableServices, fetchServices } = useBuilderStore();
  const { data: selectionsData } = useUserSelections();
  const { data: favoritesData } = useHardwareFavorites();
  const { data: blueprintsData } = useHardwareBlueprints();

  React.useEffect(() => {
    fetchServices();
  }, [fetchServices]);

  // Memoize VALID_HARDWARE_TYPES outside component to avoid recreating on each render
  const VALID_HARDWARE_TYPES = React.useMemo(() => new Set<string>([
    'router', 'switch', 'nas', 'server', 'server_v2', 'firewall', 'vps', 'pc', 'access_point',
    'disk', 'gpu', 'hba', 'pcie', 'ups', 'pdu', 'sbc', 'minipc',
    'iot', 'modem', 'rack'
  ]), []);

  const [activeTab, setActiveTab] = useState<'components' | 'presets' | 'services' | 'power'>('components');
  const [expandedCategories, setExpandedCategories] = useState<Set<string>>(
    new Set(['My Blueprints', 'My Favorites', 'Single Board Computers', 'Mini PCs']),
  );
  const [collapsedServiceCats, setCollapsedServiceCats] = useState<Set<string>>(new Set());
  const [searchQuery, setSearchQuery] = useState('');
  const [isMinimized, setIsMinimized] = useState(false);
  const [position, setPosition] = useState({ x: 16, y: 80 });
  const [isDragging, setIsDragging] = useState(false);
  const [creatorOpen, setCreatorOpen] = useState(false);
  // Ref for drag offset tracking
  const dragOffset = useRef({ x: 0, y: 0 });
  const isDraggingRef = useRef(false);

  const favorites = React.useMemo(() => favoritesData?.data || [], [favoritesData]);
  const blueprints = React.useMemo(() => blueprintsData?.data || [], [blueprintsData]);

  // Dynamic presets combining static presets + My Favorites!
  const dynamicPresets = React.useMemo(() => {
    const list = [...PRESETS];

    if (blueprints.length > 0) {
      list.unshift({
        category: 'My Blueprints',
        items: blueprints.map(blueprint => ({
          label: blueprint.name,
          type: blueprint.node_type,
          icon: Server,
          sub: `${blueprint.services?.length || 0} services - ${blueprint.visibility}`,
          data: hardwareBlueprintToDragData(blueprint),
        })),
      });
    }

    // Single iteration: combine flatMap+map+filter for performance
    const favoriteItems: any[] = [];
    for (const fav of favorites) {
      const comp = fav.hardware_component;
      if (!comp) continue;

      const dragData = hardwareComponentToDragData(comp);
      const type: string = dragData.type;
      if (!VALID_HARDWARE_TYPES.has(type)) continue;

      const spec = comp.spec || {};
      const details: any = dragData.details || {};

      let rack_units = spec.rack_units;
      if (!rack_units && spec.form_factor && typeof spec.form_factor === 'string') {
        const uMatch = spec.form_factor.match(/(\d+)U/i);
        if (uMatch) {
          rack_units = parseInt(uMatch[1], 10);
        }
      }
      if (rack_units) details.rack_units = Number(rack_units);

      let rack_size = spec.units ? Number(spec.units) : undefined;
      if (spec.rack_size) {
        rack_size = Number(spec.rack_size);
      }
      if (rack_size) details.rack_size = rack_size;

      const name = `${comp.brand} ${comp.model}`;
      
      let icon: React.ElementType = Package;
      if (type === 'router') icon = Router;
      else if (type === 'switch') icon = CircuitBoard;
      else if (type === 'server' || type === 'server_v2') icon = Server;
      else if (type === 'firewall') icon = Shield;
      else if (type === 'vps') icon = Cloud;
      else if (type === 'pc' || type === 'minipc') icon = Monitor;
      else if (type === 'sbc') icon = Cpu;
      else if (type === 'nas' || type === 'disk') icon = HardDrive;
      else if (type === 'access_point') icon = Wifi;
      else if (type === 'gpu') icon = Layers;
      else if (type === 'hba' || type === 'pcie') icon = Plug;
      else if (type === 'ups' || type === 'pdu') icon = Battery;
      else if (type === 'iot') icon = Printer;
      else if (type === 'modem') icon = Globe;
      else if (type === 'rack') icon = BoxSelect;

      let sub = `${comp.brand} · ~${comp.price_est} ${comp.currency}`;
      if (comp.category === 'server' || comp.category === 'minipc' || comp.category === 'sbc') {
        const cpuStr = spec.cpu ? String(spec.cpu).split(' ')[0] : '';
        const ramStr = spec.ram ? String(spec.ram).split(' ')[0] : '';
        sub = `${cpuStr}${cpuStr && ramStr ? ' · ' : ''}${ramStr} · ~${comp.price_est} ${comp.currency}`;
      } else if (comp.category === 'router' || comp.category === 'switch') {
        const portsStr = spec.ports ? String(spec.ports) : '';
        sub = `${portsStr} · ~${comp.price_est} ${comp.currency}`;
      }

      favoriteItems.push({
        label: name,
        type: type as HardwareType,
        icon,
        sub,
        data: dragData,
      });
    }

    if (favoriteItems.length > 0) {
      list.unshift({
        category: 'My Favorites',
        items: favoriteItems,
      });
    }

    return list;
  }, [blueprints, favorites]);

  const handleMouseDown = (e: React.MouseEvent) => {
    if ((e.target as HTMLElement).closest('button')) return;
    setIsDragging(true);
    isDraggingRef.current = true;
    dragOffset.current.x = e.clientX - position.x;
    dragOffset.current.y = e.clientY - position.y;
  };

  // Global listeners for drag - stable refs pattern to avoid stale closures
  React.useEffect(() => {
    const onMouseMove = (e: MouseEvent) => {
      if (!isDraggingRef.current) return;
      setPosition({
        x: e.clientX - dragOffset.current.x,
        y: e.clientY - dragOffset.current.y,
      });
    };
    const onMouseUp = () => {
      setIsDragging(false);
      isDraggingRef.current = false;
    };
    window.addEventListener('mousemove', onMouseMove);
    window.addEventListener('mouseup', onMouseUp);
    return () => {
      window.removeEventListener('mousemove', onMouseMove);
      window.removeEventListener('mouseup', onMouseUp);
    };
  }, []);

  const onDragStart = (event: React.DragEvent, nodeType: HardwareType, data?: object) => {
    event.dataTransfer.setData('application/reactflow', nodeType);
    if (data) {
      event.dataTransfer.setData(
        'application/reactflow-data',
        JSON.stringify({ type: nodeType, ...data }),
      );
    }
    event.dataTransfer.effectAllowed = 'move';
  };

  const toggleCategory = (cat: string) => {
    setExpandedCategories(prev => {
      const next = new Set(prev);
      if (next.has(cat)) next.delete(cat);
      else next.add(cat);
      return next;
    });
  };

  const toggleServiceCat = (cat: string) => {
    setCollapsedServiceCats(prev => {
      const next = new Set(prev);
      if (next.has(cat)) next.delete(cat);
      else next.add(cat);
      return next;
    });
  };

  // Filter and group services
  const favServiceIds = new Set(selectionsData?.data?.map(s => s.service_id) || []);

  // Single iteration: combine filter + reduce for performance
  const servicesByCategory = availableServices.reduce(
    (acc, svc) => {
      const lowQ = searchQuery.toLowerCase();
      const matchesSearch =
        lowQ === '' ||
        svc.name.toLowerCase().includes(lowQ) ||
        svc.description.toLowerCase().includes(lowQ) ||
        svc.category.toLowerCase().includes(lowQ) ||
        (lowQ === 'favorites' && favServiceIds.has(svc.id));

      if (!matchesSearch) return acc;

      if (!acc[svc.category]) acc[svc.category] = [];
      acc[svc.category].push(svc);

      if (favServiceIds.has(svc.id)) {
        if (!acc['Favorites']) acc['Favorites'] = [];
        acc['Favorites'].push(svc);
      }

      return acc;
    },
    {} as Record<string, typeof availableServices>,
  );

  const sortedServiceCategories = Object.entries(servicesByCategory).sort((a, b) => {
    if (a[0] === 'Favorites') return -1;
    if (b[0] === 'Favorites') return 1;
    return a[0].localeCompare(b[0]);
  });

  return (
    <>
    <HardwareBlueprintCreator open={creatorOpen} onClose={() => setCreatorOpen(false)} />
    <Card
      className="builder-floating-panel absolute z-50 flex flex-col overflow-hidden"
      style={{
        left: position.x,
        top: position.y,
        width: isMinimized ? 'auto' : '19rem',
        maxHeight: isMinimized ? 'auto' : 'calc(100vh - 8rem)',
        cursor: isDragging ? 'grabbing' : 'auto',
      }}
    >
      {/* Header / Drag Handle */}
      <div
        className="flex cursor-grab select-none items-center justify-between border-b bg-muted/35 px-4 py-3 active:cursor-grabbing"
        onMouseDown={handleMouseDown}
        role="presentation"
      >
        <div className="flex items-center gap-2">
          <span className="font-bold text-xs uppercase tracking-wider text-foreground">
            Library
          </span>
        </div>
        <button
          type="button"
          onClick={() => setIsMinimized(!isMinimized)}
          className="size-4 flex items-center justify-center rounded hover:bg-background/50 text-muted-foreground"
          title={isMinimized ? 'Expand' : 'Minimize'}
          aria-label={isMinimized ? 'Expand library panel' : 'Minimize library panel'}
        >
          {isMinimized ? (
            <ChevronDown className="size-3 hover:cursor-pointer" />
          ) : (
            <ChevronDown className="size-3 hover:cursor-pointer rotate-180" />
          )}
        </button>
      </div>

      {!isMinimized && (
        <>
          {/* Tab bar */}
          <div className="grid grid-cols-4 border-b shrink-0 bg-card px-2 pt-2 gap-1">
            {(
              [
                { id: 'components', label: 'Types', icon: LayoutGrid },
                { id: 'presets', label: 'Presets', icon: Package },
                { id: 'services', label: 'Services', icon: AppWindow },
                { id: 'power', label: 'Power', icon: Zap },
              ] as const
            ).map(tab => {
              const Icon = tab.icon;
              return (
                <button
                  key={tab.id}
                  type="button"
                  onClick={() => setActiveTab(tab.id)}
                  className={`flex flex-col items-center gap-1 rounded-t-md px-2 py-2 text-[10px] font-semibold uppercase tracking-wide transition-colors ${tab.id === 'services' ? 'tour-toolbox-services' : ''} ${
                    activeTab === tab.id
                      ? 'bg-primary/10 text-primary shadow-[inset_0_-2px_0_var(--primary)]'
                      : 'text-muted-foreground hover:bg-muted/50 hover:text-foreground'
                  }`}
                >
                  <Icon className="size-3.5" />
                  {tab.label}
                </button>
              );
            })}
          </div>

          <div className="tour-toolbox overflow-y-auto flex-1 p-4">
            {/* ── Components tab ── */}
            {activeTab === 'components' && (
              <div className="space-y-3">
                <p className="text-[11px] text-muted-foreground">
                  Drag any component onto the canvas
                </p>
                <div className="grid grid-cols-3 gap-2">
                  {HARDWARE_TOOLS.map(tool => {
                    const Icon = tool.icon;
                    return (
                      <div
                        key={tool.type}
                        className="builder-tool-tile flex min-h-14 cursor-grab flex-col items-center justify-center p-2.5 active:cursor-grabbing"
                        onDragStart={e => onDragStart(e, tool.type)}
                        draggable
                      >
                        <Icon className={`size-4 mb-1.5 ${tool.color}`} />
                        <span className="text-[9px] font-medium text-center leading-tight">
                          {tool.label}
                        </span>
                      </div>
                    );
                  })}
                </div>
              </div>
            )}

            {/* ── Presets tab ── */}
            {activeTab === 'presets' && (
              <div className="space-y-1">
                <button
                  type="button"
                  className="mb-2 flex w-full items-center justify-center gap-1.5 rounded-md border border-primary/30 bg-primary/10 px-2.5 py-2 text-[10px] font-bold uppercase tracking-wide text-primary hover:bg-primary/15"
                  onClick={() => setCreatorOpen(true)}
                >
                  <Plus className="size-3.5" />
                  New Blueprint
                </button>
                {dynamicPresets.map(cat => {
                  const isOpen = expandedCategories.has(cat.category);
                  return (
                    <div key={cat.category} className="app-surface overflow-hidden rounded-lg">
                      <button
                        type="button"
                        className="flex w-full items-center justify-between bg-muted/35 px-2.5 py-2 text-[10px] font-bold uppercase tracking-wide transition-colors hover:bg-muted/60 focus-visible:outline-none focus-visible:ring-1 focus-visible:ring-ring"
                        onClick={() => toggleCategory(cat.category)}
                      >
                        {cat.category}
                        <ChevronDown
                          className={`size-3 transition-transform duration-200 hover:cursor-pointer ${isOpen ? 'rotate-180' : ''}`}
                        />
                      </button>
                      <div
                        className="grid transition-[grid-template-rows] duration-300 ease-in-out"
                        style={{ gridTemplateRows: isOpen ? '1fr' : '0fr' }}
                      >
                        <div className="overflow-hidden">
                          <div className="divide-y">
                            {cat.items.map(preset => {
                              const Icon = preset.icon;
                              return (
                                <div
                                  key={preset.label}
                                  className="flex cursor-grab items-center gap-2 px-2.5 py-2 transition-colors hover:bg-primary/5 active:cursor-grabbing"
                                  onDragStart={e => onDragStart(e, preset.type, preset.data)}
                                  draggable
                                >
                                  <Icon className="size-3.5 text-primary shrink-0" />
                                  <div className="min-w-0">
                                    <p className="text-[10px] font-semibold truncate">
                                      {preset.label}
                                    </p>
                                    <p className="text-[9px] text-muted-foreground truncate">
                                      {preset.sub}
                                    </p>
                                  </div>
                                </div>
                              );
                            })}
                          </div>
                        </div>
                      </div>
                    </div>
                  );
                })}
              </div>
            )}

            {/* ── Services tab ── */}
            {activeTab === 'services' && (
              <div className="space-y-2">
                <p className="text-[10px] text-muted-foreground mb-2">
                  Drag a service to assign to a server/PC node
                </p>

                <div className="relative mb-3">
                  <Search className="absolute left-2 top-1.5 size-3.5 text-muted-foreground" />
                  <input
                    type="text"
                    placeholder="Search services..."
                    value={searchQuery}
                    onChange={e => {
                      setSearchQuery(e.target.value);
                      // auto-expand all categories when searching
                      if (e.target.value.length > 0) {
                        setCollapsedServiceCats(new Set());
                      }
                    }}
                    className="pl-7 pr-3 py-1 text-xs w-full bg-background border rounded-md focus:outline-none focus:border-primary/50 transition-colors"
                  />
                </div>

                <div className="space-y-1">
                  {sortedServiceCategories.length === 0 && (
                    <div className="text-center py-6 space-y-2">
                      <p className="text-xs text-muted-foreground">No services found…</p>
                    </div>
                  )}

                  {sortedServiceCategories.map(([catName, svcs]) => {
                    // Auto-expand if searchQuery is active, else check if NOT in collapsed set
                    const isEffectivelyOpen =
                      searchQuery !== '' ? true : !collapsedServiceCats.has(catName);

                    return (
                      <div key={catName} className="app-surface overflow-hidden rounded-lg">
                        <button
                          type="button"
                          className="flex w-full items-center justify-between bg-muted/35 px-2.5 py-2 text-[10px] font-bold uppercase tracking-wide transition-colors hover:bg-muted/60 focus-visible:outline-none focus-visible:ring-1 focus-visible:ring-ring"
                          onClick={() => toggleServiceCat(catName)}
                        >
                          <span className="flex items-center gap-1.5 focus:outline-none">
                            {catName === 'Favorites' && (
                              <Heart className="size-3 fill-red-500 text-red-500" />
                            )}
                            {catName}
                          </span>
                          <div className="flex items-center gap-2">
                            <span className="text-[9px] text-muted-foreground px-1.5 py-0.5 bg-background rounded-full">
                              {svcs.length}
                            </span>
                            <ChevronDown
                              className={`size-3 transition-transform duration-200 hover:cursor-pointer ${isEffectivelyOpen ? 'rotate-180' : ''}`}
                            />
                          </div>
                        </button>

                        <div
                          className="grid transition-[grid-template-rows] duration-300 ease-in-out"
                          style={{ gridTemplateRows: isEffectivelyOpen ? '1fr' : '0fr' }}
                        >
                          <div className="overflow-hidden">
                            <div className="divide-y divide-border/50">
                              {svcs.map(svc => (
                                <div
                                  key={svc.id}
                                  className="group flex cursor-grab items-center justify-between gap-2 bg-card px-2.5 py-2 transition-colors hover:bg-primary/5 active:cursor-grabbing"
                                  onDragStart={e => {
                                    e.dataTransfer.setData('application/reactflow', 'server_v2');
                                    e.dataTransfer.setData('service-drag', 'true');
                                    e.dataTransfer.setData(
                                      'application/reactflow-data',
                                      JSON.stringify({
                                        type: 'server_v2',
                                        name: svc.name,
                                        details: {
                                          model: svc.name,
                                          cpu: svc.requirements
                                            ? svc.requirements.min_cpu_cores
                                            : undefined,
                                          ram: svc.requirements
                                            ? svc.requirements.min_ram_mb
                                            : undefined,
                                        },
                                        serviceId: svc.id,
                                      }),
                                    );
                                    e.dataTransfer.effectAllowed = 'move';
                                  }}
                                  draggable
                                >
                                  <div className="flex items-center gap-2 min-w-0">
                                    <div className="size-6 rounded bg-primary/10 flex items-center justify-center shrink-0">
                                      {svc.icon ? (
                                        <Zap className="size-3 text-primary" />
                                      ) : (
                                        <Zap className="size-3 text-primary" />
                                      )}
                                    </div>
                                    <div className="min-w-0 flex flex-col">
                                      <p className="text-[10px] font-semibold truncate leading-tight group-hover:text-primary transition-colors">
                                        {svc.name}
                                      </p>
                                      {svc.requirements && (
                                        <p className="text-[9px] text-muted-foreground truncate leading-tight mt-0.5">
                                          {svc.requirements.min_cpu_cores}vCPU ·{' '}
                                          {svc.requirements.min_ram_mb >= 1024
                                            ? `${(svc.requirements.min_ram_mb / 1024).toFixed(1)}GB`
                                            : `${svc.requirements.min_ram_mb}MB`}{' '}
                                          RAM
                                        </p>
                                      )}
                                    </div>
                                  </div>

                                  {/* Metadata Link Buttons */}
                                  <div
                                    className="flex items-center gap-1 opacity-10 group-hover:opacity-100 transition-opacity"
                                    onMouseDown={e => {
                                      e.stopPropagation();
                                    }}
                                  >
                                    {svc.docs_url && (
                                      <a
                                        href={svc.docs_url}
                                        target="_blank"
                                        rel="noopener noreferrer"
                                        className="p-1 hover:bg-muted rounded"
                                        title="Documentation"
                                      >
                                        <Book className="size-3 text-emerald-500" />
                                      </a>
                                    )}
                                    {svc.github_url && (
                                      <a
                                        href={svc.github_url}
                                        target="_blank"
                                        rel="noopener noreferrer"
                                        className="p-1 hover:bg-muted rounded"
                                        title="GitHub Source"
                                      >
                                        <Github className="size-3 text-muted-foreground" />
                                      </a>
                                    )}
                                    {svc.official_website && !svc.github_url && !svc.docs_url && (
                                      <a
                                        href={svc.official_website}
                                        target="_blank"
                                        rel="noopener noreferrer"
                                        className="p-1 hover:bg-muted rounded"
                                        title="Official Website"
                                      >
                                        <ExternalLink className="size-3 text-blue-500" />
                                      </a>
                                    )}
                                  </div>
                                </div>
                              ))}
                            </div>
                          </div>
                        </div>
                      </div>
                    );
                  })}
                </div>
              </div>
            )}

            {/* ── Power tab ── */}
            {activeTab === 'power' && (
              <PowerUsagePanel />
            )}
          </div>

          <div className="shrink-0 border-t bg-muted/20 px-4 py-2.5">
            <p className="text-[10px] text-muted-foreground text-center">
              Drag to canvas · Connect to router for auto-IP
            </p>
          </div>
        </>
      )}
    </Card>
    </>
  );
});
