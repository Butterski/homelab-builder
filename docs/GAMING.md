# Gaming builds: LAN parties and game servers

Since 1.3 a build has a **kind**: `homelab`, `lan_party` or `game_server`. A homelab works exactly
as before. The two gaming kinds add a plan (your internet line, the venue's power circuits, the
event) and a report that checks the things that go wrong on the day: too little upload, a port
that cannot be forwarded, not enough addresses or switch ports, a breaker that trips.

- [Start a gaming build](#start-a-gaming-build)
- [Plan a LAN party](#plan-a-lan-party)
- [Plan a game server](#plan-a-game-server)
- [The Game plan report](#the-game-plan-report)
- [Devices and rules gaming builds add](#devices-and-rules-gaming-builds-add)
- [Files you get](#files-you-get)
- [With an LLM](#with-an-llm)
- [Known limits](#known-limits)

## Start a gaming build

- **Guided Planner** (`/planner`): the first question is what you are planning. Pick *LAN party*
  or *Game server*, answer a few questions and you get a wired, addressed build to refine.
  `/planner?kind=lan_party` and `/planner?kind=game_server` go straight to that plan.
- **New Project**: the dialog asks what the project is for.
- **An existing homelab**: open *Game Plan* from the project menu and change the kind under
  *Plan details*. Game servers you place in a homelab are checked in the report even if you leave
  the kind alone, and the *Game plan* button appears in the toolbar once there is one.

## Plan a LAN party

The planner asks for the number of players (up to 64), consoles, whether to add Wi-Fi, and what
the venue offers: mains voltage, breaker rating, how many separate circuits, the line speed and
the length of the event.

- **Tables.** Players are seated at LAN tables. A table is one node on the canvas that stands for
  its seats and the small switch on it. The planner seats as many per table as one circuit carries
  for hours: 8 at 230 V / 16 A, 4 at 120 V / 15 A. A seat is planned at 350 W (PC and monitor);
  change it per table.
- **Power.** A breaker should carry at most 80% of its rating for hours. A full table uses nearly
  all of that, so the planner asks for one circuit per table and one more for the server. Tables
  and devices are assigned to circuits in their properties; the report adds up each circuit.
- **Addresses.** A table has no address. Its seats take DHCP leases, and the router's pool grows
  to fit every seat and Wi-Fi device plus a quarter of headroom. The router card shows the pool.
  When that comes to more than 150 addresses (64 seats with Wi-Fi does), the planner uses the mask
  `255.255.254.0`, because a `/24` gets too tight.
- **Servers on site.** Optionally a local server with LANCache (game updates are downloaded once
  and served at LAN speed) and game servers for the whole room.

On the canvas you can add more tables, single PCs and consoles from the toolbox (the *Gaming*
presets have common consoles, two gaming PC builds and ready-made tables). A PC or console drawn
on its own counts as one seat.

## Plan a game server

Pick up to eight games and how many players are online at once, and optionally a Mumble voice
server. The planner sizes a host for them with a quarter of headroom (a mini PC up to 32 GB and
8 cores, a server beyond that), puts it behind your router, and records how friends reach it:

| Reachable | What it means | Needs |
|---|---|---|
| LAN only | Only devices on your network can join. | Nothing. |
| Port forward | Friends join over the internet through your router. | A public IPv4 address on your line, and the forwards from the report. |
| VPN | Friends join a private network first (Tailscale, WireGuard). | A VPN. Works behind carrier-grade NAT. |
| Relay | A relay or tunnel service publishes the server. | An account with such a service. Works behind carrier-grade NAT. |

You can also plan the server on a rented VPS instead of at home. It has a public address of its
own, so the report lists no forwards for it, only the ports to open in its firewall.

Each game server is a service on a host with **players**, **reachable** and a **port offset**.
Changing the players resizes the service. Two servers of the same game on one host or behind one
router need different port offsets; the report tells you when they clash.

Game servers come from the *Gaming* category of the service library: Minecraft (Java and Bedrock),
Valheim, Palworld, Counter-Strike 2, Terraria, Factorio, Satisfactory, Rust, ARK: Survival
Evolved, Project Zomboid, 7 Days to Die, Enshrouded and V Rising, plus LANCache, Pelican Panel,
Crafty Controller, Mumble and TeamSpeak 3. Drag one onto a server, PC or mini PC.

**Sizing is an estimate.** Ports, images and variables follow each game's own server
documentation. Memory, cores and upload per player are planning figures: enough to tell a mini PC
from a workstation, not a benchmark. Mods and large worlds need more.

## The Game plan report

*Game plan* in the builder toolbar opens the report for the saved build. It is recalculated after
every save. Each finding says what is wrong and what to do; *Show on canvas* selects the device.

For game servers it checks:

- what each server needs for its players, against what you gave it and what the host has;
- the **port forwards to add**, per router, with protocol, port and target address. Behind two
  routers every one of them needs the rule, and the report warns about the double NAT;
- two servers that need the same port on one host or one router;
- the **upload** remote players need against the upload of your line;
- **carrier-grade NAT**: with it, a port forward cannot work, and the report says to use a VPN,
  a relay or a VPS;
- a host that has no path to a router.

For a LAN party it checks:

- seats and Wi-Fi devices against the **DHCP pool**, and DHCP being off;
- tables that are not plugged in, a table switch too small for its seats (one port is the
  uplink), and free ports on your switches;
- the uplink of each table (slower than gigabit, or slower than the table's switch);
- the **load on each power circuit**: over 80% of the breaker is a warning, over its rating an
  error; equipment that is not on any circuit is added up separately;
- players on Wi-Fi only;
- download speed per seat, and a suggestion to run LANCache from 8 seats up.

The party checks also run in any build that has a LAN table. With the length of the event filled
in, the report estimates the energy the party uses.

Under *Plan details* you enter what the canvas cannot show: download and upload speed, whether
your line has a public address, and the address friends connect to. For a LAN party also the
mains voltage, the circuits with their breaker ratings, and the event's date and length.

## Devices and rules gaming builds add

| Device | Network | Address | Notes |
|---|---|---|---|
| LAN table (`lan_table`) | One cabled uplink to a switch or router | None; seats use DHCP | 1 to 24 seats. Cannot run services, hold components or sit in a rack. Offered in LAN party builds. |
| Console (`console`) | Cable or Wi-Fi | From the console block (`.30` up) | PlayStation, Xbox, Switch, handhelds. A leaf: no services, no components, not rack-mounted. |

- **Wi-Fi clients.** A PC, mini PC, SBC or console can be connected to an access point. That link
  is always wireless and does not use the access point's port, so any number of clients can join
  one access point. Set *Wi-Fi devices expected* on an access point for phones and laptops that
  are not drawn; they count towards the DHCP pool.
- **Power circuit.** Once the plan has circuits, every device has a *Power circuit* field.

## Files you get

The complete bundle from the Config Generator adds a `gaming/` folder. Each file is included only
when the build has something to put in it:

| File | Content | Included when |
|---|---|---|
| `gaming/<host>/docker-compose.yml` | The game servers on that host. One file per host. | A host runs game servers. |
| `gaming/<host>/.env.example` | Names and passwords to fill in, one set per server. | Same. |
| `gaming/port-forwards.csv` | The rules to add on your router(s). | A server behind a router is set to port forward. |
| `gaming/connect-sheet.md` | What to send your players: address and how to get in. No passwords. | The build has a game server or gaming tool. |
| `gaming/party-plan.md` | Tables, circuits, addresses, switch ports and what is left to fix. | A LAN party, or any build with a LAN table. |

Game servers are kept out of the homelab `docker-compose.yml`: they publish their ports on the
host instead of joining a shared network. A server that announces its own port (Valheim, Palworld,
CS2, Rust and most others) gets the same port inside and outside the container; Minecraft and
Terraria keep their default port inside.
7 Days to Die and V Rising have no suggested container image and are listed for a manual install.

The Config Generator also shows these compose files in a *Game Servers* tab, and the Setup Guide
adds steps for bringing the servers online and preparing the room.

## With an LLM

The MCP server and the in-app assistant know about gaming builds. They can read the report
(`gaming_report`), add game servers with players and exposure, add tables and consoles, and
propose changes to the plan (`set_plan`). As always they only propose: you review and apply.
The answer to a proposal already includes what the report would say once it is applied.

## Known limits

- The report produces the list of port forwards; it does not configure your router.
- A LAN table is one node. Individual seats at a table are not drawn and get no fixed address.
- The planner handles up to 64 seats and one subnet. VLANs, tournament brackets and quality of
  service are not modelled.
- The address friends connect to is part of your plan. It is left out of shared links, but the
  rest of the plan is visible to anyone with the link.
- ARK: Survival Ascended is not in the catalog: it has no native Linux server.
