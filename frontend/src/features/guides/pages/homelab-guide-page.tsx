import { useEffect, useState, type ReactNode } from 'react';
import { ExternalLink } from 'lucide-react';
import { Link, useLocation } from 'react-router-dom';
import { Page, PageRow } from '../../../components/layout/page';
import { SeoMeta } from '../../../components/seo/seo-meta';
import { buttonVariants } from '../../../components/ui/button-variants';

/** The order a lab is planned in. It is a sequence, so it is numbered. */
const planningSteps = [
  {
    title: 'Start with outcomes, not hardware',
    description:
      'Decide whether your homelab is for media, backups, containers, Kubernetes, virtual machines, networking practice, or a mix. Clear goals keep the build small enough to finish and expand later.',
  },
  {
    title: 'Design the network first',
    description:
      'Pick your router, switches, VLAN plan, Wi-Fi coverage, and IP ranges before buying servers. A solid network layout prevents expensive rework once services are already running.',
  },
  {
    title: 'Match hardware to real workloads',
    description:
      'For a first homelab, low-power mini PCs, a used enterprise server, or a NAS plus one compute node are usually enough. Buy for RAM, storage expansion, and idle power efficiency, not just raw CPU.',
  },
  {
    title: 'Plan operations from day one',
    description:
      'Backups, UPS sizing, remote access, patching, and monitoring are part of the build. A homelab is most useful when it is easy to restore after mistakes, upgrades, or a power cut.',
  },
];

const starterStacks = [
  {
    title: 'Budget homelab',
    summary: 'One mini PC, a consumer router, and an external backup target.',
    details:
      'Docker, Home Assistant, Pi-hole, media automation, and learning Linux. Keep it simple and use this build to learn backup and remote access habits.',
  },
  {
    title: 'Balanced homelab',
    summary: 'Router, managed switch, NAS, and one or two compute nodes.',
    details:
      'Proxmox, storage, VLANs, reverse proxies, self-hosted apps, and service separation without jumping straight to noisy rack gear.',
  },
  {
    title: 'Virtualization lab',
    summary: 'Multiple compute nodes, shared storage, and segmented networking.',
    details:
      'Kubernetes, HA experiments, GitOps, clustering, and network labs. This is where planning IP ranges and switch capacity becomes critical.',
  },
];

const hardwareAdvice = [
  'Prioritize low idle power, enough RAM headroom, and simple storage expansion. Most self-hosted services are bottlenecked by memory, disk quality, or network design long before they need exotic CPUs.',
  'If you want Plex, Frigate, or AI experiments, think about GPU and media encoding early. If you want backups and family data, think about storage redundancy, snapshots, and restore testing before everything else.',
  'Keep noisy rack servers for cases where you really need PCIe lanes, lots of drives, or large memory pools. For many home labs, two efficient nodes plus a NAS is a better system than one huge server.',
];

const networkAdvice = [
  'Give the lab a clear gateway, stable subnets, and enough managed switching to separate trusted devices from experiments. Even a small setup benefits from separating infrastructure, servers, and IoT traffic.',
  'Use a router you understand, then decide whether you need VLANs, multiple SSIDs, PoE, or 2.5 GbE. Buy switches and access points that match that plan instead of mixing random hardware capabilities later.',
  'Good IP hygiene matters. Reserve predictable ranges for routers, switches, servers, and storage so your diagrams, config exports, and troubleshooting stay aligned.',
];

const upkeep = [
  'Use a password manager, MFA where possible, and distinct admin accounts.',
  'Keep public exposure minimal. Prefer VPN or a hardened reverse proxy over direct port forwards.',
  'Back up both application data and configuration data, then verify restore steps.',
  'Track updates for hypervisors, routers, container images, and firmware on a schedule.',
  'Add basic monitoring early so failed disks, hot CPUs, and expired certificates do not surprise you.',
];

const usageSteps = [
  'Create a project and place your core devices first: router, switch, access point, NAS, or server.',
  'Wire the topology on the canvas so HLBuilder knows which devices share a network path.',
  'Addresses are assigned as you connect things. Review them and look for devices that ended up without one: they are not connected to a router.',
  'Use the hardware catalog and service library to compare options and shape a realistic shopping list.',
  'Iterate on the design until the lab fits your budget, power limits, rack space, and future expansion plan.',
];

const whatItHelpsWith = [
  'Visual device placement for routers, switches, servers, NAS units, and more.',
  'Connection mapping so you can reason about topology instead of keeping it in your head.',
  'Automatic IP planning, which helps reveal missing routers or disconnected nodes.',
  'Service and hardware discovery so the design stage stays tied to actual workloads.',
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

const GOOGLE_CLIENT_ID_GUIDE =
  'https://developers.google.com/identity/gsi/web/guides/get-google-api-clientid';
const GOOGLE_CONSENT_GUIDE =
  'https://developers.google.com/workspace/guides/configure-oauth-consent';
const GOOGLE_BUTTON_GUIDE = 'https://developers.google.com/identity/gsi/web/guides/display-button';
const GOOGLE_VERIFY_GUIDE =
  'https://developers.google.com/identity/gsi/web/guides/verify-google-id-token';

const ssoSetupSteps = [
  {
    title: 'Create the Google OAuth client',
    body: 'In Google Cloud, create or select a project, open the Clients page, create a Web application client, and copy the OAuth client ID. Google says the client ID is required for the Sign in with Google button and for backend ID token checks.',
    sourceLabel: 'Google Identity Services setup',
    sourceUrl: GOOGLE_CLIENT_ID_GUIDE,
  },
  {
    title: 'Set the allowed browser origins',
    body: 'Add the exact HLBuilder origin to Authorized JavaScript origins. For local work, add http://localhost:5173 or http://127.0.0.1:5173. For a deployed install, add the public HTTPS origin, such as https://lab.example.com.',
    sourceLabel: 'Google client ID setup',
    sourceUrl: GOOGLE_CLIENT_ID_GUIDE,
  },
  {
    title: 'Configure the consent screen',
    body: 'In Google Auth platform, set the app name, support email, audience, contact email, and test users when the app is external and still in testing. Google says apps using OAuth 2.0 need a consent screen configuration.',
    sourceLabel: 'OAuth consent screen',
    sourceUrl: GOOGLE_CONSENT_GUIDE,
  },
  {
    title: 'Use only sign-in scopes',
    body: 'HLBuilder needs Google sign-in identity, not Google Drive, Gmail, or Calendar access. Google lists email, profile, and openid as the default authentication scope set for Sign in with Google.',
    sourceLabel: 'Google client ID setup',
    sourceUrl: GOOGLE_CLIENT_ID_GUIDE,
  },
  {
    title: 'Put the client ID into HLBuilder',
    body: 'Set GOOGLE_CLIENT_ID for the instance, and JWT_SECRET too, because HLBuilder creates its own app session after the Google ID token is accepted.',
    sourceLabel: 'The values to set',
    sourceUrl: '#sso-env',
  },
];

const ssoUsageSteps = [
  'Open HLBuilder and use the Google sign-in button on the login screen.',
  'Google returns an ID token to the browser. The HLBuilder frontend sends that credential to the backend login endpoint.',
  'The backend checks the token, creates or finds the user account, then returns the HLBuilder session token used by the app.',
  'After sign-in, create projects, save builder layouts, store theme preferences, and reopen the same account from another browser.',
];

const ssoChecks = [
  'If the Google button does not appear, confirm GOOGLE_CLIENT_ID is set for the backend and restart it: the browser asks the backend for the client ID when the app starts.',
  'If login fails after choosing a Google account, check that GOOGLE_CLIENT_ID on the backend is the ID of the client you configured above.',
  'If Google blocks the browser origin, compare the full scheme, host, and port in Authorized JavaScript origins.',
  'If a team wants Google Workspace-only access, add a backend allowlist for the Google hd claim before treating a domain as trusted.',
];

const ssoSources = [
  ['Google Identity Services setup', GOOGLE_CLIENT_ID_GUIDE],
  ['OAuth consent screen', GOOGLE_CONSENT_GUIDE],
  ['Sign in button behavior', GOOGLE_BUTTON_GUIDE],
  ['Server token verification', GOOGLE_VERIFY_GUIDE],
] as const;

/** A link to a source: out of the app unless it points at this page. */
function SourceLink({ href, children }: { href: string; children: ReactNode }) {
  const here = href.startsWith('#');
  return (
    <a
      href={href}
      {...(here ? {} : { target: '_blank', rel: 'noreferrer' })}
      className="app-link inline-flex items-center gap-1.5 text-sm"
    >
      {children}
      {!here && <ExternalLink className="size-3.5 shrink-0" aria-hidden="true" />}
    </a>
  );
}

/** Steps that happen in order: the number is part of what is said. */
function Steps({ children }: { children: ReactNode }) {
  return <ol className="grid [counter-reset:step]">{children}</ol>;
}

function Step({ children }: { children: ReactNode }) {
  return (
    <li className="grid grid-cols-[2rem_minmax(0,1fr)] border-t py-4 [counter-increment:step] first:border-t-0 first:pt-0 before:font-mono before:text-[0.8125rem] before:tabular-nums before:text-muted-foreground before:content-[counter(step)]">
      <div className="min-w-0 space-y-1.5">{children}</div>
    </li>
  );
}

/** Points that have no order. */
function Points({ items }: { items: string[] }) {
  return (
    <ul className="grid">
      {items.map(item => (
        <li key={item} className="border-t py-3 first:border-t-0 first:pt-0">
          {item}
        </li>
      ))}
    </ul>
  );
}

/** Anchors inside the part about Google sign-in, which is folded away until asked for. */
const SSO_ANCHORS = ['#google-sso', '#sso-env'];

export default function HomelabGuidePage() {
  const { hash } = useLocation();
  // The sign-in setup is for whoever runs the instance. A link to it opens it.
  const [ssoOpen, setSsoOpen] = useState(() => SSO_ANCHORS.includes(hash));
  // A new link into it opens it again, also after the reader folded it away.
  const [seenHash, setSeenHash] = useState(hash);
  if (hash !== seenHash) {
    setSeenHash(hash);
    if (SSO_ANCHORS.includes(hash)) setSsoOpen(true);
  }
  useEffect(() => {
    if (!SSO_ANCHORS.includes(hash)) return;
    // Once it is open the anchor has a place on the page to scroll to.
    requestAnimationFrame(() => document.getElementById(hash.slice(1))?.scrollIntoView?.());
  }, [hash]);

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
    <Page width="article" className="pb-24 text-[0.9375rem] leading-7">
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

      <header className="grid gap-5 pb-10">
        <h1 className="max-w-[22ch] text-4xl font-semibold leading-[1.05] tracking-[-0.035em] sm:text-5xl">
          How to build a homelab without turning it into a pile of random gear
        </h1>
        <p className="max-w-2xl text-lg leading-8">
          The best homelab is small, documented, and easy to recover. Start with one clear use case,
          design the network before the servers, keep storage and backups separate, and leave room
          to grow.
        </p>
        <p className="max-w-2xl text-muted-foreground">
          That is the pattern behind most stable home labs, whether the hardware is a mini PC, a
          NAS, or a rack server. HLBuilder helps at the planning stage: it turns the fuzzy idea of a
          future lab into a visible topology with hardware roles, links, and IP expectations, before
          you buy or rack anything.
        </p>
        <div className="flex flex-wrap items-center gap-x-6 gap-y-3 pt-1">
          <Link to="/" className={buttonVariants({ size: 'lg' })}>
            Open HLBuilder
          </Link>
          <Link to="/hardware" className="app-link text-sm">
            Browse the hardware catalog
          </Link>
          <Link to="/services" className="app-link text-sm">
            Browse the service library
          </Link>
        </div>
      </header>

      <PageRow
        id="order"
        title="The practical order for building a homelab"
        note="Most failed builds start with shopping. Good builds start with scope, network, and operations."
      >
        <Steps>
          {planningSteps.map(step => (
            <Step key={step.title}>
              <h3 className="font-semibold">{step.title}</h3>
              <p className="text-muted-foreground">{step.description}</p>
            </Step>
          ))}
        </Steps>
      </PageRow>

      <PageRow
        id="patterns"
        title="Starter homelab patterns"
        note="Choose a shape that matches your goals and your electricity bill."
      >
        <div className="app-table-scroll">
          <table className="app-table min-w-[36rem] text-[0.9375rem] leading-6">
            <thead>
              <tr>
                <th scope="col">Pattern</th>
                <th scope="col">What it is</th>
                <th scope="col">What it is for</th>
              </tr>
            </thead>
            <tbody>
              {starterStacks.map(stack => (
                <tr key={stack.title}>
                  <th scope="row" className="whitespace-nowrap">
                    {stack.title}
                  </th>
                  <td>{stack.summary}</td>
                  <td className="text-muted-foreground">{stack.details}</td>
                </tr>
              ))}
            </tbody>
          </table>
        </div>
      </PageRow>

      <PageRow
        id="hardware"
        title="Hardware advice that actually matters"
        note="Common buying advice is usually too generic. These constraints decide whether a lab stays usable."
      >
        <div className="max-w-[44rem] space-y-4">
          {hardwareAdvice.map(paragraph => (
            <p key={paragraph}>{paragraph}</p>
          ))}
        </div>
      </PageRow>

      <PageRow id="network" title="Network design basics for a real homelab">
        <div className="max-w-[44rem] space-y-4">
          {networkAdvice.map(paragraph => (
            <p key={paragraph}>{paragraph}</p>
          ))}
        </div>
      </PageRow>

      <PageRow id="upkeep" title="Security and maintenance checklist">
        <div className="max-w-[44rem]">
          <Points items={upkeep} />
        </div>
      </PageRow>

      <PageRow
        id="using-hlbuilder"
        title="How to use HLBuilder for homelab planning"
        note="The fastest way to get value from HLBuilder is to build the topology before the shopping list."
      >
        <div className="max-w-[44rem] space-y-8">
          <Steps>
            {usageSteps.map(step => (
              <Step key={step}>
                <p>{step}</p>
              </Step>
            ))}
          </Steps>
          <div>
            <h3 className="mb-3 font-semibold">What HLBuilder helps with</h3>
            <div className="text-muted-foreground">
              <Points items={whatItHelpsWith} />
            </div>
          </div>
        </div>
      </PageRow>

      <PageRow id="questions" title="Frequently asked questions">
        <dl className="grid max-w-[44rem]">
          {faqItems.map(item => (
            <div key={item.question} className="border-t py-4 first:border-t-0 first:pt-0">
              <dt className="font-semibold">{item.question}</dt>
              <dd className="mt-1.5 text-muted-foreground">{item.answer}</dd>
            </div>
          ))}
        </dl>
      </PageRow>

      <PageRow
        id="google-sso"
        title="Use Google SSO with HLBuilder"
        note="For whoever runs the instance. Without it, HLBuilder is a local workspace with no login."
      >
        <div className="max-w-[44rem] space-y-6">
          <p>
            HLBuilder uses Google sign-in on the frontend and verifies the returned Google ID token
            on the backend before creating an app session. This setup is a good fit for a personal
            lab, a family lab, or a small team that already uses Google accounts.
          </p>

          <details
            open={ssoOpen}
            onToggle={event => setSsoOpen(event.currentTarget.open)}
            className="group border-y"
          >
            <summary className="flex cursor-pointer list-none items-baseline justify-between gap-6 py-3.5 font-semibold focus-visible:outline-2 focus-visible:outline-offset-2 focus-visible:outline-ring [&::-webkit-details-marker]:hidden">
              Setup steps, environment values and troubleshooting
              <span className="font-mono font-normal text-muted-foreground" aria-hidden="true">
                <span className="group-open:hidden">+</span>
                <span className="hidden group-open:inline">&minus;</span>
              </span>
            </summary>
            <div className="space-y-10 pb-8 pt-4">
              <Steps>
                {ssoSetupSteps.map(step => (
                  <Step key={step.title}>
                    <h3 className="font-semibold">{step.title}</h3>
                    <p className="text-muted-foreground">{step.body}</p>
                    <SourceLink href={step.sourceUrl}>{step.sourceLabel}</SourceLink>
                  </Step>
                ))}
              </Steps>

              <div id="sso-env" className="scroll-mt-6 space-y-3">
                <h3 className="font-semibold">HLBuilder environment values</h3>
                <p className="text-muted-foreground">
                  Set GOOGLE_CLIENT_ID to the Google web client ID. The backend uses it to reject
                  tokens meant for another app, and passes it to the browser, which draws the
                  sign-in button with it. VITE_GOOGLE_CLIENT_ID is only a fallback for a frontend
                  that cannot reach the backend when it starts; the included Compose file fills it
                  from the same value.
                </p>
                <p className="text-muted-foreground">
                  Set JWT_SECRET to a long random value. HLBuilder uses that value for the app
                  session token after Google sign-in succeeds.
                </p>
                <pre className="app-code">
                  {`GOOGLE_CLIENT_ID=1234567890-example.apps.googleusercontent.com
JWT_SECRET=replace-with-a-long-random-string`}
                </pre>
              </div>

              <div className="space-y-3">
                <h3 className="font-semibold">How users sign in</h3>
                <Steps>
                  {ssoUsageSteps.map(step => (
                    <Step key={step}>
                      <p className="text-muted-foreground">{step}</p>
                    </Step>
                  ))}
                </Steps>
              </div>

              <div className="space-y-3">
                <h3 className="font-semibold">What the backend must check</h3>
                <p className="text-muted-foreground">
                  Google says a server should verify the ID token signature, confirm the aud value
                  matches the app client ID, confirm the iss value is accounts.google.com or
                  https://accounts.google.com, and reject expired tokens.
                </p>
                <p className="text-muted-foreground">
                  Google also says a Workspace domain check should use the hd claim. Do this on the
                  backend. A plain email suffix check is weaker because it does not prove the
                  account belongs to a Google Workspace domain.
                </p>
                <SourceLink href={GOOGLE_VERIFY_GUIDE}>Google ID token verification</SourceLink>
              </div>

              <div className="space-y-3">
                <h3 className="font-semibold">Troubleshooting</h3>
                <div className="text-muted-foreground">
                  <Points items={ssoChecks} />
                </div>
              </div>

              <div className="space-y-3">
                <h3 className="font-semibold">Sources used for the SSO guide</h3>
                <ul className="grid gap-1.5">
                  {ssoSources.map(([label, href]) => (
                    <li key={href}>
                      <SourceLink href={href}>{label}</SourceLink>
                    </li>
                  ))}
                </ul>
              </div>
            </div>
          </details>
        </div>
      </PageRow>
    </Page>
  );
}
