# Inventory and Proxmox import

HLBuilder plans a homelab. The inventory tells it what you already own, and a connection to
Proxmox VE tells it what really runs on that hardware. With both, a plan stops being a wish list:
the machines on the canvas are your machines, the shopping list holds only what is missing, and
the plan can be laid beside what is deployed.

- [The inventory](#the-inventory)
- [Planning with what you own](#planning-with-what-you-own)
- [Connect Proxmox](#connect-proxmox)
- [Hosts and your inventory](#hosts-and-your-inventory)
- [Compare and import](#compare-and-import)
- [How the token is handled](#how-the-token-is-handled)
- [Operating it](#operating-it)
- [Known limits](#known-limits)
- [Where the code is](#where-the-code-is)

## The inventory

The inventory belongs to your account, not to a project. Every project plans with the same list.

- **Where it is.** Beside the canvas, in the library panel under *My inventory*, and on its own
  page, *Inventory* in the sidebar. *View all inventory* in the panel opens the full list without
  leaving the canvas.
- **What goes in it.**
  - *Devices*: server, mini PC, PC, single-board computer, NAS, router, switch, firewall, access
    point, modem, UPS, PDU, rack, console, IoT device.
  - *Components*: memory, disk, GPU, network card, HBA, processor.
  - *Accessories*: DAC cable, SFP module, cable, rack shelf, power adapter, anything else.
- **What an item says.** A name of your own ("Lenovo M75q #1"), manufacturer and model, the
  figures its type has (a mini PC has a processor, memory and storage; a switch has ports; a cable
  has none), how many you have of a component or accessory, where it is kept (rack, shelf, drawer,
  storage, elsewhere), its MAC addresses, its power draw, and notes.
- **Its state.** Available, in use, reserved, broken or sold. You set it; two things HLBuilder
  knows for a fact come first. An item reads as *in use* while a project plans every unit of it,
  and while it is the machine behind a Proxmox host. Broken and sold stay as you set them, and
  such items are kept on the list but not offered for planning.
- **A device that is on a canvas already.** Select it and choose *I own this: add it to my
  inventory* under *Physical machine*. The item is filled in from the device.

The full list is a table grouped by where things are kept, or by what they are, with a search
and a filter by state. *Planned in* names every project that uses an item, and as what.

## Planning with what you own

- **A device.** Drag it from *My inventory* onto the canvas, or click it. It becomes a device
  that is that machine, with its processor, memory, storage, ports and MAC address, and it is
  marked *Owned*. One machine is one device on a canvas: clicking it again shows where it is.
- **A component.** Drag memory, a disk or a card onto a server, PC, mini PC or NAS, or select the
  machine and click the component. Memory changes what the host has: a kit at least as large as
  what is fitted takes its place, a smaller one is added.
- **Asset and role are two things.** The device's name is its role in this project
  ("proxmox-01"). The machine keeps its own name ("Lenovo M75q #1"). *Physical machine* in the
  device's properties shows which item it is, links another one, or removes the link.
- **Variants.** The same item can be planned in several projects, for instance the lab as it is
  and the lab as it will be. A copy of a device on one canvas is a new device, not the same
  machine, so it loses the link.
- **Nothing to buy.** Owned hardware is left out of the shopping list.
- **Spare parts are offered.** When a host gives its guests more memory than it has and a kit in
  your inventory covers it, the device's properties and the readiness report say so ("pve02 gives
  its guests 24 GB and has 16 GB. You own 2× 16 GB DDR4 SODIMM (drawer): with it the host has
  32 GB. Nothing to buy."), and the device's properties put it in with one click.
  If the memory type is not noted on both the machine and the kit, you are asked to check that
  the modules fit.

## Connect Proxmox

*Integrations* in the library panel, or at the foot of the Inventory page, then *Connect Proxmox*.
HLBuilder only reads: every request it sends is a GET.

### Over the API

Make a token that can look at everything and change nothing. In a shell on a Proxmox host:

```bash
pveum user add hlbuilder@pve --comment "HLBuilder, read-only"
pveum user token add hlbuilder@pve hlbuilder
pveum acl modify / --users hlbuilder@pve --tokens 'hlbuilder@pve!hlbuilder' --roles PVEAuditor
```

The second command prints the secret once. Enter the address (`https://192.168.10.10:8006`), the
token id (`hlbuilder@pve!hlbuilder`) and the secret, then *Test connection*. Pasting
`hlbuilder@pve!hlbuilder=<secret>` into the token id field fills both.

A test answers with what is behind the address: the Proxmox version, the cluster, how many hosts,
virtual machines and containers. Only a connection that was tested can be saved.

**The certificate.** A fresh Proxmox uses a certificate no public authority signed. HLBuilder
does not accept it silently, and has no switch to ignore certificate errors. The first test stops
before anything is sent to the host and shows the certificate's SHA-256 fingerprint. Compare it
with the one Proxmox shows for the node under *System, Certificates* (or with
`pvenode cert info`), then *Trust this certificate*. From then on only that exact certificate is
accepted. If the host later presents another one, the reading fails and says so; if you renewed
the certificate, open *Connection*, test, check the new fingerprint and trust it.

**What a weaker token still gives.** If the token may not read everything, HLBuilder reads what
it may and lists what is missing: without `Sys.Audit` the hosts' processors and memory, without
`VM.Audit` the guests' addresses and network cards.

### From a pasted export

For an instance that cannot reach your network (the public site cannot, see
[below](#which-addresses-the-server-calls)), or one without a master key. In a shell on any host
of the cluster:

```bash
pvesh get /cluster/resources --output-format json
```

Choose *Paste an export* and paste what it prints. An export lists hosts, guests and storage with
their sizes. Processor models, addresses and network interfaces are only read over the API. To
refresh it, paste a new one under *Connection*.

## Hosts and your inventory

The first tab lists the hosts with what the cluster reports of each: processor, cores and
threads, memory, local storage, version, whether it is online, how many guests it runs.

For a host that is not linked yet, HLBuilder suggests the item of your inventory it may be, with
how sure it is and why ("Same processor: Ryzen 5 PRO 4650GE. Same memory: 32 GB (the host shows
31.2 GB). Same number of threads: 12."). A MAC address you noted on an item decides. You choose:

- **Link** takes the suggestion, **Choose another** any other machine of yours.
- **Add to inventory** makes a new item from what the cluster reports.
- Do nothing, and the host stays unlinked.

Nothing is linked by itself. A linked item shows in the inventory as in use, with "Runs as
pve01, online, 6 guests", and an import puts the host on the canvas as that machine.

## Compare and import

*Compare and import* lays a project beside the cluster. Choose the project, or *A new project*.

For every host you see the planned device it is taken for, and can say otherwise: another device,
a new one, or leave the host out. Then, planned beside real:

- **The machine.** Memory, storage and threads, each *Same* or *Differs*. A host shows somewhat
  less memory and storage than is printed on the parts, and that counts as the same. Where they
  differ, *Write the real figures into the plan* is offered.
- **Guests on both sides.** Matched by the Proxmox id of an earlier import, then by name. If the
  size differs, *Take the real size* is offered.
- **Only on Proxmox.** Ticked to be added to the plan; stopped guests start unticked.
- **Only in the plan.** Kept, unless you tick it to be removed. Proxmox does not see inside its
  guests, so a planned service may well run as a container inside one of the virtual machines.
- **Capacity.** For each host, what the plan gives its guests and what runs, against what the
  host has, the memory left free by the plan and as it runs, and a warning when a host is close
  to full. Under the hosts the same figures for all of them together.

**Nothing changes by itself.** An import into an existing project is a proposal, exactly like one
from an LLM: you see it on the canvas with every change marked, and apply or reject it. One
`Ctrl+Z` undoes an applied import. Importing the same cluster again changes nothing.

**A new project** is made at once: a router at the hosts' gateway, a switch, the hosts you chose
with their guests, arranged and addressed.

**Addresses.** A real address is taken over where the project's address plan can keep it: inside
the network of one of its routers, not used by anything else, and outside the range that router
hands out by DHCP. Any other machine gets the address the project gives it, and you are told how
many that were.

## How the token is handled

- **Stored encrypted.** The secret is sealed with AES-256-GCM under the instance's master key
  (the one that protects AI provider keys, see
  [AI-ASSISTANT-SECURITY.md](./AI-ASSISTANT-SECURITY.md#the-master-key)), bound to your account
  and to that integration, before it is written to the database.
- **Never shown again.** No response of the server contains it. The form shows "Stored. Leave
  empty to keep it."
- **Sent to one address.** It goes to the address you entered it for, and nowhere else. Change
  the address or the token id and the stored secret is deleted unless you enter it again; a
  changed address also forgets the trusted certificate. The client follows no redirects.
- **Read only.** The client can send nothing but GET. It reads `/version`,
  `/cluster/resources`, `/cluster/status`, each host's `status` and `network`, each guest's
  `config`, and for a running guest that takes its address from DHCP, the address it holds.
- **What is kept.** What was last read (hosts, guests, storage: names, sizes, addresses, MAC
  addresses) is stored with the integration, so comparing does not call your cluster. *Remove
  this integration* deletes the secret and what was read. Your inventory and your projects stay.
- **Audit log.** Creating and removing an integration, storing and deleting a secret, and a
  project made by an import are recorded, without the secret.
- **Not for LLMs.** Inventory and integrations are reached with your session only. Access tokens
  for MCP clients cannot read them, and they are not tools of the assistant.

### Which addresses the server calls

A Proxmox host sits on a private network, and a server that calls private addresses on request
can be turned against its own network. So the rule is the one for AI providers:

- Your own instance without login may call private addresses: that is where your cluster is.
- An instance with login, such as the public site, may not unless whoever runs it allows it, and
  says so in the form. It reads pasted exports. If you want the live reading, run your own copy
  next to the cluster.

Every connection is checked at the moment it is made, also after DNS has answered.

## Operating it

Nothing has to be set. The inventory is always there.

| Variable | Default | Meaning |
|---|---|---|
| `INTEGRATIONS_ENABLED` | `true` | Makes integrations (Proxmox) available |
| `INTEGRATIONS_ALLOW_PRIVATE_ENDPOINTS` | same as `ASSISTANT_ALLOW_PRIVATE_ENDPOINTS` | Whether the server may call a Proxmox host at a private address |
| `SECRETS_KEY` | - | The master key. Without one, on an instance with login in release mode, no secret can be stored and only pasted exports are read |

The root `docker-compose.yml` does not pass the two `INTEGRATIONS_` variables on. To change one,
add it to the backend's `environment:` there.

## Known limits

- An account keeps up to 500 inventory items and 5 integrations.
- The server calls a cluster for you at most 6 times a minute (12 in a row).
- A cluster is read in detail up to 32 hosts and 300 guests; beyond that guests are listed with
  their size and state. A pasted export may be up to 2 MB.
- One import into an existing project makes at most 100 changes. Untick some guests and import
  them next, or import into a new project, which has no such limit.
- A host holds up to 100 guests on the canvas.
- Proxmox VE only. Storage is compared by size; which disk is in which machine is not read.

## Where the code is

| What | Where |
|---|---|
| Kinds, figures, how an item reads as in use | `backend/internal/inventory/` |
| The inventory and where items are planned | `backend/internal/services/inventory_service.go` |
| The Proxmox client, exports, matching, comparing | `backend/internal/proxmox/` |
| Stored connections and the secret | `backend/internal/services/integration_service.go` |
| Comparing and importing | `backend/internal/services/proxmox_import.go` |
| Which addresses may be called | `backend/internal/netguard/` |
| The screens | `frontend/src/features/inventory/`, `frontend/src/features/integrations/` |

To try the import without a cluster, see "Proxmox in a browser, without a cluster" in
[ARCHITECTURE.md](./ARCHITECTURE.md).
