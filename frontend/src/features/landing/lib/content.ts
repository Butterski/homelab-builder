/** Texts of the landing page that are also published as structured data. */

export const LANDING_TITLE = 'HLBuilder | Plan your homelab before you buy it';

export const LANDING_DESCRIPTION =
  'HLBuilder is an open-source visual planner for homelabs, LAN parties and game servers. Draw the network and get the IP plan, hardware sizing and config files.';

export const REPOSITORY_URL = 'https://github.com/Butterski/homelab-builder';
export const DISCORD_URL = 'https://discord.gg/8PQb2M2fBB';

export type Faq = { question: string; answer: string };

export const FAQS: Faq[] = [
  {
    question: 'What is HLBuilder?',
    answer:
      'HLBuilder is an open-source web app for planning a home lab before you build it. You place routers, switches, servers, NAS units and other devices on a canvas and wire them together. It then assigns the IP addresses, adds up CPU, memory, storage and power, and generates config files for what you drew.',
  },
  {
    question: 'Is HLBuilder free?',
    answer:
      'Yes. The source code is on GitHub under the AGPL-3.0 licence. You can use the hosted version at hlbldr.com for free or run your own copy with Docker Compose.',
  },
  {
    question: 'Do I need an account?',
    answer:
      'The demo on this page needs none. The hosted version uses Google sign-in so your projects are saved to you. A self-hosted copy runs without any login: it starts with a local admin account and needs no Google setup.',
  },
  {
    question: 'How is it different from a diagram tool such as draw.io?',
    answer:
      'A diagram tool draws boxes and lines. HLBuilder knows what the boxes are: a switch has a number of ports, a server has cores and memory, a table at a LAN party has seats that each need an address and power. Because of that it can calculate addresses, warn about a full switch or an overloaded circuit, and export working files.',
  },
  {
    question: 'How is it different from network mapping and monitoring tools?',
    answer:
      'Mapping and monitoring tools scan a network that already exists and show whether its devices are up. HLBuilder does not scan anything. It is for the step before: deciding what to buy, how to cable it and which address each device gets. The two kinds of tool work well together.',
  },
  {
    question: 'How are IP addresses assigned?',
    answer:
      'Starting from each router, HLBuilder walks the cables you drew and gives every reachable device an address from a range that depends on its role: .1 for the router, .10 for switches, .20 for access points, .100 for NAS units, .150 for servers, .170 for mini PCs. Virtual machines and containers get the addresses right after their host. Devices that are not connected to a router get none, so a missing cable is easy to spot.',
  },
  {
    question: 'Can an AI assistant change my build?',
    answer:
      'Only with your approval. HLBuilder has a built-in MCP server for clients such as Claude Code, Cursor and VS Code, and an optional chat assistant that uses your own API key. Both can read a build and propose changes. A proposal is drawn on your canvas with every change marked, and nothing is saved until you press Apply.',
  },
  {
    question: 'Which game servers can it plan?',
    answer:
      'Minecraft, Valheim, Palworld, Counter-Strike 2, Factorio and more, along with LANCache, Mumble and server panels. Each server is sized by the number of players, knows which ports it needs and how friends reach it, and comes with a Docker Compose file for its host.',
  },
  {
    question: 'How do I self-host HLBuilder?',
    answer:
      'Clone the repository, copy .env.hosted.example to .env and run docker compose up -d. That starts four containers from published images: the web app, the API, the IP address service and PostgreSQL. With the Google variables left empty it opens straight into a local workspace.',
  },
];

export const FAQ_STRUCTURED_DATA = {
  '@context': 'https://schema.org',
  '@type': 'FAQPage',
  mainEntity: FAQS.map(faq => ({
    '@type': 'Question',
    name: faq.question,
    acceptedAnswer: { '@type': 'Answer', text: faq.answer },
  })),
};
