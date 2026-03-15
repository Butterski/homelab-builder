import { useState, useMemo } from 'react';
import { useBuilderStore } from '../../builder/store/builder-store';
import { SeoMeta } from '../../../components/seo/seo-meta';
import { Card, CardContent, CardTitle, CardDescription } from '../../../components/ui/card';
import { Badge } from '../../../components/ui/badge';
import { Button } from '../../../components/ui/button';
import {
  ClipboardList,
  CheckCircle2,
  ChevronDown,
  Server,
  Globe,
  Download,
  Terminal,
  Network,
  Shield,
} from 'lucide-react';

interface SetupStep {
  id: string;
  title: string;
  description: string;
  icon: React.ElementType;
  items: { text: string; code?: string }[];
  dependsOn?: string[]; // IDs of services that trigger this step
}

export default function ChecklistPage() {
  const { hardwareNodes } = useBuilderStore();
  const [expandedSteps, setExpandedSteps] = useState<Set<string>>(new Set(['prep', 'os']));

  // Calculate dynamic data based on the builder state
  const hasHardware = hardwareNodes.length > 0;
  const hasServer = hardwareNodes.some(
    n => n.type === 'server' || n.type === 'pc' || n.type === 'minipc' || n.type === 'sbc',
  );
  const hasRouter = hardwareNodes.some(n => n.type === 'router');
  const hasSwitch = hardwareNodes.some(n => n.type === 'switch');

  // Collect all unique service names deployed
  const deployedServices = new Set<string>();
  hardwareNodes.forEach(node => {
    if (
      node.type === 'server' ||
      node.type === 'pc' ||
      node.type === 'minipc' ||
      node.type === 'sbc'
    ) {
      node.vms?.forEach(vm => deployedServices.add(vm.name.toLowerCase()));
    }
  });

  const hasDockerServices = deployedServices.size > 0;
  const hasProxy =
    deployedServices.has('nginx proxy manager') ||
    deployedServices.has('traefik') ||
    deployedServices.has('caddy');
  const hasPihole = deployedServices.has('pi-hole') || deployedServices.has('adguard home');

  // Generate dynamic steps
  const steps = useMemo(() => {
    const s: SetupStep[] = [];

    // 1. Hardware Prep (Always relevant if they have any compute nodes)
    s.push({
      id: 'prep',
      title: '1. Hardware Preparation',
      description: 'Physical assembly and BIOS configuration.',
      icon: Server,
      items: [
        { text: 'Assemble your hardware components according to manuals.' },
        {
          text: 'Connect your compute nodes directly to your router or switch via Ethernet. (Wi-Fi is not recommended for home servers).',
        },
        { text: 'Boot the machine and enter the BIOS/UEFI.' },
        { text: 'Update BIOS/UEFI to the latest version if possible.' },
        { text: 'In BIOS, enable Virtualization features (Intel VT-x or AMD-V).' },
        {
          text: 'In BIOS, set "Power On After Power Loss" to ON (often under ACPI or Power settings).',
        },
      ],
    });

    // 1.5 Networking (If router/switch present)
    if (hasRouter || hasSwitch) {
      s.push({
        id: 'networking',
        title: 'Networking & Topology',
        description: 'Physical and logical network setup.',
        icon: Network,
        items: [
          ...(hasRouter
            ? [{ text: 'Configure your primary router/firewall interfaces (WAN/LAN).' }]
            : []),
          ...(hasSwitch ? [{ text: 'Connect your switch to the router uplink port.' }] : []),
          {
            text: 'Assign static IP addresses (or DHCP reservations) for your main servers in your router settings.',
          },
        ],
      });
    }

    // 2. OS Installation (Assuming hypervisor path for servers)
    if (hasServer) {
      s.push({
        id: 'os',
        title: '2. Operating System (Hypervisor)',
        description: 'Installing the base OS on your main servers.',
        icon: Download,
        items: [
          {
            text: 'Download the Proxmox VE ISO from the official site (Recommended for servers/PCs).',
          },
          { text: 'Flash the ISO to a USB stick using Rufus or BalenaEtcher.' },
          { text: 'Boot from the USB and follow the Proxmox installer.' },
          {
            text: 'Select ZFS (RAIDZ) if you have multiple identical drives and ECC RAM, otherwise select ext4 or xfs.',
          },
          { text: 'Set a static IP during installation for the management interface.' },
        ],
      });
    }

    // 3. Security
    s.push({
      id: 'security',
      title: '3. Basic Security Hardening',
      description: 'Securing the base installation before exposing services.',
      icon: Shield,
      items: [
        { text: 'Log into your hypervisor or Linux server via SSH.' },
        {
          text: 'Create a non-root user and add them to the sudo group:',
          code: 'adduser username\nusermod -aG sudo username',
        },
        {
          text: 'Generate SSH keys on your personal PC and copy them to the server:',
          code: 'ssh-copy-id username@SERVER_IP',
        },
        {
          text: 'Disable password authentication in SSH:',
          code: 'sudo nano /etc/ssh/sshd_config\n# Set PasswordAuthentication no\n# Set PermitRootLogin prohibit-password\nsudo systemctl restart ssh',
        },
      ],
    });

    // 4. Docker Environment
    if (hasDockerServices) {
      s.push({
        id: 'docker',
        title: '4. Container Runtime (Docker)',
        description: 'Setting up the environment for your homelab services.',
        icon: Terminal,
        items: [
          {
            text: 'If using Proxmox, create a new Debian/Ubuntu LXC (Linux Container) or VM to host Docker.',
          },
          {
            text: 'Install Docker and Docker Compose:',
            code: 'curl -fsSL https://get.docker.com -o get-docker.sh\nsudo sh get-docker.sh\nsudo usermod -aG docker $USER',
          },
          { text: 'Verify installation:', code: 'docker compose version' },
        ],
      });
    }

    // 5. Specific Service Notes
    if (hasPihole || hasProxy) {
      s.push({
        id: 'services',
        title: '5. Core Services Configuration',
        description: 'Specific instructions for critical infrastructure services you selected.',
        icon: Globe,
        items: [
          ...(hasPihole
            ? [
                {
                  text: "DNS Ad-Blocking (Pi-hole / AdGuard): Set your router's primary DHCP DNS to point to the static IP of this service.",
                },
                { text: 'Make sure your DNS container starts on boot (restart: unless-stopped).' },
              ]
            : []),
          ...(hasProxy
            ? [
                {
                  text: 'Reverse Proxy (NPM / Traefik / Caddy): Forward ports 80 and 443 on your router to the IP of the machine running this service.',
                },
                {
                  text: "Point your domain's DNS A-records (e.g., in Cloudflare) to your home public IP address.",
                },
              ]
            : []),
        ],
      });
    }

    return s;
  }, [hasServer, hasRouter, hasSwitch, hasDockerServices, hasPihole, hasProxy]);

  const toggleStep = (id: string) => {
    setExpandedSteps(prev => {
      const next = new Set(prev);
      if (next.has(id)) next.delete(id);
      else next.add(id);
      return next;
    });
  };

  const expandAll = () => setExpandedSteps(new Set(steps.map(s => s.id)));
  const collapseAll = () => setExpandedSteps(new Set());

  if (!hasHardware) {
    return (
      <>
        <SeoMeta
          title="Custom Setup Guide | HLBuilder"
          description="Step-by-step setup checklist generated from your homelab design in HLBuilder."
          path="/checklist"
        />
        <div className="flex flex-col items-center justify-center p-12 text-center border rounded-lg bg-muted/20 min-h-100">
          <ClipboardList className="h-16 w-16 mb-6 text-muted-foreground/50" />
          <h3 className="text-xl font-bold mb-2">Build your lab first</h3>
          <p className="text-muted-foreground mb-6 max-w-md">
            Your setup instructions will be dynamically generated here based on the hardware and
            services you add in the Visual Builder.
          </p>
          <Button onClick={() => (window.location.href = '/builder')}>Go to Visual Builder</Button>
        </div>
      </>
    );
  }

  return (
    <div className="max-w-4xl mx-auto space-y-8 py-8 px-6">
      <SeoMeta
        title="Custom Setup Guide | HLBuilder"
        description="Step-by-step setup checklist generated from your homelab design in HLBuilder."
        path="/checklist"
      />
      <div className="flex flex-col md:flex-row md:items-end justify-between gap-4">
        <div className="space-y-2">
          <h1 className="text-3xl font-bold tracking-tight">Custom Setup Guide</h1>
          <p className="text-muted-foreground max-w-2xl">
            A personalized step-by-step technical guide based on the{' '}
            <Badge variant="secondary" className="mx-1">
              {hardwareNodes.length} devices
            </Badge>
            and{' '}
            <Badge variant="secondary" className="mx-1">
              {deployedServices.size} services
            </Badge>{' '}
            in your current project.
          </p>
        </div>
        <div className="flex items-center gap-2 shrink-0">
          <Button variant="outline" size="sm" onClick={expandAll}>
            Expand All
          </Button>
          <Button variant="outline" size="sm" onClick={collapseAll}>
            Collapse All
          </Button>
        </div>
      </div>

      <div className="space-y-4">
        {steps.map(step => {
          const isExpanded = expandedSteps.has(step.id);
          const Icon = step.icon;

          return (
            <Card
              key={step.id}
              className={`overflow-hidden transition-all duration-200 ${isExpanded ? 'border-primary/50' : 'hover:border-primary/30'}`}
            >
              <div
                className="flex items-center justify-between p-5 cursor-pointer select-none bg-card hover:bg-muted/30 transition-colors"
                onClick={() => toggleStep(step.id)}
              >
                <div className="flex items-center gap-4">
                  <div
                    className={`p-2 rounded-lg ${isExpanded ? 'bg-primary/10 text-primary' : 'bg-muted text-muted-foreground'}`}
                  >
                    <Icon className="h-5 w-5" />
                  </div>
                  <div>
                    <CardTitle className="text-lg flex items-center gap-2">{step.title}</CardTitle>
                    <CardDescription className="mt-1">{step.description}</CardDescription>
                  </div>
                </div>
                <div className="text-muted-foreground">
                  <ChevronDown
                    className={`h-5 w-5 transition-transform duration-200 ${isExpanded ? 'rotate-180' : ''}`}
                  />
                </div>
              </div>

              <div
                className="grid transition-all duration-300 ease-in-out"
                style={{ gridTemplateRows: isExpanded ? '1fr' : '0fr' }}
              >
                <div className="overflow-hidden">
                  <CardContent className="pt-0 pb-6 px-5 sm:px-14 border-t bg-muted/10">
                    <ul className="space-y-4 pt-6">
                      {step.items.map((item, i) => (
                        <li key={i} className="flex items-start gap-3">
                          <CheckCircle2 className="h-5 w-5 text-primary/60 shrink-0 mt-0.5" />
                          <div className="space-y-2 flex-1">
                            <p className="text-sm leading-relaxed">{item.text}</p>
                            {item.code && (
                              <div className="bg-black/80 dark:bg-black rounded-md p-3 overflow-x-auto border border-primary/20">
                                <pre className="text-xs text-green-400 font-mono leading-relaxed">
                                  <code>{item.code}</code>
                                </pre>
                              </div>
                            )}
                          </div>
                        </li>
                      ))}
                    </ul>
                  </CardContent>
                </div>
              </div>
            </Card>
          );
        })}
      </div>
    </div>
  );
}
