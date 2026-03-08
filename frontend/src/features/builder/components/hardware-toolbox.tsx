import React, { useState } from 'react';
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
} from 'lucide-react';
import type { HardwareType } from '../../../types';
import { Card } from '../../../components/ui/card';
import { useUserSelections } from '../../catalog/api/use-services';
import { useBuilderStore } from '../store/builder-store';
import { Github } from '../../../components/icons/github';

// ─── Basic component types ─────────────────────────────────────────────────────
const HARDWARE_TOOLS: {
  type: HardwareType;
  label: string;
  icon: React.ElementType;
  color: string;
}[] = [
  { type: 'router', label: 'Router', icon: Router, color: 'text-purple-500' },
  { type: 'switch', label: 'Switch', icon: CircuitBoard, color: 'text-blue-500' },
  { type: 'server', label: 'Server', icon: Server, color: 'text-orange-500' },
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
        type: 'server',
        icon: Server,
        sub: '2× E5-2670 · 128GB · ~$300',
        data: {
          name: 'Dell R720',
          details: { model: 'PowerEdge R720 (2× Xeon E5-2670)', cpu: 16, ram: 128, price_est: 300 },
        },
      },
      {
        label: 'HP ProLiant DL380 G9',
        type: 'server',
        icon: Server,
        sub: '2× E5-2680v4 · 256GB · ~$500',
        data: {
          name: 'HP DL380 G9',
          details: {
            model: 'ProLiant DL380 G9 (2× Xeon E5-2680v4)',
            cpu: 28,
            ram: 256,
            price_est: 500,
          },
        },
      },
      {
        label: 'Supermicro X10SL7',
        type: 'server',
        icon: Server,
        sub: 'E3-1245v3 · 32GB · ~$200',
        data: {
          name: 'Supermicro X10SL7',
          details: { model: 'X10SL7-F (Xeon E3-1245v3)', cpu: 4, ram: 32, price_est: 200 },
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
];

export function HardwareToolbox() {
  const { availableServices, fetchServices } = useBuilderStore();
  const { data: selectionsData } = useUserSelections();

  React.useEffect(() => {
    fetchServices();
  }, [fetchServices]);

  const [activeTab, setActiveTab] = useState<'components' | 'presets' | 'services'>('components');
  const [expandedCategories, setExpandedCategories] = useState<Set<string>>(
    new Set(['Single Board Computers', 'Mini PCs']),
  );
  const [collapsedServiceCats, setCollapsedServiceCats] = useState<Set<string>>(new Set());
  const [searchQuery, setSearchQuery] = useState('');
  const [isMinimized, setIsMinimized] = useState(false);
  const [position, setPosition] = useState({ x: 16, y: 80 });
  const [isDragging, setIsDragging] = useState(false);
  const dragOffset = useState({ x: 0, y: 0 })[0]; // Ref-like state for drag offset

  const handleMouseDown = (e: React.MouseEvent) => {
    // Only drag from header
    if ((e.target as HTMLElement).closest('button')) return;
    setIsDragging(true);
    dragOffset.x = e.clientX - position.x;
    dragOffset.y = e.clientY - position.y;
  };

  const handleMouseMove = (e: MouseEvent) => {
    if (!isDragging) return;
    setPosition({
      x: e.clientX - dragOffset.x,
      y: e.clientY - dragOffset.y,
    });
  };

  const handleMouseUp = () => {
    setIsDragging(false);
  };

  // Global listeners for drag
  React.useEffect(() => {
    if (isDragging) {
      window.addEventListener('mousemove', handleMouseMove);
      window.addEventListener('mouseup', handleMouseUp);
    } else {
      window.removeEventListener('mousemove', handleMouseMove);
      window.removeEventListener('mouseup', handleMouseUp);
    }
    return () => {
      window.removeEventListener('mousemove', handleMouseMove);
      window.removeEventListener('mouseup', handleMouseUp);
    };
  }, [isDragging]);

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

  const filteredServices = availableServices.filter(
    svc =>
      svc.name.toLowerCase().includes(searchQuery.toLowerCase()) ||
      svc.description.toLowerCase().includes(searchQuery.toLowerCase()) ||
      svc.category.toLowerCase().includes(searchQuery.toLowerCase()) ||
      (searchQuery.toLowerCase() === 'favorites' && favServiceIds.has(svc.id)),
  );

  const servicesByCategory = filteredServices.reduce(
    (acc, svc) => {
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
    <Card
      className="absolute z-50 shadow-none border flex flex-col overflow-hidden"
      style={{
        left: position.x,
        top: position.y,
        width: isMinimized ? 'auto' : '16.5rem',
        maxHeight: isMinimized ? 'auto' : 'calc(100vh - 8rem)',
        cursor: isDragging ? 'grabbing' : 'auto',
      }}
    >
      {/* Header / Drag Handle */}
      <div
        className="flex items-center justify-between px-3 py-2 bg-muted cursor-grab active:cursor-grabbing border-b select-none"
        onMouseDown={handleMouseDown}
      >
        <div className="flex items-center gap-2">
          <span className="font-bold text-xs uppercase tracking-wider text-muted-foreground">
            Library
          </span>
        </div>
        <button
          onClick={() => setIsMinimized(!isMinimized)}
          className="h-4 w-4 flex items-center justify-center rounded hover:bg-background/50 text-muted-foreground"
          title={isMinimized ? 'Expand' : 'Minimize'}
        >
          {isMinimized ? (
            <ChevronDown className="h-3 w-3 hover:cursor-pointer" />
          ) : (
            <ChevronDown className="h-3 w-3 hover:cursor-pointer rotate-180" />
          )}
        </button>
      </div>

      {!isMinimized && (
        <>
          {/* Tab bar */}
          <div className="flex border-b shrink-0 bg-card">
            {(
              [
                { id: 'components', label: 'Types', icon: LayoutGrid },
                { id: 'presets', label: 'Presets', icon: Package },
                { id: 'services', label: 'Services', icon: AppWindow },
              ] as const
            ).map(tab => {
              const Icon = tab.icon;
              return (
                <button
                  key={tab.id}
                  onClick={() => setActiveTab(tab.id)}
                  className={`flex-1 flex flex-col items-center gap-0.5 py-2 text-[10px] font-semibold uppercase tracking-wide transition-colors ${tab.id === 'services' ? 'tour-toolbox-services' : ''} ${
                    activeTab === tab.id
                      ? 'text-primary border-b-2 border-primary bg-primary/5'
                      : 'text-muted-foreground hover:text-foreground'
                  }`}
                >
                  <Icon className="h-3.5 w-3.5" />
                  {tab.label}
                </button>
              );
            })}
          </div>

          <div className="tour-toolbox overflow-y-auto flex-1 p-3">
            {/* ── Components tab ── */}
            {activeTab === 'components' && (
              <div className="space-y-2">
                <p className="text-[10px] text-muted-foreground mb-2">
                  Drag any component onto the canvas
                </p>
                <div className="grid grid-cols-3 gap-1.5">
                  {HARDWARE_TOOLS.map(tool => {
                    const Icon = tool.icon;
                    return (
                      <div
                        key={tool.type}
                        className="flex flex-col items-center justify-center p-2 border rounded-lg cursor-grab hover:bg-primary/5 hover:border-primary/50 transition-colors bg-card active:cursor-grabbing"
                        onDragStart={e => onDragStart(e, tool.type)}
                        draggable
                      >
                        <Icon className={`h-4 w-4 mb-1 ${tool.color}`} />
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
                {PRESETS.map(cat => {
                  const isOpen = expandedCategories.has(cat.category);
                  return (
                    <div key={cat.category} className="border rounded-lg overflow-hidden">
                      <button
                        className="w-full flex items-center justify-between px-2.5 py-2 text-[10px] font-bold uppercase tracking-wide bg-muted/40 hover:bg-muted/70 transition-colors"
                        onClick={() => toggleCategory(cat.category)}
                      >
                        {cat.category}
                        <ChevronDown
                          className={`h-3 w-3 transition-transform duration-200 hover:cursor-pointer ${isOpen ? 'rotate-180' : ''}`}
                        />
                      </button>
                      <div
                        className="grid transition-all duration-300 ease-in-out"
                        style={{ gridTemplateRows: isOpen ? '1fr' : '0fr' }}
                      >
                        <div className="overflow-hidden">
                          <div className="divide-y">
                            {cat.items.map(preset => {
                              const Icon = preset.icon;
                              return (
                                <div
                                  key={preset.label}
                                  className="flex items-center gap-2 px-2.5 py-2 cursor-grab hover:bg-primary/5 transition-colors active:cursor-grabbing"
                                  onDragStart={e => onDragStart(e, preset.type, preset.data)}
                                  draggable
                                >
                                  <Icon className="h-3.5 w-3.5 text-primary shrink-0" />
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
                  <Search className="absolute left-2 top-1.5 h-3.5 w-3.5 text-muted-foreground" />
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
                      <p className="text-xs text-muted-foreground">No services found...</p>
                    </div>
                  )}

                  {sortedServiceCategories.map(([catName, svcs]) => {
                    // Auto-expand if searchQuery is active, else check if NOT in collapsed set
                    const isEffectivelyOpen =
                      searchQuery !== '' ? true : !collapsedServiceCats.has(catName);

                    return (
                      <div key={catName} className="border rounded-lg overflow-hidden">
                        <button
                          className="w-full flex items-center justify-between px-2.5 py-2 text-[10px] font-bold uppercase tracking-wide bg-muted/40 hover:bg-muted/70 transition-colors"
                          onClick={() => toggleServiceCat(catName)}
                        >
                          <span className="flex items-center gap-1.5 focus:outline-none">
                            {catName === 'Favorites' && (
                              <Heart className="h-3 w-3 fill-red-500 text-red-500" />
                            )}
                            {catName}
                          </span>
                          <div className="flex items-center gap-2">
                            <span className="text-[9px] text-muted-foreground px-1.5 py-0.5 bg-background rounded-full">
                              {svcs.length}
                            </span>
                            <ChevronDown
                              className={`h-3 w-3 transition-transform duration-200 hover:cursor-pointer ${isEffectivelyOpen ? 'rotate-180' : ''}`}
                            />
                          </div>
                        </button>

                        <div
                          className="grid transition-all duration-300 ease-in-out"
                          style={{ gridTemplateRows: isEffectivelyOpen ? '1fr' : '0fr' }}
                        >
                          <div className="overflow-hidden">
                            <div className="divide-y divide-border/50">
                              {svcs.map(svc => (
                                <div
                                  key={svc.id}
                                  className="flex items-center justify-between gap-2 px-2.5 py-2 cursor-grab hover:bg-primary/5 transition-colors bg-card active:cursor-grabbing group"
                                  onDragStart={e => {
                                    e.dataTransfer.setData('application/reactflow', 'server');
                                    e.dataTransfer.setData('service-drag', 'true');
                                    e.dataTransfer.setData(
                                      'application/reactflow-data',
                                      JSON.stringify({
                                        type: 'server',
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
                                    <div className="h-6 w-6 rounded bg-primary/10 flex items-center justify-center shrink-0">
                                      {svc.icon ? (
                                        <Zap className="h-3 w-3 text-primary" />
                                      ) : (
                                        <Zap className="h-3 w-3 text-primary" />
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
                                        <Book className="h-3 w-3 text-emerald-500" />
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
                                        <Github className="h-3 w-3 text-muted-foreground" />
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
                                        <ExternalLink className="h-3 w-3 text-blue-500" />
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
          </div>

          <div className="border-t px-3 py-2 shrink-0 bg-card">
            <p className="text-[9px] text-muted-foreground text-center opacity-60">
              Drag to canvas · Connect to router for auto-IP
            </p>
          </div>
        </>
      )}
    </Card>
  );
}
