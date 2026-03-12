import {
  ArrowRight,
  BookOpen,
  Boxes,
  Cpu,
  Network,
  Server,
  Shield,
  Sparkles,
  Wrench,
} from 'lucide-react';
import { Link } from 'react-router-dom';
import { SeoMeta } from '../../../components/seo/seo-meta';
import { Badge } from '../../../components/ui/badge';
import { Card, CardContent, CardDescription, CardHeader, CardTitle } from '../../../components/ui/card';

const planningSteps = [
  {
    title: 'Start with outcomes, not hardware',
    description:
      'Decide whether your homelab is for media, backups, containers, Kubernetes, virtual machines, networking practice, or a mix. Clear goals keep the build small enough to finish and expand later.',
    icon: Sparkles,
  },
  {
    title: 'Design the network first',
    description:
      'Pick your router, switches, VLAN plan, Wi-Fi coverage, and IP ranges before buying servers. A solid network layout prevents expensive rework once services are already running.',
    icon: Network,
  },
  {
    title: 'Match hardware to real workloads',
    description:
      'For a first homelab, low-power mini PCs, a used enterprise server, or a NAS plus one compute node are usually enough. Buy for RAM, storage expansion, and idle power efficiency, not just raw CPU.',
    icon: Cpu,
  },
  {
    title: 'Plan operations from day one',
    description:
      'Backups, UPS sizing, remote access, patching, and monitoring are part of the build. A homelab is most useful when it is easy to restore after mistakes, upgrades, or a power cut.',
    icon: Shield,
  },
];

const usageSteps = [
  'Create a project and place your core devices first: router, switch, access point, NAS, or server.',
  'Wire the topology visually so HLBuilder can understand which nodes belong on the same network path.',
  'Save the build before recalculating network data, then review assigned IPs and spot disconnected devices.',
  'Use the hardware catalog and service library to compare options and shape a realistic shopping list.',
  'Iterate on the design until the lab fits your budget, power limits, rack space, and future expansion plan.',
];

const starterStacks = [
  {
    title: 'Budget homelab',
    summary: 'One mini PC, a consumer router, and an external backup target.',
    details:
      'Ideal for Docker, Home Assistant, Pi-hole, media automation, and learning Linux. Keep it simple and use this build to learn backup and remote access habits.',
  },
  {
    title: 'Balanced homelab',
    summary: 'Router, managed switch, NAS, and one or two compute nodes.',
    details:
      'A strong fit for Proxmox, storage, VLANs, reverse proxies, self-hosted apps, and service separation without jumping straight to noisy rack gear.',
  },
  {
    title: 'Virtualization lab',
    summary: 'Multiple compute nodes, shared storage, and segmented networking.',
    details:
      'Useful for Kubernetes, HA experiments, GitOps, clustering, and network labs. This is where planning IP ranges and switch capacity becomes critical.',
  },
];

const faqItems = [
  {
    question: 'What is the best first homelab setup?',
    answer:
      'The best first homelab is the smallest setup that solves one real problem. A mini PC or repurposed desktop, reliable backups, and a clean network plan beat a large pile of underused hardware.',
  },
  {
    question: 'How much RAM do I need for a homelab?',
    answer:
      'For light containers and a few services, 16 GB can work. For Proxmox, several virtual machines, or Kubernetes, 32 GB to 64 GB is a much more comfortable starting point.',
  },
  {
    question: 'Should a homelab use enterprise hardware?',
    answer:
      'Only if you accept the tradeoffs. Used enterprise hardware gives you ECC memory, remote management, and expansion, but it can be louder, hotter, and more power hungry than modern mini PCs.',
  },
  {
    question: 'Why use a homelab builder tool?',
    answer:
      'A homelab builder helps you plan topology, hardware roles, and IP assignments before you spend money or re-cable your network. It reduces guesswork and makes changes easier to reason about.',
  },
];

export default function HomelabGuidePage() {
  const structuredData = {
    '@context': 'https://schema.org',
    '@type': 'TechArticle',
    headline: 'How to Build a Homelab with HLBuilder',
    description:
      'A practical guide to planning, sizing, securing, and expanding a homelab, with a walkthrough of how to use HLBuilder to design the setup.',
    author: {
      '@type': 'Organization',
      name: 'HLBuilder',
    },
    publisher: {
      '@type': 'Organization',
      name: 'HLBuilder',
      logo: {
        '@type': 'ImageObject',
        url: 'https://hlbldr.com/logo.svg',
      },
    },
    mainEntityOfPage: 'https://hlbldr.com/how-to-build-a-homelab',
    keywords: [
      'homelab builder',
      'how to build a homelab',
      'homelab guide',
      'self-hosting',
      'homelab network design',
    ],
  };

  return (
    <div className="flex-1 overflow-y-auto relative h-full bg-[radial-gradient(circle_at_top_left,_rgba(59,130,246,0.12),_transparent_28%),radial-gradient(circle_at_top_right,_rgba(16,185,129,0.10),_transparent_24%)]">
      <SeoMeta
        title="How to Build a Homelab with HLBuilder"
        description="Learn how to build a homelab, choose hardware, design your network, and use HLBuilder to plan servers, storage, and services."
        path="/how-to-build-a-homelab"
        type="article"
        keywords={[
          'homelab builder',
          'how to build a homelab',
          'build a homelab',
          'homelab guide',
          'self-hosted lab planning',
        ]}
        structuredData={structuredData}
      />

      <div className="mx-auto max-w-6xl px-6 py-10 lg:px-12 lg:py-14 pb-24 space-y-12">
        <section className="rounded-[2rem] border border-border/70 bg-card/80 backdrop-blur-sm p-8 lg:p-12 shadow-sm overflow-hidden relative">
          <div className="absolute inset-x-0 top-0 h-1 bg-gradient-to-r from-blue-500 via-cyan-400 to-emerald-500" />
          <div className="grid gap-10 lg:grid-cols-[1.25fr_0.75fr] items-start">
            <div className="space-y-6">
              <div className="flex flex-wrap gap-3">
                <Badge variant="outline" className="border-blue-500/40 bg-blue-500/10 text-blue-700 dark:text-blue-300">
                  Homelab Builder Guide
                </Badge>
                <Badge variant="outline" className="border-emerald-500/40 bg-emerald-500/10 text-emerald-700 dark:text-emerald-300">
                  Public Route
                </Badge>
              </div>

              <div className="space-y-4 max-w-3xl">
                <h1 className="text-4xl font-black tracking-tight sm:text-5xl lg:text-6xl">
                  How to build a homelab without turning it into a pile of random gear
                </h1>
                <p className="text-lg text-muted-foreground leading-8">
                  If you are searching for a homelab builder, a practical homelab guide, or simply how to build a homelab that is useful on day one, this page is the starting point. HLBuilder helps you plan the network, size the hardware, map services to machines, and avoid common mistakes before you buy or rack anything.
                </p>
              </div>

              <div className="flex flex-wrap gap-3">
                <Link
                  to="/"
                  className="inline-flex items-center gap-2 rounded-md bg-primary px-5 py-3 text-sm font-medium text-primary-foreground transition-colors hover:bg-primary/90"
                >
                  Open HLBuilder
                  <ArrowRight className="h-4 w-4" />
                </Link>
                <Link
                  to="/hardware"
                  className="inline-flex items-center gap-2 rounded-md border border-input bg-background px-5 py-3 text-sm font-medium transition-colors hover:bg-accent hover:text-accent-foreground"
                >
                  Browse hardware ideas
                </Link>
                <Link
                  to="/services"
                  className="inline-flex items-center gap-2 rounded-md border border-input bg-background px-5 py-3 text-sm font-medium transition-colors hover:bg-accent hover:text-accent-foreground"
                >
                  Explore services
                </Link>
              </div>
            </div>

            <Card className="border-border/70 bg-background/80">
              <CardHeader>
                <CardTitle className="flex items-center gap-2 text-xl">
                  <BookOpen className="h-5 w-5 text-cyan-500" />
                  Quick answer
                </CardTitle>
                <CardDescription>
                  The best homelab is small, documented, and easy to recover.
                </CardDescription>
              </CardHeader>
              <CardContent className="space-y-4 text-sm leading-7 text-muted-foreground">
                <p>
                  Start with one clear use case, design the network before the servers, keep storage and backups separate, and leave room to grow. That is the pattern behind most stable home labs, whether the hardware is a mini PC, a NAS, or a rack server.
                </p>
                <p>
                  HLBuilder is useful at the planning stage because it turns the fuzzy idea of a future lab into a visible topology with hardware roles, links, and IP expectations.
                </p>
              </CardContent>
            </Card>
          </div>
        </section>

        <section className="space-y-6">
          <div className="space-y-2 max-w-3xl">
            <h2 className="text-3xl font-bold tracking-tight">The practical order for building a homelab</h2>
            <p className="text-muted-foreground leading-7">
              Most failed builds start with shopping. Good builds start with scope, network, and operations.
            </p>
          </div>

          <div className="grid gap-4 md:grid-cols-2">
            {planningSteps.map(step => (
              <Card key={step.title} className="border-border/70 bg-card/80 hover-lift">
                <CardHeader>
                  <div className="flex h-11 w-11 items-center justify-center rounded-2xl bg-primary/10 text-primary">
                    <step.icon className="h-5 w-5" />
                  </div>
                  <CardTitle className="text-xl">{step.title}</CardTitle>
                </CardHeader>
                <CardContent>
                  <p className="text-sm leading-7 text-muted-foreground">{step.description}</p>
                </CardContent>
              </Card>
            ))}
          </div>
        </section>

        <section className="grid gap-6 lg:grid-cols-[0.95fr_1.05fr]">
          <Card className="border-border/70 bg-card/85">
            <CardHeader>
              <CardTitle className="flex items-center gap-2 text-2xl">
                <Boxes className="h-5 w-5 text-orange-500" />
                Starter homelab patterns
              </CardTitle>
              <CardDescription>
                Choose a shape that matches your goals and your electricity bill.
              </CardDescription>
            </CardHeader>
            <CardContent className="space-y-5">
              {starterStacks.map(stack => (
                <div key={stack.title} className="rounded-2xl border border-border/70 bg-background/70 p-4 space-y-2">
                  <h3 className="font-semibold text-lg">{stack.title}</h3>
                  <p className="text-sm font-medium text-foreground/90">{stack.summary}</p>
                  <p className="text-sm leading-7 text-muted-foreground">{stack.details}</p>
                </div>
              ))}
            </CardContent>
          </Card>

          <Card className="border-border/70 bg-card/85">
            <CardHeader>
              <CardTitle className="flex items-center gap-2 text-2xl">
                <Server className="h-5 w-5 text-red-500" />
                Hardware advice that actually matters
              </CardTitle>
              <CardDescription>
                Common buying advice is usually too generic. These constraints decide whether a lab stays usable.
              </CardDescription>
            </CardHeader>
            <CardContent className="space-y-4 text-sm leading-7 text-muted-foreground">
              <p>
                Prioritize low idle power, enough RAM headroom, and simple storage expansion. Most self-hosted services are bottlenecked by memory, disk quality, or network design long before they need exotic CPUs.
              </p>
              <p>
                If you want Plex, Frigate, or AI experiments, think about GPU and media encoding early. If you want backups and family data, think about storage redundancy, snapshots, and restore testing before everything else.
              </p>
              <p>
                Keep noisy rack servers for cases where you really need PCIe lanes, lots of drives, or large memory pools. For many home labs, two efficient nodes plus a NAS is a better system than one huge server.
              </p>
            </CardContent>
          </Card>
        </section>

        <section className="grid gap-6 lg:grid-cols-2">
          <Card className="border-border/70 bg-card/85">
            <CardHeader>
              <CardTitle className="flex items-center gap-2 text-2xl">
                <Network className="h-5 w-5 text-blue-500" />
                Network design basics for a real homelab
              </CardTitle>
            </CardHeader>
            <CardContent className="space-y-4 text-sm leading-7 text-muted-foreground">
              <p>
                Give the lab a clear gateway, stable subnets, and enough managed switching to separate trusted devices from experiments. Even a small setup benefits from separating infrastructure, servers, and IoT traffic.
              </p>
              <p>
                Use a router you understand, then decide whether you need VLANs, multiple SSIDs, PoE, or 2.5 GbE. Buy switches and access points that match that plan instead of mixing random features later.
              </p>
              <p>
                Good IP hygiene matters. Reserve predictable ranges for routers, switches, servers, and storage so your diagrams, config exports, and troubleshooting stay aligned.
              </p>
            </CardContent>
          </Card>

          <Card className="border-border/70 bg-card/85">
            <CardHeader>
              <CardTitle className="flex items-center gap-2 text-2xl">
                <Shield className="h-5 w-5 text-emerald-500" />
                Security and maintenance checklist
              </CardTitle>
            </CardHeader>
            <CardContent className="space-y-3 text-sm leading-7 text-muted-foreground">
              <p>Use a password manager, MFA where possible, and distinct admin accounts.</p>
              <p>Keep public exposure minimal. Prefer VPN or a hardened reverse proxy over direct port forwards.</p>
              <p>Back up both application data and configuration data, then verify restore steps.</p>
              <p>Track updates for hypervisors, routers, container images, and firmware on a schedule.</p>
              <p>Add basic monitoring early so failed disks, hot CPUs, and expired certificates do not surprise you.</p>
            </CardContent>
          </Card>
        </section>

        <section className="rounded-[2rem] border border-border/70 bg-card/80 p-8 lg:p-10 space-y-6">
          <div className="space-y-2 max-w-3xl">
            <h2 className="text-3xl font-bold tracking-tight">How to use HLBuilder for homelab planning</h2>
            <p className="text-muted-foreground leading-7">
              This is the usage guide part: the fastest way to get value from HLBuilder is to build the topology before the shopping list.
            </p>
          </div>

          <div className="grid gap-4 lg:grid-cols-[1fr_0.9fr] items-start">
            <div className="space-y-3">
              {usageSteps.map((step, index) => (
                <div key={step} className="flex gap-4 rounded-2xl border border-border/70 bg-background/70 p-4">
                  <div className="flex h-9 w-9 shrink-0 items-center justify-center rounded-full bg-primary text-primary-foreground text-sm font-semibold">
                    {index + 1}
                  </div>
                  <p className="text-sm leading-7 text-muted-foreground">{step}</p>
                </div>
              ))}
            </div>

            <Card className="border-border/70 bg-background/80">
              <CardHeader>
                <CardTitle className="flex items-center gap-2 text-xl">
                  <Wrench className="h-5 w-5 text-violet-500" />
                  What HLBuilder helps with
                </CardTitle>
              </CardHeader>
              <CardContent className="space-y-3 text-sm leading-7 text-muted-foreground">
                <p>Visual device placement for routers, switches, servers, NAS units, and more.</p>
                <p>Connection mapping so you can reason about topology instead of keeping it in your head.</p>
                <p>Automatic IP planning based on the saved build, which helps reveal missing routers or disconnected nodes.</p>
                <p>Service and hardware discovery so the design stage stays tied to actual workloads.</p>
              </CardContent>
            </Card>
          </div>
        </section>

        <section className="space-y-6">
          <div className="space-y-2 max-w-3xl">
            <h2 className="text-3xl font-bold tracking-tight">Frequently asked questions</h2>
            <p className="text-muted-foreground leading-7">
              These answers target the questions people usually ask when searching how to build a homelab.
            </p>
          </div>

          <div className="grid gap-4 md:grid-cols-2">
            {faqItems.map(item => (
              <Card key={item.question} className="border-border/70 bg-card/85">
                <CardHeader>
                  <CardTitle className="text-lg leading-7">{item.question}</CardTitle>
                </CardHeader>
                <CardContent>
                  <p className="text-sm leading-7 text-muted-foreground">{item.answer}</p>
                </CardContent>
              </Card>
            ))}
          </div>
        </section>
      </div>
    </div>
  );
}