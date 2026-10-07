import {
  lazy,
  Suspense,
  useEffect,
  useLayoutEffect,
  useRef,
  useState,
  type CSSProperties,
  type ReactNode,
} from 'react';
import { Link } from 'react-router-dom';
import { SeoMeta } from '../../../components/seo/seo-meta';
import { AFTER_LOGIN_KEY, releasePrerender } from '../../../lib/prerender';
import { APP_VERSION_LABEL } from '../../../lib/version';
import { AsciiRack } from '../components/ascii-rack';
import { useLive } from '../components/use-live';
import {
  DISCORD_URL,
  FAQS,
  FAQ_STRUCTURED_DATA,
  LANDING_DESCRIPTION,
  LANDING_TITLE,
  REPOSITORY_URL,
} from '../lib/content';
import type { DemoScenario } from '../lib/demo-plan';
import '../landing.css';

const LandingDemo = lazy(() => import('../components/landing-demo'));
// Loaded in the browser only: signing in pulls in the API client, which the
// build-time render of this page has no use for.
const GoogleLoginButton = lazy(() =>
  import('../../../components/auth/google-login-button').then(module => ({
    default: module.GoogleLoginButton,
  })),
);

/** True once the page runs in a browser; false in the HTML written at build time. */
function useMounted() {
  const [mounted, setMounted] = useState(false);
  useEffect(() => {
    // eslint-disable-next-line react-hooks/set-state-in-effect -- the one render that tells server HTML from the live page
    setMounted(true);
  }, []);
  return mounted;
}

/** Stars of the repository, asked from GitHub once per session. Nothing is shown if that fails. */
function useStars() {
  const [stars, setStars] = useState<number | null>(null);
  useEffect(() => {
    const cached = Number(sessionStorage.getItem('hlb-stars'));
    if (cached > 0) {
      // eslint-disable-next-line react-hooks/set-state-in-effect -- read from the session cache after the first paint
      setStars(cached);
      return;
    }
    const controller = new AbortController();
    fetch('https://api.github.com/repos/Butterski/homelab-builder', { signal: controller.signal })
      .then(response => (response.ok ? response.json() : null))
      .then((repo: { stargazers_count?: number } | null) => {
        if (!repo?.stargazers_count) return;
        sessionStorage.setItem('hlb-stars', String(repo.stargazers_count));
        setStars(repo.stargazers_count);
      })
      .catch(() => undefined);
    return () => controller.abort();
  }, []);
  return stars;
}

// ─── Layout ───────────────────────────────────────────────────────────────────

/** A section: its heading in the left rail, the thing itself beside it. */
function Row({
  id,
  title,
  lead,
  children,
}: {
  id?: string;
  title: string;
  lead?: ReactNode;
  children: ReactNode;
}) {
  return (
    <section className="lp-row lp-wrap" id={id}>
      <div className="lp-row-head">
        <h2>{title}</h2>
        {lead && <p>{lead}</p>}
      </div>
      <div className="lp-row-body">{children}</div>
    </section>
  );
}

function Points({ items }: { items: string[] }) {
  return (
    <ul className="lp-points">
      {items.map(item => (
        <li key={item}>{item}</li>
      ))}
    </ul>
  );
}

function Picture({ name, alt }: { name: string; alt: string }) {
  return (
    <figure className="lp-picture">
      <img
        src={`/landing/${name}.webp`}
        srcSet={`/landing/${name}-880.webp 880w, /landing/${name}.webp 1600w`}
        sizes="(min-width: 1024px) 760px, 100vw"
        width={1600}
        height={1073}
        alt={alt}
        loading="lazy"
        decoding="async"
      />
    </figure>
  );
}

// ─── The plan's paperwork ─────────────────────────────────────────────────────

const SPEC = [
  {
    term: 'Ports and cables',
    text: 'Every device has a real number of ports and every cable a speed. A full switch or a loop is refused while you draw.',
  },
  {
    term: 'Addresses',
    text: 'Each device a router can reach gets an address from the range of its role. Containers and virtual machines follow their host.',
  },
  {
    term: 'Capacity',
    text: 'Cores, memory, storage and watts are added up as you place services, so you see when a host is full.',
  },
  {
    term: 'Layout',
    text: 'Polish arranges the canvas: internet on top, every device under its port, no overlapping cards, no crossed cables in the tree.',
  },
  {
    term: 'Files',
    text: 'Docker Compose, an env file, an Ansible inventory and reverse proxy config, generated from the build.',
  },
];

const ADDRESSES = [
  { device: 'Lab Router', role: 'Router', range: '.1', address: '192.168.1.1' },
  { device: 'Core Switch', role: 'Switch', range: '.10 and up', address: '192.168.1.10' },
  { device: 'Wi-Fi Access Point', role: 'Access point', range: '.20 and up', address: '192.168.1.20' },
  { device: 'Storage NAS', role: 'NAS', range: '.100 and up', address: '192.168.1.100' },
  { device: 'Proxmox host', role: 'Server', range: '.150 and up', address: '192.168.1.150' },
  { device: 'Jellyfin', role: 'Container on that server', range: '.151 to .159', address: '192.168.1.151' },
  { device: 'Mini PC', role: 'Mini PC', range: '.170 and up', address: '192.168.1.170' },
];

function AddressTable() {
  const ref = useRef<HTMLDivElement>(null);
  useLive(ref);
  return (
    <div ref={ref} className="lp-surface lp-table-scroll lp-live">
      <table className="lp-table">
        <caption className="sr-only">Example address plan for 192.168.1.0/24</caption>
        <thead>
          <tr>
            <th scope="col">Device</th>
            <th scope="col">Role</th>
            <th scope="col" className="is-optional">
              Range
            </th>
            <th scope="col" className="is-end">
              Address
            </th>
          </tr>
        </thead>
        <tbody>
          {ADDRESSES.map((row, index) => (
            <tr key={row.device} style={{ '--i': index } as CSSProperties}>
              <th scope="row">{row.device}</th>
              <td className="lp-muted">{row.role}</td>
              <td className="is-figure is-optional lp-muted">{row.range}</td>
              <td className="is-figure is-end">
                <span className="lp-typed">{row.address}</span>
              </td>
            </tr>
          ))}
        </tbody>
      </table>
    </div>
  );
}

/** A proposal from an assistant while it waits for the owner's decision. */
function ProposalExample() {
  return (
    <div className="lp-surface lp-proposal">
      <div className="lp-panel-title">
        <span>Proposal from the assistant</span>
        <span>3 changes, not applied</span>
      </div>
      <p>&ldquo;Add a NAS for backups and put it on the core switch.&rdquo;</p>
      <ol>
        <li>
          Read the build <span>7 devices, 4 services</span>
        </li>
        <li>
          Searched the hardware catalog <span>4-bay NAS</span>
        </li>
        <li>
          Checked the network <span>no warnings</span>
        </li>
      </ol>
      <ul className="lp-diff">
        <li>Backup NAS, 192.168.1.100</li>
        <li>cable from Core Switch to Backup NAS, 1 GbE</li>
        <li className="is-changed">Restic moves from the mini PC to the NAS</li>
      </ul>
      <div className="lp-proposal-foot">
        <span className="lp-button is-primary is-small">Apply</span>
        <span className="lp-button is-small">Reject</span>
        Nothing is saved until you apply.
      </div>
    </div>
  );
}

const CIRCUITS = [
  { circuit: 'Circuit 1', feeds: 'Table 1, 8 seats', watts: 2810 },
  { circuit: 'Circuit 2', feeds: 'Table 2, 8 seats', watts: 2810 },
  { circuit: 'Circuit 3', feeds: 'Table 3, 6 seats', watts: 2110 },
  { circuit: 'Circuit 4', feeds: 'Server, core switch, Wi-Fi', watts: 440 },
];
const BREAKER_WATTS = 230 * 16;

/** The load on each circuit of a 22-player party, against what a 16 A breaker carries for hours. */
function PowerSchedule() {
  const ref = useRef<HTMLDivElement>(null);
  useLive(ref);
  return (
    <div ref={ref} className="lp-surface lp-table-scroll lp-live">
      <div className="lp-panel-title">
        <span>Power, 22 players</span>
        <span>230 V, 16 A breakers, kept under 80%</span>
      </div>
      <table className="lp-table">
        <thead>
          <tr>
            <th scope="col">Circuit</th>
            <th scope="col" className="is-optional">
              Feeds
            </th>
            <th scope="col">Load</th>
            <th scope="col" className="is-end">
              Watts
            </th>
          </tr>
        </thead>
        <tbody>
          {CIRCUITS.map((row, index) => {
            const load = Math.round((row.watts / BREAKER_WATTS) * 100);
            return (
              <tr key={row.circuit} style={{ '--i': index } as CSSProperties}>
                <th scope="row">{row.circuit}</th>
                <td className="is-optional lp-muted">{row.feeds}</td>
                <td>
                  <span
                    className={load >= 70 ? 'lp-load is-near' : 'lp-load'}
                    style={{ '--load': load } as CSSProperties}
                    role="img"
                    aria-label={`${load}% of the breaker`}
                  >
                    <span />
                  </span>
                </td>
                <td className="is-figure is-end">
                  {row.watts} W, {load}%
                </td>
              </tr>
            );
          })}
        </tbody>
      </table>
    </div>
  );
}

const FILES = [
  {
    id: 'compose',
    label: 'docker-compose.yml',
    code: `# Game servers on Game Server
# Generated by HLBuilder. Fill in .env before starting: docker compose up -d

services:
  valheim:
    image: ghcr.io/community-valheim-tools/valheim-server:latest
    container_name: valheim
    restart: unless-stopped
    ports:
      - "2456:2456/udp"
      - "2457:2457/udp"
    environment:
      SERVER_NAME: \${SERVER_NAME}
      WORLD_NAME: \${WORLD_NAME}
      SERVER_PASS: \${SERVER_PASS}
    volumes:
      - ./valheim/config:/config
      - ./valheim/server:/opt/valheim`,
  },
  {
    id: 'ports',
    label: 'Port forwards',
    code: `Forward on Lab Router (192.168.1.1)

Valheim     UDP  2456   to  192.168.1.151
Valheim     UDP  2457   to  192.168.1.151
Minecraft   TCP  25565  to  192.168.1.152

Upload for 10 Valheim players: about 1.5 Mbit/s.`,
  },
  {
    id: 'mcp',
    label: 'MCP client',
    code: `{
  "mcpServers": {
    "hlbuilder": {
      "url": "https://hlbldr.com/mcp",
      "headers": { "Authorization": "Bearer hlb_..." }
    }
  }
}`,
  },
];

function FilesExample() {
  const [active, setActive] = useState(FILES[0].id);
  const file = FILES.find(item => item.id === active) ?? FILES[0];
  return (
    <div className="lp-surface lp-files">
      <div className="lp-file-tabs" role="tablist" aria-label="Example files">
        {FILES.map(item => (
          <button
            key={item.id}
            type="button"
            role="tab"
            aria-selected={item.id === active}
            onClick={() => setActive(item.id)}
          >
            {item.label}
          </button>
        ))}
      </div>
      <pre className="lp-code" role="tabpanel">
        <code>{file.code}</code>
      </pre>
    </div>
  );
}

const COMPARISON = [
  { task: 'Draw a network that does not exist yet', diagram: 'Yes', ours: 'Yes', monitor: 'No' },
  {
    task: 'Know the ports, cores and watts of a device',
    diagram: 'No',
    ours: 'Yes',
    monitor: 'Reads them from the device',
  },
  {
    task: 'Assign every address before anything is plugged in',
    diagram: 'No',
    ours: 'Yes',
    monitor: 'No',
  },
  { task: 'Check capacity and power before you buy', diagram: 'No', ours: 'Yes', monitor: 'No' },
  { task: 'Generate Compose and config files', diagram: 'No', ours: 'Yes', monitor: 'No' },
  { task: 'Discover devices on a running network', diagram: 'No', ours: 'No', monitor: 'Yes' },
  { task: 'Show whether services are up', diagram: 'No', ours: 'No', monitor: 'Yes' },
];

function ComparisonTable() {
  return (
    <div className="lp-surface lp-table-scroll">
      <table className="lp-table lp-compare">
        <caption className="sr-only">
          What diagram tools, HLBuilder, and mapping and monitoring tools each do
        </caption>
        <thead>
          <tr>
            <th scope="col">
              <span className="sr-only">Task</span>
            </th>
            <th scope="col">Diagram tools</th>
            <th scope="col" className="is-ours">
              HLBuilder
            </th>
            <th scope="col">Mapping and monitoring</th>
          </tr>
        </thead>
        <tbody>
          {COMPARISON.map(row => (
            <tr key={row.task}>
              <th scope="row">{row.task}</th>
              <td>{row.diagram}</td>
              <td className="is-ours">{row.ours}</td>
              <td>{row.monitor}</td>
            </tr>
          ))}
        </tbody>
      </table>
    </div>
  );
}

const SELF_HOST = `git clone ${REPOSITORY_URL}.git
cd homelab-builder
cp .env.hosted.example .env
docker compose up -d`;

/** What Compose prints once the four containers of docker-compose.yml are up. */
const SELF_HOST_OUTPUT = [
  'Network homelab-builder_default     Created',
  'Container homelab-builder-db        Healthy',
  'Container homelab-builder-ipam      Started',
  'Container homelab-builder-backend   Started',
  'Container homelab-builder-app       Started',
];

function SelfHostExample() {
  const ref = useRef<HTMLDivElement>(null);
  useLive(ref);
  const [copied, setCopied] = useState(false);
  const copy = () => {
    void navigator.clipboard?.writeText(SELF_HOST).then(() => {
      setCopied(true);
      window.setTimeout(() => setCopied(false), 1800);
    });
  };
  return (
    <div ref={ref} className="lp-surface lp-live">
      <div className="lp-panel-title">
        <span>Docker Compose</span>
        <button type="button" onClick={copy} aria-live="polite">
          {copied ? 'Copied' : 'Copy'}
        </button>
      </div>
      <pre className="lp-code">
        <code>{SELF_HOST}</code>
        <samp>
          {SELF_HOST_OUTPUT.map((line, index) => (
            <span key={line} style={{ '--i': index } as CSSProperties}>
              {line}
            </span>
          ))}
        </samp>
      </pre>
      <p className="lp-panel-foot">
        Then open <code>http://localhost:3000</code>. With the Google variables left empty there is
        no login: it starts as a local workspace.
      </p>
    </div>
  );
}

/** Mounts the demo only when it is about to be seen: it brings React Flow with it. */
function DemoSlot({ onKeep }: { onKeep: (scenario: DemoScenario) => void }) {
  const ref = useRef<HTMLDivElement>(null);
  const [wanted, setWanted] = useState(false);

  useEffect(() => {
    const element = ref.current;
    if (!element || wanted) return;
    if (typeof IntersectionObserver === 'undefined') {
      const timer = window.setTimeout(() => setWanted(true));
      return () => window.clearTimeout(timer);
    }
    const observer = new IntersectionObserver(
      entries => {
        if (entries.some(entry => entry.isIntersecting)) setWanted(true);
      },
      { rootMargin: '600px 0px' },
    );
    observer.observe(element);
    return () => observer.disconnect();
  }, [wanted]);

  const poster = (
    <div className="lp-demo-poster">
      <p>
        The demo plans a homelab or a LAN party from a few choices and draws it with the real
        builder: devices, cables, addresses and power.
      </p>
    </div>
  );

  return (
    <div ref={ref} className="lp-surface">
      {wanted ? (
        <Suspense fallback={poster}>
          <LandingDemo onKeep={onKeep} />
        </Suspense>
      ) : (
        poster
      )}
    </div>
  );
}

// ─── Page ─────────────────────────────────────────────────────────────────────

export default function LandingPage() {
  const page = useRef<HTMLDivElement>(null);
  const mounted = useMounted();
  const stars = useStars();

  // The same page was sent as HTML; take that copy away now that this one is drawn.
  useLayoutEffect(() => {
    releasePrerender(page.current?.closest('main'));
  }, []);

  const keepPlan = (scenario: DemoScenario) => {
    sessionStorage.setItem(
      AFTER_LOGIN_KEY,
      scenario === 'lan_party' ? '/planner?kind=lan_party' : '/planner',
    );
    document.getElementById('start')?.scrollIntoView({ block: 'center' });
  };

  return (
    <div ref={page} className="landing dark">
      <SeoMeta
        title={LANDING_TITLE}
        description={LANDING_DESCRIPTION}
        path="/"
        structuredData={FAQ_STRUCTURED_DATA}
      />

      <nav className="lp-nav" aria-label="Page">
        <div className="lp-wrap">
          <a className="lp-brand" href="#top">
            <img src="/logo.svg" alt="" width={22} height={22} />
            HLBuilder
          </a>
          <div className="lp-nav-links">
            <a href="#demo">Demo</a>
            <a href="#addresses">Addresses</a>
            <a href="#assistant">Assistant</a>
            <a href="#lan-party">LAN party</a>
            <a href="#self-host">Self-host</a>
            <a href="/docs/">Docs</a>
          </div>
          <div className="lp-nav-actions">
            <a
              className="lp-button is-small"
              href={REPOSITORY_URL}
              target="_blank"
              rel="noopener noreferrer"
            >
              {stars ? `GitHub, ${stars.toLocaleString('en')} stars` : 'GitHub'}
            </a>
            <a className="lp-button is-primary is-small" href="#start">
              Sign in
            </a>
          </div>
        </div>
      </nav>

      <header className="lp-opening lp-wrap" id="top">
        <div className="lp-opening-text">
          <h1>Plan your homelab before you buy it.</h1>
          <p>
            HLBuilder is an open-source visual planner for homelabs, LAN parties and game servers.
            Put routers, switches, servers and storage on a canvas, wire them up, and get the IP
            plan, the hardware sizing and the config files for what you drew.
          </p>
          <div className="lp-actions">
            <a className="lp-button is-primary" href="#start">
              Start a project
            </a>
            <a className="lp-link" href="#self-host">
              or host it yourself
            </a>
          </div>
          <p className="lp-muted">
            Free and open source. Version {APP_VERSION_LABEL.slice(1)} adds planning for LAN
            parties and game servers.
          </p>
        </div>
        <div className="lp-rack-slot">
          <AsciiRack />
        </div>
      </header>

      <section className="lp-demo-section lp-wrap" id="demo" aria-label="Live demo">
        <DemoSlot onKeep={keepPlan} />
      </section>

      <section className="lp-statement lp-wrap">
        <p>
          A diagram tool gives you boxes and lines.{' '}
          <span>
            HLBuilder gives you devices with ports, cores, watts and addresses, and does the
            arithmetic.
          </span>
        </p>
      </section>

      <Row
        id="canvas"
        title="What the canvas knows"
        lead="A switch here is a switch: it has ports that fill up, a draw in watts and a place in the address plan."
      >
        <dl className="lp-spec">
          {SPEC.map(item => (
            <div key={item.term}>
              <dt>{item.term}</dt>
              <dd>{item.text}</dd>
            </div>
          ))}
        </dl>
      </Row>

      <Row
        id="addresses"
        title="Every device gets an address you can guess"
        lead="HLBuilder walks the cables outward from each router and hands out addresses by role. Look at an address and you know what kind of device it is."
      >
        <AddressTable />
        <Points
          items={[
            'A device with no path to a router gets no address, so a missing cable shows.',
            'Two routers on one subnet never hand out the same address.',
            'The DHCP pool grows with the seats and Wi-Fi clients you plan for.',
          ]}
        />
      </Row>

      <Row
        id="assistant"
        title="The assistant proposes. You approve."
        lead="Connect Claude Code, Cursor or any MCP client to the built-in MCP server, or use the chat in the builder with your own API key. Either can read a build and suggest changes. Neither can save one."
      >
        <ProposalExample />
        <Points
          items={[
            'A proposal is drawn on your canvas with every change marked.',
            'One Ctrl+Z undoes an applied proposal.',
            'Provider keys are stored encrypted and never sent back to the browser.',
          ]}
        />
      </Row>

      <Row
        id="lan-party"
        title="A LAN party where the breakers hold"
        lead="Say how many players are coming and what the venue's sockets carry. You get tables with their switches, a core switch with enough ports, a DHCP pool that fits everyone, and the load on every circuit."
      >
        <Picture
          name="lan-party"
          alt="A LAN party: tables of gaming PCs cabled to a core switch, a router and a server"
        />
        <PowerSchedule />
        <Points
          items={[
            'A table stands for its seats and its switch, so a 64-player party stays readable.',
            'The load on every circuit is checked against what its breaker carries for hours.',
            'You leave with a party plan, a connect sheet for players and the port list.',
          ]}
        />
      </Row>

      <Row
        id="game-servers"
        title="A game server for your friends, sized per player"
        lead="Minecraft, Valheim, Palworld, Counter-Strike 2, Factorio and more. Each server knows its ports and how friends reach it: LAN only, a port forward, a VPN or a relay."
      >
        <FilesExample />
        <Points
          items={[
            'Which ports to forward on which router, and whether two servers clash.',
            'Whether your upload is enough, and what carrier-grade NAT means for you.',
            'A Compose file per host, ready to start.',
          ]}
        />
      </Row>

      <Row
        id="fit"
        title="For the step before you plug anything in"
        lead="Tools that scan and watch a network are for what already runs. HLBuilder is for deciding what to build. They go well together."
      >
        <ComparisonTable />
      </Row>

      <Row
        id="self-host"
        title="Run it on your own lab"
        lead="A React app, a Go API, a small IP address service and PostgreSQL, from one Compose file. It runs on a Proxmox LXC, a mini PC or a NAS. The licence is AGPL-3.0."
      >
        <SelfHostExample />
        <div className="lp-actions">
          <a className="lp-link" href={REPOSITORY_URL} target="_blank" rel="noopener noreferrer">
            Source on GitHub
          </a>
          <a className="lp-link" href={DISCORD_URL} target="_blank" rel="noopener noreferrer">
            Discord
          </a>
          <a className="lp-link" href="/docs/">
            Docs
          </a>
        </div>
      </Row>

      <Row id="faq" title="Questions">
        <div className="lp-faq">
          {FAQS.map(faq => (
            <details key={faq.question}>
              <summary>
                <h3>{faq.question}</h3>
              </summary>
              <p>{faq.answer}</p>
            </details>
          ))}
        </div>
      </Row>

      <Row
        id="start"
        title="Start your first project"
        lead="Free. Your projects are saved to your account and open on any device."
      >
        <div className="lp-signin">
          {mounted && (
            <Suspense fallback={null}>
              <GoogleLoginButton />
            </Suspense>
          )}
        </div>
        <p className="lp-muted">
          Rather not sign in?{' '}
          <a className="lp-link" href="#demo">
            Use the demo
          </a>{' '}
          or{' '}
          <a className="lp-link" href="#self-host">
            host it yourself
          </a>
          .
        </p>
      </Row>

      <footer className="lp-footer">
        <div className="lp-wrap">
          <div>
            <a className="lp-brand" href="#top">
              <img src="/logo.svg" alt="" width={20} height={20} />
              HLBuilder
            </a>
          </div>
          <nav aria-label="Footer">
            <a href="/docs/">Docs</a>
            <Link to="/how-to-build-a-homelab">Homelab guide</Link>
            <Link to="/hardware">Hardware catalog</Link>
            <Link to="/services">Service library</Link>
            <a href={REPOSITORY_URL} target="_blank" rel="noopener noreferrer">
              GitHub
            </a>
            <a href={DISCORD_URL} target="_blank" rel="noopener noreferrer">
              Discord
            </a>
            <a
              href="https://github.com/sponsors/Butterski"
              target="_blank"
              rel="noopener noreferrer"
            >
              Sponsor
            </a>
            <Link to="/privacy">Privacy</Link>
            <Link to="/terms">Terms</Link>
          </nav>
        </div>
      </footer>
    </div>
  );
}
