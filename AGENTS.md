# HLBuilder - AI Agent Reference

This document is the canonical reference for AI agents working on this codebase.
It covers project architecture, testing infrastructure, known pitfalls, and the decisions behind them.

REMEMBER THAT THIS IS JUST TO BUILD AN MVP, NOT A PRODUCTION READY APP! 
SO YOU CAN WIPE THE DATABASE AND REBUILD IT FROM SCRATCH IF YOU WISH.
IF IT WOULD BE FASTER TO REBUILD THE APP FROM SCRATCH, THEN DO IT.
DO NOT MAKE ANY "todo later" OR "include in production" CHANGES.
EVEN THOUGH THIS IS NOT A PRODUCTION THIS NEEDS TO WORK LIKE IT.

Test things in docker since I wanna keep my windows environment clean.
Remember - I don't want migrations scripts or Legacy things support. If something needs to be changed in the database, just update the models and let the database be recreated.

---

## Table of Contents

1. [Project Overview](#project-overview)
2. [Monorepo Layout](#monorepo-layout)
3. [Backend Architecture](#backend-architecture)
4. [HLBIPAM Microservice](#hlbipam-microservice)
   - [LLM Access: MCP Server and Assistant](#llm-access-mcp-server-and-assistant)
   - [Gaming Builds](#gaming-builds)
   - [Inventory and Proxmox Import](#inventory-and-proxmox-import)
5. [Frontend Architecture](#frontend-architecture)
6. [Data Model](#data-model)
7. [IP Assignment Algorithm](#ip-assignment-algorithm)
8. [Testing Infrastructure](#testing-infrastructure)
9. [Running Tests](#running-tests)
10. [Common Issues & Pitfalls](#common-issues--pitfalls)
11. [Fixed Bugs (Historical)](#fixed-bugs-historical)
12. [Environment Variables](#environment-variables)

---

## Project Overview

**HLBuilder** is a full-stack web app that lets users visually design their home lab network - placing hardware nodes (routers, switches, servers, NAS, etc.), wiring them, and automatically receiving IP address assignments and service recommendations.

- **Backend**: Go 1.25, Gin, GORM v1.31.1, PostgreSQL 17
- **HLBIPAM**: Standalone Go microservice for IP Address Management
- **Frontend**: React 19, TypeScript, Vite, ReactFlow, Zustand, Vitest
- **LLM access**: built-in MCP server (`/mcp`) and an opt-in, bring-your-own-key chat assistant; both can only propose changes
- **Gaming (1.3)**: a build has a kind (`homelab`, `lan_party`, `game_server`); the gaming kinds add a plan (internet line, power circuits, event) and a report computed on the backend
- **Canvas (1.3)**: Polish arranges the canvas with a layout engine of its own (`features/builder/lib/layout`); an LLM proposal is reviewed on the live canvas, not on a copy
- **Inventory**: the hardware a user owns belongs to the account, not to a build. An owned device dragged onto the canvas is that machine: it keeps its link to the item
- **Proxmox import**: a read-only connection to Proxmox VE, or a pasted export, says what really runs on that hardware. What differs from a build becomes a proposal the owner reviews; nothing is imported by itself
- **App pages**: every screen outside the canvas follows one design contract, `frontend/DESIGN.md` (see [App Pages](#app-pages))
- **Infrastructure**: Docker Compose (postgres + backend + hlbipam + frontend)

---

## Monorepo Layout

```
homelab-builder/
├── docker-compose.yml          # running your own copy: postgres + hlbipam + backend + frontend, from the published images or built from the checkout
├── docker-compose.test.yml     # test-specific compose overrides
├── Makefile                    # dev and test commands
├── AGENTS.md                   # this file
├── backend/
│   ├── cmd/
│   │   ├── server/main.go      # HTTP server entrypoint
│   │   ├── fakellm/main.go     # scripted stand-in for a model provider (development only, not in the image)
│   │   └── fakepve/main.go     # made-up Proxmox VE API over TLS (development only, not in the image)
│   ├── internal/
│   │   ├── assistant/          # LLM tool registry, chat agent, instructions
│   │   ├── config/config.go    # env var loading
│   │   ├── gaming/             # build kinds, gaming plan, game registry, sizing, report, game compose
│   │   ├── handlers/           # Gin route handlers (one file per domain)
│   │   ├── inventory/          # owned hardware: kinds, figures, how an item reads as in use, an item as a node
│   │   ├── llm/                # provider adapters (Anthropic, OpenAI-compatible); llmtest/ is the scripted provider
│   │   ├── mcpserver/          # /mcp endpoint: token auth, rate limits
│   │   ├── middleware/         # auth, admin, rate limiter, security headers
│   │   ├── models/models.go    # ALL GORM models in one file
│   │   ├── netguard/           # which addresses the server may call for a user (the LLM and the Proxmox client)
│   │   ├── proxmox/            # read-only Proxmox VE client, pasted exports, host matching, plan against reality; pvetest/ is the made-up cluster
│   │   ├── secrets/            # AES-256-GCM sealing of stored provider keys
│   │   ├── services/           # business logic; most tests live here
│   │   ├── testutil/           # Postgres transaction helper for packages outside services
│   │   └── version/version.go  # release number; a frontend test keeps package.json in step
│   ├── pkg/database/database.go # connection, AutoMigrate, Models() (every table)
│   ├── go.mod
│   ├── Dockerfile              # multi-stage: Go builder → alpine runtime
│   └── Dockerfile.test         # test runner image
├── hlbipam/                    # standalone IPAM microservice
│   ├── cmd/server/             # entrypoint
│   ├── internal/
│   │   ├── api/                # HTTP handlers
│   │   ├── core/               # allocator, subnet and address math (ip.go), types, validator
│   │   └── models/             # request and response DTOs
│   ├── Dockerfile
│   └── go.mod
├── frontend/
│   ├── src/
│   │   ├── features/           # domain-sliced feature modules
│   │   │   ├── admin/          # admin dashboard & management
│   │   │   ├── assistant/      # in-app chat panel (SSE client, store, components)
│   │   │   ├── auth/           # authentication (Google OAuth, profile)
│   │   │   ├── builder/        # visual network builder (main feature)
│   │   │   ├── catalog/        # hardware & service catalog browsing
│   │   │   ├── donate/         # donation page
│   │   │   ├── gaming/         # game plan dialog and report, game server / LAN table / console fields
│   │   │   ├── guides/         # the homelab guide (an article) and the diagrams of the static docs
│   │   │   ├── integrations/   # Proxmox: connection, hosts matched to the inventory, compare and import
│   │   │   ├── inventory/      # owned hardware: the panel beside the canvas, the inventory page, the item form
│   │   │   ├── landing/        # landing page for guests: demo on the real planners, prerendered into index.html
│   │   │   ├── legal/          # privacy policy, terms of service
│   │   │   ├── settings/       # settings page: appearance, AI assistant, MCP access
│   │   │   ├── setup-guide/    # the setup guide of a build: cables, addresses, hosts; ticked off and printed
│   │   │   └── survey/         # beta survey
│   │   ├── components/         # shared UI components
│   │   │   ├── auth/           # auth guards (RequireAuth)
│   │   │   ├── icons/          # icon components
│   │   │   ├── layout/         # sidebar with the project card; page.tsx is the frame of every page
│   │   │   └── ui/             # design system primitives (button, dialog, tick box, avatar, etc.)
│   │   ├── lib/                # shared utilities
│   │   │   ├── api.ts          # the one HTTP client (fetch): api.get/post/put/patch/del, ApiError, authHeaders()
│   │   │   ├── api-base.ts     # base URL of the backend (VITE_API_URL, or :8080 in dev)
│   │   │   ├── asset-link.ts   # which inventory item a node or component stands for
│   │   │   ├── format.ts       # formatMemory, plural: shared by the features
│   │   │   ├── prerender.ts    # the landing page copy in index.html: release, shared keys
│   │   │   ├── site.ts         # public site or somebody's own instance (decides landing page vs welcome screen)
│   │   │   ├── utils.ts        # cn, errorMessage
│   │   │   └── version.ts      # app version, taken from package.json at build time
│   │   ├── types/index.ts      # shared TypeScript types
│   │   ├── App.tsx             # root component with routing
│   │   ├── main.tsx            # React entry point
│   │   └── prerender.tsx       # landing page as HTML, built with `vite build --ssr`
│   ├── scripts/prerender.mjs   # last build step: writes that HTML into dist/index.html
│   ├── DESIGN.md               # the design contract of every screen outside the canvas
│   ├── nginx.conf              # "/" is index.html, app routes are app.html, the rest is 404
│   ├── vite.config.ts
│   └── package.json
└── docs/
    ├── MCP.md                  # connecting LLM clients over MCP
    ├── GAMING.md               # user guide: LAN party and game server builds
    ├── INVENTORY.md            # user guide: inventory and Proxmox import; how the token is handled
    ├── VIRTUAL-NETWORKS.md     # user guide: a host's virtual network editor
    └── AI-ASSISTANT-SECURITY.md # how provider keys and chat data are handled
```

---

## Backend Architecture

### Layers

```
HTTP Request → Gin Router → Middleware → Handler → Service → GORM → PostgreSQL
```

- **Handlers** (`internal/handlers/`): HTTP parsing, auth extraction, response shaping. No business logic.
- **Services** (`internal/services/`): All business logic. Receive `*gorm.DB` (or a transaction). Are the only layer covered by automated tests.
- **Models** (`internal/models/models.go`): GORM structs. All models are in a single file.

### Middleware

| File | Responsibility |
|---|---|
| `auth.go` | JWT-based `AuthMiddleware` and `AuthMiddlewareWithUser` (loads full user model) |
| `admin.go` | `AdminRequired()` - checks `IsAdmin` flag on loaded user |
| `rate_limiter.go` | Per-IP rate limiting for sensitive endpoints (login) |
| `security.go` | `SecurityHeaders()` - standard security response headers |

### Handlers

| File | Responsibility |
|---|---|
| `context.go` | `currentUser` and `uuidParam`: the caller and a UUID path parameter; each writes its own 401 / 400 |
| `auth.go` | Google OAuth login, dev login, get current user, update preferences |
| `build_handler.go` | Build CRUD, rename, duplicate, share links, topology save, validate-network |
| `hardware_handler.go` | Public hardware catalog, favorites, community submission + admin CRUD, bulk import, approve |
| `hardware_blueprint_handler.go` | Hardware blueprints: own list, create, import/export, share code, submit for review; admin moderation |
| `services.go` | Service catalog, own services and their submission to the community, admin create |
| `selections.go` | User service selections CRUD |
| `admin_handler.go` | Admin dashboard, user list, service management, anonymized topology export |
| `config_handler.go` | Config generation for builds |
| `catalog_component_handler.go` | Catalog component CRUD (admin) |
| `survey_handler.go` | Beta survey CRUD |
| `health.go` | Health check endpoint (also reports the version) |
| `gaming_handler.go` | Gaming report of a build (`GET /builds/:id/gaming-report`) |
| `proposal_handler.go` | Sync state poll, proposal get / apply / reject |
| `api_token_handler.go` | Personal access tokens for MCP clients (JWT only) |
| `assistant_handler.go` | Assistant settings, provider test, chat thread, chat stream (SSE) |
| `inventory_handler.go` | Inventory CRUD (`/api/inventory`); session only |
| `integration_handler.go` | Proxmox integrations (`/api/integrations`): test, save, read again, link hosts to items, compare with a build, import; session only |

### Key Services

| File | Responsibility |
|---|---|
| `build_service.go` | CRUD for builds; saves the submitted graph into the relational `nodes`/`edges` tables and recalculates IPs; stores the build kind and gaming plan |
| `build_snapshot.go` | `BuildToSyncInput`, `GetOwned`, `PreviewTopology` (dry run) |
| `proposal_service.go` | LLM proposals: propose, refresh, apply, reject, sync state |
| `topology_ops*.go`, `topology_ports.go`, `topology_layout.go`, `topology_diff.go` | Change-set engine behind proposals |
| `api_token_service.go` | Personal access tokens |
| `assistant_settings_service.go`, `assistant_thread_service.go` | Assistant settings with the encrypted key; stored chat |
| `ip_service.go` | Graph-aware BFS IP assignment per subnet; sends DHCP demand to hlbIPAM and stores each gateway's pool |
| `gaming_service.go` | Turns a build into `gaming.ReportInput`: gaming report, per-host game compose files, the `gaming/` files of the export bundle |
| `topology_gaming.go` | Rules for `console` and `lan_table`, the Wi-Fi association rule, table defaults, the `set_plan` operation, DHCP demand per node |
| `hardware_seed.go`, `default_service_seed.go`, `catalog_seed.go` | Startup seed of the hardware catalog (`hardware_seed.json`) and the service catalog; `SeedCatalog` runs both |
| `auth_service.go` | Google OAuth token verification, JWT issuance |
| `hardware_service.go` | Hardware catalog queries + admin operations |
| `recommendation_service.go` | Hardware tiers for a set of services (the assistant's `recommend_hardware` tool) |
| `service_service.go` | Service catalog CRUD, own services, community submissions |
| `selection_service.go` | User service selections |
| `config_service.go`, `export_service.go` | Config files of a build (compose, .env, Ansible inventory, nginx) and the export bundle; each loads the build once |
| `catalog_component_service.go` | Catalog component CRUD |
| `inventory_service.go` | Owned hardware per account; where each item is planned (read from the builds) and what its integration reports |
| `integration_service.go` | Proxmox connections: encrypted token secret, trusted certificate, the last snapshot, host-to-item links, outbound rate limit |
| `proxmox_import.go` | Compares a snapshot with a build (`Plan`) and turns the owner's choices into a proposal, or into a new build (`Import`) |

### Build Save Flow

Builds are stored as relational rows (`nodes`, `edges`, `virtual_machines`, `internal_components`), not as a JSON blob.

Every write goes through one path: `PUT /builds/:id/topology` -> `BuildService.UpdateAndCalculate` -> `SaveAndCalculateTx`:
1. Locks the build row and checks the revision the client sent (a stale revision returns 409 with the current build).
2. `syncGraph` replaces the build's nodes, edges, VMs and components with the submitted `SyncGraphInput`. Node, VM and component UUIDs sent by the client are kept; **edge IDs are regenerated on every save**, so nothing may refer to an edge by ID.
3. Runs the IP calculation (hlbIPAM) in the same transaction and bumps the revision.
4. IMPORTANT: `Preload("Nodes.VirtualMachines")` is required on all build fetches or VMs disappear from responses.

The same save carries the build's `kind` and `gaming_plan` (`applyKindAndPlan`). Both are optional in `SyncGraphInput`: an empty kind and a nil plan leave the stored values alone, so a client that does not know about them cannot wipe them. A save through a share link (`UpdateByShareToken`) never changes them, and whatever a share link gets back goes through `asSharedView`, which leaves out `gaming_plan.uplink.public_host`.

`BuildService.PreviewTopology` runs the same steps and then rolls the transaction back (sentinel `errDryRun`). It is how a proposal is checked without touching the build.

`BuildService.ListByUser` returns each build with its nodes and its edges, and without guests: that is what the projects page needs to draw every build in miniature.

---

## HLBIPAM Microservice

A standalone Go microservice (`hlbipam/`) responsible for IP Address Management. Runs as a separate Docker container on port 8081.

### Structure

```
hlbipam/
├── cmd/server/          # HTTP server entrypoint
├── internal/
│   ├── api/             # HTTP route handlers
│   ├── core/            # Core logic
│   │   ├── allocator.go # IP allocation engine
│   │   ├── ip.go        # IPv4 and CIDR helpers
│   │   ├── subnet.go    # Subnet calculations
│   │   ├── types.go     # Data types for network topology
│   │   └── validator.go # Network validation rules
│   └── models/          # Request and response DTOs
```

The backend communicates with HLBIPAM via `IPAM_URL` (default: `http://hlbipam:8081`).

A node may announce `dhcp_clients`: devices behind it that will ask for a lease (the seats of a `lan_table`, the Wi-Fi devices of an access point). The allocator adds them up per subnet, sizes the DHCP pool for the sum with a quarter of headroom (`DHCPHeadroom`), and returns the pool with each router result (`dhcp_start`, `dhcp_end`, `dhcp_size`, `dhcp_clients`). It warns when the demand does not fit the subnet or DHCP is off. With no demand the pool is the same as before 1.3.

---

## LLM Access: MCP Server and Assistant

Two ways for an LLM to work with a user's builds. Both use the same tool registry and the same rule: **an LLM never writes to a build**. It creates a proposal, and only the owner's Apply in the web UI saves it.

User-facing docs: `docs/MCP.md` (client setup) and `docs/AI-ASSISTANT-SECURITY.md` (key handling, threat model).

### Pieces

| Package / file | Responsibility |
|---|---|
| `internal/assistant/tools*.go` | Tool registry shared by MCP and the chat: `list_builds`, `get_build`, `validate_build`, `generate_configs`, `gaming_report`, `search_hardware`, `list_services`, `recommend_hardware`, `get_proposal`, `propose_changes`, `create_build` (MCP only). `Registry.Call` validates arguments against the tool's JSON schema, enforces the actor's scope and build restriction, and audits state-changing calls. |
| `internal/assistant/instructions.go` | The fixed domain primer: MCP server instructions and the chat system prompt. |
| `internal/assistant/agent.go` | Chat loop for the in-app assistant: one turn per user at a time, at most 12 model calls per message, history stored append-only. Streams what it does as events (see Chat events). |
| `internal/mcpserver/` | `/mcp` endpoint (official `modelcontextprotocol/go-sdk`, stateless streamable HTTP). Authenticates a personal access token, rate-limits per token, and builds a per-request server exposing only the tools the token's scope allows. |
| `internal/llm/` | Provider adapters behind one `Provider` interface: Anthropic (official SDK) and OpenAI-compatible (OpenAI, Gemini, OpenRouter, Ollama, custom). `Stream` takes `StreamHandlers`: text as it is written, the start of a tool call, and how many bytes of its arguments exist so far. `ssrf.go` checks a base URL and builds the HTTP client that dials through `netguard`. |
| `internal/llm/llmtest/`, `cmd/fakellm/` | A scripted OpenAI-compatible provider. Go tests run the real adapter against it; `go run ./cmd/fakellm` serves it so the chat can be driven in a browser without a key (see Running Tests). |
| `internal/secrets/` | AES-256-GCM sealing of provider keys, bound to the owner through the AAD. |
| `services/proposal_service.go` | Propose (dry run + diff), Refresh, Apply (replays the operations on the latest revision), Reject, SyncState. |
| `services/topology_ops*.go`, `topology_gaming.go` | Applies a change set (`add_node`, `connect`, `add_vm`, `set_plan`, ...) to a `SyncGraphInput` in memory. Mirrors the canvas rules: port handles, port counts, cable orientation, loop rejection, rack slots, Wi-Fi association, auto layout. |
| `services/topology_diff.go` | Diff between two builds, shown during a review: on the canvas and in the list of changes. Covers the gaming plan and the game settings of a guest, so a proposal that changes only those still counts as a change. |
| `services/api_token_service.go` | Personal access tokens (`hlb_...`): only the SHA-256 is stored; scopes `read` / `propose`; optional single-build restriction. |
| `services/assistant_settings_service.go` | Per-user provider, model and encrypted key. `LoadKeyring` picks the master key (`SECRETS_KEY`, or a generated one kept in `system_settings` on instances without login). |
| `services/assistant_thread_service.go` | Stored chat messages: provider-neutral parts plus the provider's native message for replay. A tool result part also keeps `summary` and `duration_ms` for display. NUL characters are taken out before a row is stored (pitfall 27). |

### Proposal flow

```
propose_changes (MCP tool or chat tool)
  -> ApplyTopologyOps(current build, ops)      in memory, new entities get their final UUIDs
  -> BuildService.PreviewTopology              dry run: save + IPAM + validation, rolled back
  -> DiffBuilds                                stored with the proposal (status: pending)
builder polls GET /builds/:id/sync-state every 4s
  -> from an MCP client: a banner; from the chat: opens by itself
  -> reviewed on the live canvas (see Frontend Architecture)
POST /builds/:id/proposals/:pid/apply          replays the ops on the latest revision, then saves
```

- One pending proposal per build: a new one supersedes the older.
- A proposal says where it comes from (`source`): `mcp`, `chat` or `import` (a Proxmox import, see [Inventory and Proxmox Import](#inventory-and-proxmox-import)). All three are reviewed and applied the same way.
- Apply rebases: edits saved after the proposal was created are kept. If the operations no longer fit, the proposal becomes `conflict` (409).
- Connections are addressed by their unordered node pair, never by edge ID.
- New entities keep their UUIDs in the stored operations, but a canvas position the server chose is not stored with them: `placeNodes` runs again on refresh and on apply, against the canvas as it is then. A position the model gave explicitly stays.
- `set_plan` is a JSON merge patch on the gaming plan (plus an optional kind), so it replays on a newer revision like any other operation. The answer to `propose_changes` carries the gaming report of the dry run (`gaming: {status, issues}`).
- The tools and `assistant.Instructions` do not vary by build kind: the instructions are byte-stable for prompt caching. The kind reaches the chat model through the per-turn context note in `agent.go`.

### Chat events

`POST /api/assistant/chat` answers with server-sent events (`agent.go`, consumed by `features/assistant/api/chat.ts`):

| Event | Carries |
|---|---|
| `turn_start` | thread and message id, provider, model |
| `text_delta` | a piece of the visible reply |
| `tool_pending` | `step`, `index`, `name`, `title`, `bytes`: the model has begun a tool call and is still writing it. Sent at the start and then at most every 300 ms. |
| `tool_call` | `id`, `name`, `title`, `detail`, `step`, `index`: the call is complete and about to run. `step`/`index` match the `tool_pending` before it. |
| `tool_result` | `id`, `name`, `ok`, `duration_ms`, and `error` or `summary` with `focus` (node ids the call was about) |
| `proposal` | the proposal summary |
| `notice` | `text` for the user, for example that the step limit was reached |
| `error` | `code`, `message`; ends the turn |
| `done` | `full`: the conversation reached its length limit |

- `detail` comes from `Registry.Describe` (per tool, from the arguments: "2.5G switch", "5 operations"), `summary` and `focus` from the tool's `Result`. MCP clients get `Result.Data` only.
- A request may carry `selection`: node ids selected on the canvas. `selectedNodes` keeps only nodes of that build, and the context note names them from the build's own data.
- When a model call fails or is stopped after text was written, that text is stored as an interrupted assistant row, so the transcript and the next turn agree on what was said.
- `GET /api/assistant/threads/:buildId` returns `running` while a turn on that build is still being worked on.

### Rules that must not be broken

- A provider key is write-only. `AssistantSettings` key fields are `json:"-"`; only `AssistantSettingsService.ResolveCredentials` decrypts, for one request. Never log, return or store the plaintext.
- Changing the provider or base URL wipes the stored key unless a new key comes in the same request.
- Provider SDK clients are built with explicit options only (`NewBetaMessageService`, `NewChatCompletionService`, ...). The SDKs' default clients read credentials from the server's environment, which must never be used for a user's request.
- All provider calls use `AssistantSettingsService.HTTPClient()` (`llm.SafeHTTPClient`): it checks the resolved address on every dial.
- `/mcp` always requires a token, also when `AUTH_DISABLED` is on. JWT routes never accept an access token, so a token cannot mint tokens.
- The SQL logger runs with `ParameterizedQueries: true`: statement values (chat text, ciphertext) never reach the log. Keep it that way.
- Model output is untrusted: the chat renders Markdown without raw HTML and without images.
- The short texts next to a step (`detail`, `summary`, a tool name) are built from what the model wrote. The server cuts them to one line of 80 characters (`brief`); the client shows them as plain text, never as Markdown.
- A proposal under review is drawn from `proposalPreview`. The store's live `nodes` and `edges` are not replaced, so autosave cannot see a proposal (pitfall 23).

---

## Gaming Builds

Since 1.3 a build has a **kind**: `homelab` (the default), `lan_party` or `game_server`. A homelab build behaves as before. The gaming kinds add a plan and a report. User guide: `docs/GAMING.md`.

### Pieces

| Package / file | Responsibility |
|---|---|
| `internal/gaming/kind.go`, `plan.go` | `Kind` and `Plan` (uplink, power circuits, event). Stored as `builds.kind` and `builds.gaming_plan` (jsonb). `Plan.Normalize` validates and never adds defaults, so the server returns a plan exactly as it was saved. |
| `internal/gaming/profiles*.go` | The game registry: one `Profile` per game or tool (ports, image, env, per-player figures). Attached to catalog services as the transient `Service.Game` in `Service.AfterFind`; it is not a column. |
| `internal/gaming/instance.go`, `sizing.go` | A game server is a guest with `details.game = {profile, players, exposure, port_offset}`. `SizeServer` is base plus per player; `ResolvePorts` adds the offset. |
| `internal/gaming/report*.go` | `ComputeReport`: pure functions over a flat `ReportInput`. Server checks run for every build; party checks run for `lan_party` and for any build with a `lan_table`. Every `Issue` has a stable `Code`. |
| `internal/gaming/compose.go` | One compose file and `.env.example` per host for its game servers. |
| `internal/gaming/merge.go` | `MergePlan` (the merge patch behind `set_plan`) and `DiffPlans`. |
| `services/gaming_service.go` | Build to `ReportInput`; serves `GET /api/builds/:id/gaming-report`; `GameComposeFiles`; the `gaming/` files of the export bundle. |
| `services/topology_gaming.go` | Rules for the two gaming node types, shared by the save path and the change-set engine. |
| `frontend/src/features/gaming/` | Game plan dialog (report and plan details), game server settings on a guest, table / console / circuit fields. `lib/sizing.ts` and `lib/table.ts` repeat the backend's arithmetic for instant feedback; the report always comes from the backend. |
| `frontend/src/features/builder/lib/planner/` | Pure plan builders behind `/planner`: `homelab-plan.ts`, `lan-party-plan.ts`, `game-server-plan.ts`. |
| `frontend/src/features/builder/lib/connection-rules.ts` | `checkConnection`: the canvas copy of the connection rules. |

`internal/gaming` imports nothing internal, so `models`, `services` and `assistant` can all use it.

### Node types

- `console`: a leaf with one link, cabled or Wi-Fi. IP zone offset 30. No guests, no components, not rack-mountable.
- `lan_table`: N seats and their table switch as one node (`details.seats`, `seat_watts`, `switch_ports`, `switch_speed`). It has no address; one cabled uplink to a switch or router. `power_draw` is seats x seat_watts + 10 unless set by hand. A `pc` or `console` drawn on its own counts as one seat.
- `details.circuit` on any powered node names a circuit of the plan. `details.wifi_clients` on an access point counts devices that are not drawn.

### DHCP demand

Table seats and `wifi_clients` are sent to hlbIPAM as `dhcp_clients`. The pool of a subnet grows to `max(default, ceil(demand x 1.25))`; with no demand it is unchanged, so homelab allocations do not move. The backend stores the result as `details.dhcp_pool {start, end, size, clients}` on the gateway. That key is derived (see pitfall 15).

### Rules that exist in more than one place

Change them together.

| Rule | Backend save | Change-set engine | Canvas |
|---|---|---|---|
| Wi-Fi association: `access_point` to `pc` / `minipc` / `sbc` / `console` is always wireless, needs no hub and does not take the access point's port | `build_service.go` (`validateEdgeEndpoints`) | `topology_ops_connections.go`, `topology_ports.go` | `connection-rules.ts` |
| A `lan_table` has one cabled uplink; `lan_table` and `console` cannot sit in a rack | `build_service.go` | `topology_ops.go`, `topology_ops_connections.go` | `connection-rules.ts`, `visual-builder.tsx` |
| Table defaults: switch size for the seats, power draw | `topology_gaming.go` | `topology_gaming.go` | `features/gaming/lib/table.ts` |
| Game server sizing and ports | `gaming/sizing.go` | `topology_ops_guests.go` | `features/gaming/lib/sizing.ts` |

A new node type has to be added in: hlbIPAM `core/types.go`; backend `build_service.go` (known types), `ip_service.go` (`nonNetworkTypes` if it has no address), `topology_ops.go` (addable types, default names), `taxonomy.go`, `testutil/pgtest.go` (the IPAM stub); `assistant/instructions.go` and `tools_proposals.go`; frontend `types/index.ts`, `lib/hardware-config.ts`, `lib/hardware-taxonomy.ts`, and in `features/builder`: `hardware-node.tsx`, `hardware-toolbox.tsx`, `lib/layout/structure.ts` (`UPSTREAM_RANK`, `TYPE_ORDER`) and, if its card is built differently, `lib/layout/from-flow.ts` (`estimateNodeSize`).

---

## Inventory and Proxmox Import

Two connected things. The **inventory** is what a user owns; a **Proxmox import** is what really runs on it. User guide: `docs/INVENTORY.md`.

### Pieces

| Package / file | Responsibility |
|---|---|
| `internal/inventory/` | Pure rules: kinds (`device`, `component`, `accessory`) and their types, `Specs`, `Item.Normalize`, `State` (how an item reads), `Item.NodeDetails` (an item as a node). Imports nothing internal. |
| `services/inventory_service.go` | `inventory_items` per account. `List` adds to each item its placements (read from `nodes` and `node_components` of the user's builds), what its integration last reported, and the derived `state`. |
| `internal/netguard/` | Which addresses the server may call for a user. `llm/ssrf.go` and the Proxmox client both use it: one policy. |
| `internal/proxmox/` | `client.go` reads a cluster (GET only); `payload.go` parses the API's resources and a pasted export; `match.go` suggests which inventory item a host is; `reconcile.go` compares hosts and guests with a plan. Everything but the client is pure. |
| `internal/proxmox/pvetest/`, `cmd/fakepve/` | A made-up cluster. Go tests run the real client against it; `go run ./cmd/fakepve` serves it over TLS for a browser (see Running Tests). |
| `services/integration_service.go` | `integrations` per account: address, token id, encrypted secret, trusted certificate, the last snapshot. `Test`, `Sync`, `LinkItem`, `CreateItemFromHost`. |
| `services/proxmox_import.go` | `Plan` (the comparison; changes nothing) and `Import` (a proposal for an existing build, a new build otherwise). |
| `frontend/src/features/inventory/` | The panel beside the canvas, the inventory page and dialog, the item form, the "Physical machine" block of a selected device. `lib/place.ts` puts an item on the canvas. |
| `frontend/src/features/integrations/` | The Proxmox dialog (connection, hosts and inventory, compare and import) and the Integrations section of the panel and of the inventory page. |
| `frontend/src/lib/asset-link.ts` | Reads and removes the link between a node or component and an inventory item. |

`internal/inventory` and `internal/proxmox` import nothing of `services`, so the rules can be tested without a database.

### An item on the canvas

- The inventory belongs to the account. A build does not own an item, it points at one: `details.inventory_item_id` on a node or an internal component, with `details.inventory_label` (the item's name, so a build still says what the machine is on a share link, or after the item was deleted) and, for a component, `details.inventory_quantity`.
- The node's name is its role in the build ("proxmox-01"); the item keeps its own ("Lenovo M75q #1"). Renaming one does not touch the other.
- One device is one node on a canvas: placing it again selects the node it is. The same item may be planned in several builds, which may be variants of each other.
- Where an item is planned is never stored with the item. `InventoryService.placements` reads it from the builds.
- `status` is what the owner set; `state` is what lists show. `inventory.State` makes an available item "in use" when a build plans every unit of it, or when it is the machine behind a host an integration reads. Broken and sold stay as set.
- Memory is an internal component of type `ram` (`ComponentType = HardwareType | 'ram'`); a host's capacity stays `details.ram`. A kit at least as large as what is fitted takes its place, a smaller one is added (`ramAfterInstall`). `lib/upgrade-hints.ts` offers spare memory to a host that is short of it, in the device's panel and in the readiness report.
- A copy is not the same machine: duplicating a node, or saving it as a blueprint, drops the link and the MAC address (pitfall 39).

### Proxmox: reading

- A connection is an address, a token id (`user@realm!name`) and the token's secret. Nothing is ever written to a cluster: the client sends GET only.
- The first calls (`/version`, `/cluster/resources`) must succeed. The rest (`/cluster/status`, each host's `status` and `network`, each guest's `config`, the addresses of running guests) is read where the token may, and left out with a line in `Snapshot.Notes` where it may not.
- What was read is stored with the integration (`integrations.snapshot`, jsonb). Comparing and importing work on the stored snapshot; only Test, Save and "Read again" call the cluster.
- An instance that may not call private addresses, or has no master key, reads a pasted export instead: the output of `pvesh get /cluster/resources --output-format json`. It lists hosts, guests and storage with their sizes; processor models and addresses are not in it.
- `match.go` scores an inventory device against a host (processor model, memory, threads, name; a MAC address or an existing link decides). The owner links; nothing is linked by itself.

### Proxmox: importing

```
POST /api/integrations/:id/reconcile  {build_id?, hosts?}   -> ImportPlan    (changes nothing)
POST /api/integrations/:id/import     ImportDecision        -> ImportResult
  existing build: change set -> ProposalService.Propose (source "import") -> reviewed on the canvas
  no build:       a router at the hosts' gateway, a switch, the chosen hosts and guests, written directly
```

- A host is paired with a planned device by the owner's choice, then by `details.proxmox_node`, then by the inventory item both point at, then by name (`PairHosts`). A guest is paired by `details.proxmox_vmid`, then by name.
- An import into an existing build never writes. It is a proposal like an LLM's, with the same review, Apply and undo, and it is one proposal: at most `MaxTopologyOps` changes.
- Guests that are stopped are left out unless ticked; a planned guest that is not on the cluster stays unless the owner removes it. Proxmox does not see inside its guests, so "only in the plan" may well be a container inside a virtual machine.
- Real addresses are taken over only where the address plan keeps them: inside the network of a router of the build, unused, and outside that router's DHCP range (pitfall 38). `ImportResult` says how many were left to the plan.
- A second import of the same cluster changes nothing: imported guests carry `proxmox_vmid`, imported hosts `proxmox_node`.

### Rules that must not be broken

- The token secret is write-only. The secret fields of `Integration` are `json:"-"`; only `IntegrationService.openSecret` decrypts, for one reading. It is sealed with the same keyring as provider keys (`SECRETS_KEY`) and bound to the owner and the integration through the AAD. Never log, return or store the plaintext.
- A stored secret is used only for the address and token id it was stored for. Changing either wipes it unless a new secret comes in the same request; a changed address also forgets the trusted certificate.
- A certificate no public authority signed is not accepted silently. `Client.verify` reports its SHA-256 before anything is sent; the owner trusts it, and from then on only that certificate is accepted (`tls_fingerprint`). There is no switch that ignores certificate errors.
- Every dial goes through `netguard.DialControl`. The client follows no redirect and takes no proxy from the environment.
- Inventory and integration routes take a session only, never an access token, and are not LLM tools.
- The server calls out for one user at most 6 times a minute (burst 12), whichever route asks.

### Rules that exist in more than one place

Change them together.

| Rule | Backend | Frontend |
|---|---|---|
| An item as a node: which details it brings | `inventory.Item.NodeDetails` | `inventoryItemToDragData` in `features/inventory/lib/inventory.ts` |
| Kinds, types, places | `internal/inventory/inventory.go` | `features/inventory/lib/inventory.ts` (`TYPES`, `LOCATIONS`) |
| The details that name the asset | `inventory.DetailItemID`, `DetailLabel`, `DetailQuantity`; `services.DetailProxmoxNode` | `lib/asset-link.ts` (`ASSET_DETAIL_KEYS`) |
| What an import counts as one change | `proxmox_import.go` (`buildOps`) | `features/integrations/lib/import-selection.ts` (`countChanges`) |

---

## Frontend Architecture

### State Management (Zustand)

The builder feature uses a single Zustand store at `features/builder/store/builder-store.ts`.

**One save path.** `reassignAllIPs` is the only action that saves. It sends `getBuildData()` and the revision to `PUT /builds/:id/topology`; the backend saves and calculates the addresses in one transaction, and the answer's addresses and derived details are merged into `nodes` and `hardwareNodes`. Saves, `openBuild`, `syncWithServer` and `applyProposal` run one after another through one queue (`enqueueTopologyMutation`), so a reload never overtakes a save.

**Which build is open:**
- The browser keeps only `currentBuildId`, `projectName` and `buildKind` (`store/workspace-storage.ts`, key `hlb-workspace`, forgotten when the session ends). The canvas is read from the server again: a copy kept in the browser went stale and was shown by pages that never loaded a build.
- `buildStatus` (`idle`, `loading`, `ready`, `error`) says whether the graph in the store belongs to `currentBuildId`. After a page reload it is `idle`: the id is known, the graph is not. Nothing is saved, compared with the server or reviewed before it is `ready`.
- `openBuild(id)` empties the graph before it loads another build, so the previous one is never shown or saved under the new id. The builder and the Config Generator call it. Setup Guide uses `hooks/use-current-project.ts`, which loads the build when only its id is known and clears it on a 404 or 403; the sidebar reads the same hook without loading.
- `loadBuild` keeps `measured`, `width`, `height` and `selected` of the nodes that stay (pitfall 21), drops the validation issues and an open proposal preview, and sets `lastSyncedFingerprint`.

**Saving:**
- `saveState` (`saved`, `unsaved`, `saving`, `error`), `lastSavedAt` and `saveError` live in the store. The canvas header (`save-state-chip.tsx`) and the sidebar's project card show the same state.
- `store/autosave.ts` (`startAutosave`, started by the builder) watches the store, not React renders: comparing means serialising the whole build, which must not happen on every frame of a drag. 300 ms after the last change it compares the canvas with `lastSyncedFingerprint`; 2 s after the last edit it saves.
- A canvas equal to `lastSyncedFingerprint` is never saved. Without this, two open tabs would save in turns forever, because each reloads when the other's save bumps the revision.
- A save that got no answer, or a 5xx, is tried again after 2 s, 5 s and 15 s. A save the server refused (4xx) shows the server's reason and is not repeated until the canvas changes. Leaving the builder saves what is pending.
- A new connection saves at once: `onConnect` calls `reassignAllIPs` via `setTimeout(0)`. `addHardware`, `addVM` and `duplicateHardware` leave it to the autosave.

**A save conflict (409):**
- If the server already holds the save this session sent without getting an answer (`unconfirmedSave`: the next revision, the same graph), its revision is adopted and the save is repeated with the edits made since.
- Otherwise the server's build is loaded and the canvas as it was becomes one undo step. `BuildConflictError` tells the caller, and the toast says Undo brings it back.

**Changes from elsewhere:** `useSyncState` polls `GET /builds/:id/sync-state` every 4 s. `hooks/use-proposals.ts` calls `syncWithServer` on every poll result and whenever the save state changes, so a reload that had to wait for unsaved edits is not forgotten. Three failed polls in a row set `serverReachable` to false; a 404 closes the build.

**Camera:** `requestCanvasFocus(ids)` sets `canvasFocus {ids, nonce}`, and one effect in `visual-builder.tsx` fits the view to those nodes (to everything for `null`), clear of the floating panels (`paddingClearOfPanels`). An applied proposal, Polish and "Show" after a reload from another session use it. `minZoom` is 0.15, or a wide build could not be shown whole.

**Reviewing a proposal:**
- There is one React Flow. While `proposalPreview` is set it draws `proposalPreview.nodes/edges` (built by `lib/proposal-preview.ts`) instead of the live arrays, read-only, with the class `is-reviewing`. The live `nodes` and `edges` are never replaced, so a preview cannot be saved. Undo, redo and Polish do nothing during a review.
- React Flow still has to store the sizes it measures for the cards it draws: `applyPreviewNodeChanges` keeps those changes and nothing else. Preview nodes start with the `measured` of the live node with the same id.
- Each changed element carries `--reveal-index`, and `index.css` stages the reveal from it: what goes fades, what changed pulses, what is new scales in, new cables draw themselves. No timers are involved; reduced motion shows the end state.
- The camera moves to the changes only when they are not on screen already (`proposalPreview.focus`).
- `applyProposal` saves pending edits first, applies on the server, reloads, pushes one undo step that also restores the name, kind and plan, and sets `appliedGlow` so the canvas lights up what was applied.
- A proposal the chat made in this session opens by itself, and so does one an import just made (`reviewImported`). One from an MCP client shows `proposal-banner.tsx`, which leaves a chip when it is put aside. `proposal-review-bar.tsx` steps through the changes; the list of changes (`proposal-review-panel.tsx`) is a second tab of the side panel, next to the chat, which stays mounted.

**Polish:** `polishLayout(style)` asks the layout engine (see below) and `applyLayout(positions)` writes the final positions in one update: one undo step, none when nothing moves, the existing node objects kept so `measured` survives, `hardwareNodes[].x/y` in step. The glide is only drawn (`layoutMotion` and the class `is-arranging`), so a save can never see a half-way position. `lib/polish.ts` adds the toasts and remembers the style used last (`hlb-polish-style`); the command palette calls it too.

**Kind, plan and settings:**
- `buildKind`, `gamingPlan` and `buildSettings` are loaded by `loadBuild` and are part of the autosave fingerprint. Each object is kept exactly as loaded and replaced only by a user edit (`setBuildKind`, `setGamingPlan`), because Postgres `jsonb` reorders keys and a rebuilt object would look like an unsaved change.
- `getBuildData` sends `kind` and `gaming_plan` only when they are set, and spreads the whole loaded settings object, so keys the store does not know (for example `settings.planner`) survive a save.

**Around the builder store:**
- The assistant has its own store (`features/assistant/store/assistant-store.ts`, not persisted). The transcript on screen is the server's: the thread is read again whenever a turn ends other than cleanly and when the panel opens, and a turn that is still running after a page reload is followed (`running`, status `following`). A message sent while a turn is being stopped waits (`queued`) instead of being refused.
- The list of builds is one query (`api/use-builds.ts`, key `['builds']`) shared by the Projects page, the project switcher, Settings and the profile, so a rename or delete in one place is right in the others. The Config Generator fetches its own list each time it opens.
- `buildSettings.setupDone` holds the steps ticked off in the Setup Guide. `setSetupDone` replaces the settings object, which is in the autosave fingerprint, so a tick is saved like an edit (see [App Pages](#app-pages) and pitfall 34).
- `components/layout/project-card.tsx` is the open project in the sidebar: a miniature of the canvas, name, kind, device count, save state (a failed save can be retried there) and a badge for a waiting proposal. It reads the store through selectors only; a sidebar subscribed to the whole store renders on every frame of a drag. Away from the canvas it asks for a waiting proposal every 20 s; on the canvas it reads what the builder polls anyway.

### Canvas Performance

The canvas is the one screen that can keep a processor busy for as long as its tab is open, so three rules hold on it. `features/builder/canvas-idle.test.ts` checks what can be checked in source.

- **An idle canvas draws nothing.** No cable, zone outline or status light runs an animation that never ends (pitfall 41). A cable is a dark line with still, coloured dashes; a selected cable, and the cables of a selected device, are thicker and lie on a wide faint line of the same colour. That line is a path, not a blur filter.
- **A drag renders what moves.** `Flow` takes what it needs from the store through one `useShallow` selector and hands React Flow, for a node that did not change, the object it handed it before (`drawnNode`), so `HardwareNode` (`memo` on `id`, `data`, `selected`) renders for the dragged card only. A cable reads all devices only when smart routing is on; its speed badge is mounted when there is something to show, its buttons and settings while it is hovered, selected or open. What hangs below `Flow` and does not depend on where the cards are is `memo`: the library, the dialogs, the panels (pitfall 42).
- **A pan moves a picture.** `CanvasGrid` (`components/canvas-grid.tsx`) stands in for React Flow's `<Background>`: a tiled CSS background on a layer of its own, moved by the remainder of one grid step and painted again only when the zoom changes; zoomed out its dots fade instead of crowding. `useCanvasMoving` (`hooks/use-canvas-moving.ts`) marks the canvas while the view moves and for 250 ms after (`data-canvas-moving`), and the mark gives `.react-flow__viewport` `will-change: transform`. Not for longer: a layer keeps the sharpness it was drawn with. The panels that float over the canvas are solid; none has a `backdrop-filter`.

The shared build page and the demo on the landing page use the same cable, grid and mark.

What this bought, measured on a production build in a headless Chromium without GPU rasterisation, on a build of 43 devices with a NAT zone. The percentages are the CPU time of all of Chromium's processes, 100% being one core; a gesture is sent as fast as the page takes it, so its duration says how well the page keeps up.

| | Before | After |
|---|---|---|
| Idle canvas | 222%, 6 frames a second | 7% |
| Idle, hosts over their limit | 166%, 4 frames a second | 7% |
| Dragging a card, 120 pointer moves | 22.5 s | 4.2 s |
| Panning, 120 pointer moves | 30.4 s | 3.1 s |
| Zooming, 60 steps of the wheel | 87.5 s | 4.1 s |

A canvas of five devices was at 257% idle and is at 6%. The other pages were never the problem: 4 to 7% each. On the landing page the ASCII rack costs about half a core in that browser while it is on screen and turning; it stops when scrolled away, in a hidden tab, and on Pause. A browser that rasterises on the GPU pays less for all of this, before and after.

### Layout Engine (Polish)

`features/builder/lib/layout/` arranges the canvas. It is a pure module: no React, no store, no dependency. A graph library was left out on purpose. The canvas draws every cable itself, as a step line from a port at the bottom of one card to the handle on top of another, so what a library promises about its own routes would not hold here; and a rack whose insides must not move cannot be expressed in one.

| File | Step |
|---|---|
| `from-flow.ts` | Canvas to `LayoutGraph`: measured sizes (`estimateNodeSize` for a card that was not measured yet; the result then says `usedEstimates`), port anchors, rack membership, the medium of each cable |
| `units.ts` | A unit is what moves as one: a card, or a rack with everything in it. Cables inside a rack are left out |
| `structure.ts` | Units to a forest. A cable is directed by its handles (the end on `ethN` is above, the end on `target-0` below), every unit gets one parent, children are ordered by the parent's port. What only feeds others (a UPS, a second modem) is a feeder beside what it feeds, or a crown above a root. A cable that would close a loop stays out of the tree |
| `place.ts` | Places bottom-up: each subtree is packed against the cards and the real cable segments of what stands already |
| `route.ts`, `geometry.ts` | The corner points of a cable exactly as the canvas draws it; segments, rectangles, crossings |
| `metrics.ts` | `measureLayout`: overlaps, crossings, cards under a cable, wrapped cables, bounds and cable length, all from those routes |
| `index.ts` | `computeLayout(graph, {style})`, `LAYOUT_STYLES`, `pictureOf` for the thumbnails in the Polish menu and the sidebar |

**What the tests hold it to** (`layout.test.ts`), on fixtures, on the output of the three planners and on random networks of 5 to 120 devices:
- no two cards or racks overlap;
- no two cables of the tree cross (`treeCrossings`) and none runs over a card (`treeCableHits`);
- a second run moves nothing, and the order of the input does not matter;
- adding one device does not reshuffle the rest;
- 300 devices are placed within the time budget of the test.

**Not promised.** A secondary link (a UPS feeding several rows, a second uplink, a tunnel, the cable that closes a loop) may cross others: these are counted apart as `otherCrossings` and `otherCableHits`, and a feeder goes on the side where they are fewer. A cable into a racked device passes the devices above it in that rack. A cable between two ports, or between two top handles, is routed by React Flow and counted in `wrappedCables`. All of it holds for the step line style; with bezier or straight lines the result is still free of overlaps.

**The cable rule.** A step cable runs sideways 30 px under its port, or 20 px above its target when there is less room (`stepBusY` in `route.ts`). `custom-edge.tsx` and `proposal-edge.tsx` hand that value to React Flow as `centerY` through `lib/cable-path.ts`, and the engine routes with the same function. `route.test.ts` compares the engine's points with the installed `getSmoothStepPath`, so a React Flow upgrade that changes routing fails a test instead of quietly breaking the layout (pitfall 22). The rule draws every canvas, also one the engine never arranged. Where devices are stacked in a column and fed from the side, which is what Polish and the LAN party planner produced before the engine, the drop to a lower device now passes every card above it instead of about half of them, while cables cross each other less. Measured on 80 such canvases: 72 of 458 cables run over more cards than before and none over fewer; cable crossings fell from 522 to 306. One Polish removes both.

**Styles.** `hierarchy` and `compact` are the same tree with other numbers (`SPACING` in `place.ts`). Compact has narrower gaps, staggers a run of leaves into two rows from 7 instead of 12, and does not line up the children of hubs of similar height.

**Folding.** A row wider than the fold width folds: every second branch moves to a lower tier, under the gap between its neighbours. `chooseFoldWidth` tries `FOLD_WIDTHS` from no folding upwards and takes the first drawing that is narrow enough or not too flat (`ROOM`). A dozen devices stay a plain tree; a 64-seat party does not become a ribbon ten screens wide.

**Around the tree.** Separate networks stand side by side and wrap towards the shape of a screen; devices without a cable go on a grid below, racks without one to the right. Everything is on the 20 px grid. The three planners arrange their output with the same engine and estimated sizes (`lib/planner/arrange.ts`), so a fresh plan opens tidy.

Numbers say a layout has no crossings, not that it looks right. To see every fixture drawn in both styles, and to give the engine a longer random run after a change:

```bash
docker run --rm -v "$PWD:/repo" -v hlb-frontend-node-modules:/repo/frontend/node_modules -w /repo/frontend \
  -e LAYOUT_PREVIEW=/repo/layout-preview.html -e LAYOUT_SEEDS=2000 \
  node:22-alpine npx vitest run src/features/builder/lib/layout
```

`LAYOUT_PREVIEW` names the HTML file to write (delete it afterwards, it is not part of the repository); `LAYOUT_SEEDS` is the number of random networks, 60 by default.

### Landing Page

`features/landing/` is what a guest sees at `/` on the public site. It replaced the login card.

- **Who gets it** (`lib/site.ts`). The landing page is for the public site only: `isPublicSite()` is true on `hlbldr.com` and nowhere else. Somebody who runs their own copy has no use for a page that explains the product and how to host it, so a guest there gets `features/auth/pages/welcome-page.tsx`: the way in, what this instance has switched on (version, sign-in, MCP, assistant, read from `/auth/config`) and the rack. It is `noindex`, and the tab title is plain "HLBuilder". An instance without login never shows either: its owner is signed in at once and lands on the projects page, which asks "What do you want to plan?" while there is no project (`features/builder/components/first-project.tsx`: three ways into the guided planner, an empty canvas, an import). To work on the landing page on another host, open any page with `?landing=on` (`?landing=off` ends it); the script in `index.html` stores that, and it makes the same host decision as `site.ts` before the app starts.
- **Design.** Built from the app's own tokens and faces, so it reads as the same product. The header of `landing.css` states the rules: no accent colour, no gradients, no glow; every heading in a left rail, the thing itself beside it. Colour belongs to the plan: the device cards in the demo, and two status colours in the tables. The monospace face is for addresses, figures and code. The one picture in `public/landing/` is shown in greyscale and blended into the ground. The scanner of [avoid-ai-design](https://github.com/funboy322/avoid-ai-design) (`scripts/detect.mjs`) reported nothing on this folder when it was written; run it again after a redesign.
- **ASCII rack** (`lib/ascii-rack.ts`, `components/ascii-rack.tsx`). The picture in the opening is a server rack in 3D drawn with ASCII characters, turning slowly; its lights blink and the fans on its back spin. It is our own renderer, about 300 lines and no dependency: one ray per character cell against a handful of boxes, the angle to the light picks a character from a ramp, and each face of a device adds its detail (`front`, `back`, `flank`). The result is three strings on one grid (shading, green lights, amber lights). `renderRack(angle, time, cols, rows)` is pure, so React renders one still frame (that is what the prerendered page and a browser without JavaScript show) and a loop at 30 frames a second rewrites the text while the rack is on screen. A frame takes about 1.5 ms. It can be paused and dragged round. When the system asks for reduced motion (on Windows: "Animation effects" off, which many people set for speed) the rack stands still with its lights blinking slowly, and the same button starts it. The cell shape in `landing.css` (`.lp-rack`: 0.6 em wide, line height 1.1) and `CELL_ASPECT` in the renderer belong together. Detail on a face must stay coarse: a rack unit is about three characters high.
- **Motion** (`components/use-live.ts`, the last block of `landing.css`). Besides the rack, three things move, each once, when its block is first seen, and each shows something being worked out: the addresses in the table are handed out from the router outward, the load bars fill to their value, Compose reports its containers. There are no fade-up reveals. `useLive` arms a block only when motion is welcome, so with reduced motion, without JavaScript and in the prerendered copy these blocks show their final state.
- **Demo** (`components/landing-demo.tsx`, `lib/demo-plan.ts`). The guided planners (`buildHomelabPlan`, `buildLanPartyPlan`), `mapBuildToFlow`, the builder's `HardwareNode` and `CustomEdge`, and `computeLayout` run in the browser; nothing is saved. A plan is arranged once more after its cards have been measured, since the planner works from estimated sizes. Addresses come from `lib/demo-addresses.ts`, a copy of the role zones, because no server calculates anything for a guest. A rack is not offered: `RackNode` draws its contents from the builder store, which the demo does not fill. The demo is loaded when it scrolls near (it brings React Flow). "Keep this plan" stores the planner's path in `sessionStorage` (`AFTER_LOGIN_KEY`), and `AppContent` opens it after sign-in.
- **Prerender.** `npm run build` ends with `vite build --ssr src/prerender.tsx` and `scripts/prerender.mjs`. The script writes the page into `dist/index.html` as `#prerender` next to the empty `#root`, adds the canonical link and the FAQ structured data, and keeps the untouched shell as `dist/app.html`. A crawler that runs no JavaScript (most AI crawlers) reads the whole page. In the browser `#root` stays hidden until `LandingPage` has drawn itself; `releasePrerender` then removes the copy and carries the scroll position over. A script in `index.html` hides the copy at once on any host but the public site, and for a browser that holds a token or has seen an instance without login (`LOCAL_INSTANCE_KEY`), so signed-in users and self-hosters never see the landing page flash by.
- **nginx** (`frontend/nginx.conf`). `/` serves `index.html`, the known routes of the app serve `app.html`, and anything else is a real 404 (`public/404.html`).
- `useAuth` reads one module-level auth state shared by every caller: `/auth/me` is asked once per page load, and a change (theme settings, preferences) is seen everywhere. It starts with `loading` false when the auth config is known, login is on and there is no token: a guest gets the landing page without a loading screen in between.

### App Pages

Every screen outside the canvas is built to one contract, `frontend/DESIGN.md`. Read it before adding or changing a page. In short: a page is a document on the page ground; theme tokens only; no washes, glow or shadow under anything that does not float; the monospace face for addresses, ports, figures and commands; colour for state only.

| Piece | Where | What it is |
|---|---|---|
| `Page`, `PageHeader`, `PageRow` | `components/layout/page.tsx` | The frame of every page. It starts at the same left edge everywhere and is not centred; `PageRow` is a section whose heading stays in a rail at the left (the homelab guide; the landing page is built the same way). |
| `.app-table`, `.app-filter`, `.app-code`, `.app-link`, `.app-card`, `.app-empty-state` | `index.css`, `@layer components` | Rows that are scanned, a filter that is switched on and off (`aria-pressed`), a command as typed, a link in running text, a bordered object, a box that says what is missing. |
| `--status-ok`, `--status-warn` | `index.css` | State colours. A theme sets the 31 tokens of `theme-registry.ts`; these two follow only `.dark`, so "saved" is the same green in every theme. Utilities: `text-status-ok`, `bg-status-warn`. |
| `TickBox` | `components/ui/tick-box.tsx` | The checkbox, drawn from the theme; a real `input` underneath. |
| `UserAvatar` | `components/ui/user-avatar.tsx`, `lib/avatar.ts` | A picture or initials. The backend gives accounts made without Google the address of a generated cartoon (DiceBear); it is not fetched. |
| `@media print` | end of `index.css` | Dark ink on white whatever the theme, the page at its full length (on screen the app scrolls inside `<main>`), and `print:hidden` on what is only for a screen. |

**Sidebar** (`components/layout/sidebar.tsx`). The work is at the top: Projects, the open project as a card with its pages (Canvas, Config Generator, Setup Guide), then Inventory (what the user owns, whichever project is open), then what is looked up (Hardware Catalog, Service Library, Homelab Guide). The app itself is at the foot: the command menu, Settings, Admin for an admin, the usage survey until it is answered, Support. Under that the account, whose menu holds what is rarely needed: profile, docs, GitHub, Discord, privacy, terms. The guided planner is not a place in the sidebar: it is reached from the Projects page, the project switcher and the command menu. The mobile menu is a sheet with the same places.

**Setup Guide** (`features/setup-guide/`, route `/checklist`). The guide is worked out from the open build by a pure function, `buildSetupPlan` in `lib/setup-plan.ts`, so it always says what the canvas says:
- sections in the order the work is done: mount the rack, run the cables (a schedule: from, port, to, link), set up the network (the router's LAN address and DHCP range, then the address of every device), one section per host (BIOS, system, static address and gateway, SSH, Docker, and a table of what runs on it), start the services, and the steps of a gaming build (`gaming/lib/setup-steps.ts`);
- every step and every table row has an id made from node and guest ids. A cable is named by its two ends in a fixed order (`cable:<a>~<b>`), never by its edge id (pitfall 10) or its place in a list;
- an access point's uplink is drawn as a wireless link and still takes a port of the switch, so it is listed as a cable; a client joined to an access point (`isWifiAssociation`) is a step, not a cable;
- a container answers on its host (the generated Compose file publishes its ports there and gives it its planned address on a bridge network of its own), a VM on its own address. The DNS and reverse-proxy steps use that rule, like `setup-steps.ts`;
- what is ticked is `buildSettings.setupDone`. The page starts `startAutosave` itself, so a tick is saved with the build through the one save path, and shows in the project card's save state. Ticks for steps the plan no longer has are not counted and are dropped at the next tick;
- the page prints as a runbook: the rail, the buttons and the sidebar are left out.

**Service Library** (`features/catalog/pages/service-catalog-page.tsx`). A table, not a grid of cards: one line per service with the least it needs (RAM, cores, disk), sortable by column, with the categories as a rail of filters and their counts. A row opens to the rest: recommended figures, how it runs, players and ports of a game server, tags, links. `lib/service-catalog.ts` holds the filtering, sorting and formatting. A visitor without an account sees the library without favorites and without "Add a service"; the favorites query is not sent for them.

**Projects page**. Each card shows the build in miniature (`LayoutThumbnail` over `pictureOf`, the same drawing as in the sidebar), from the nodes and edges of the list. Card sizes are estimated there, since the list carries no guests.

**Homelab Guide** (`features/guides/pages/homelab-guide-page.tsx`, public, `/how-to-build-a-homelab`). One article in `PageRow` sections. The part about Google sign-in is for whoever runs the instance: it is folded away in a `<details>` and opens when a link points at `#google-sso` or `#sso-env`.

### Feature Structure

Each feature under `src/features/` follows this general pattern (not all subdirs are present in every feature):
```
feature/
├── api/       # requests through lib/api.ts and their react-query hooks (typed with backend DTOs)
├── components/
├── hooks/
├── lib/       # feature-specific pure logic
├── pages/
├── store/     # Zustand store (builder and assistant)
└── testing/   # fixtures shared by a feature's tests (inventory, integrations)
```

### Frontend Features

| Feature | Description |
|---|---|
| `builder/` | Visual network builder - the main feature (ReactFlow canvas, node management, IP display, Polish, proposal review on the canvas) |
| `admin/` | Admin dashboard, user management, service/hardware admin, blueprint moderation, catalog components |
| `auth/` | `useAuth` (one auth state for the whole app), welcome and sign-in screen of an own instance, profile page |
| `catalog/` | Public hardware catalog (cards) and service library (a sortable table), adding a service of one's own |
| `donate/` | Donation page |
| `landing/` | Landing page of the public site: ASCII rack, live demo, the plan's tables and files, FAQ, sign-in |
| `setup-guide/` | The setup guide of the open build: cable schedule, address plan, steps per host; ticked off, saved with the build, printable |
| `guides/` | The homelab guide, a public article; diagrams for the static docs under `/docs/visuals/` |
| `legal/` | Privacy policy and terms of service |
| `survey/` | Beta user survey |
| `settings/` | Settings page: appearance, AI assistant (provider, key, key-protection panel), MCP access tokens |
| `assistant/` | Chat panel in the builder: SSE reader, store, message list, activity timeline, proposal cards with Apply and Reject, status pill on the canvas |
| `gaming/` | Game plan dialog and report, game server settings, LAN table / console / circuit fields, setup steps for gaming builds |
| `inventory/` | What the user owns: the panel beside the canvas, the inventory page (a table grouped by where things are kept), the item form, the "Physical machine" block of a device |
| `integrations/` | Proxmox: connecting, matching hosts to the inventory, comparing a project with what runs, importing the differences as a proposal |

### Routing (App.tsx)

| Path | Component | Auth Required |
|---|---|---|
| `/` | `ProjectsPage` (logged in) / `LandingPage` (guest on the public site) / `WelcomePage` (guest on an own instance) | No |
| `/builder/:id` | `VisualBuilderPage` | Yes |
| `/generate` | `ConfigGeneratorPage` | Yes |
| `/planner` | `GuidedPlannerPage` (`?kind=lan_party` or `?kind=game_server` starts on that plan) | Yes |
| `/admin` | `AdminPage` | Yes |
| `/profile` | `ProfilePage` | Yes |
| `/settings` | `SettingsPage` | Yes |
| `/donate` | `DonatePage` | Yes |
| `/checklist` | `ChecklistPage` | Yes |
| `/inventory` | `InventoryPage` | Yes |
| `/hardware` | `HardwareCatalogPage` | No |
| `/services` | `ServiceCatalogPage` | No |
| `/how-to-build-a-homelab` | `HomelabGuidePage` | No |
| `/privacy`, `/terms` | `PrivacyPolicyPage`, `TermsOfServicePage` | No |
| `/shared/:token` | `SharedBuildPage` (no sidebar) | No |

---

## Data Model

Primary entities and their relationships:

```
User ──< Build ──< Node ──< VirtualMachine
                   Node ──< Edge (source/target are Node IDs)
Service ──< ServiceRequirement
UserSelection >── User
UserSelection >── Service
User ──< APIToken                  (optional restriction to one Build)
User ──< InventoryItem             (owned hardware; a Node points at one through details.inventory_item_id)
User ──< Integration               (Proxmox: encrypted token secret, trusted certificate, last snapshot)
Build ──< BuildProposal
User ──1 AssistantSettings         (encrypted provider key)
User + Build ──1 AssistantThread ──< AssistantMessage
SystemSetting                      (key/value, instance-wide)
```

`Build.kind` is `homelab`, `lan_party` or `game_server`; `Build.gaming_plan` (jsonb) holds the plan of a gaming build. A game server is a `VirtualMachine` whose `details.game` names a profile from the registry in `internal/gaming`.

### Node Types and IP Zones

Each node type maps to a fixed IP offset block within a `/24` subnet:

| Type | Base Octet | Block Size | VM-capable |
|---|---|---|---|
| router | 1 | 1 | No |
| switch | 10 | 1 | No |
| access_point | 20 | 1 | No |
| console | 30 | 1 | No |
| ups | 80 | 1 | No |
| pdu | 85 | 1 | No |
| nas | 100 | 10 | Yes (.101–.109) |
| server | 150 | 10 | Yes (.151–.159) |
| pc | 160 | 10 | Yes (.161–.169) |
| minipc | 170 | 10 | Yes (.171–.179) |
| sbc | 180 | 10 | Yes (.181–.189) |
| gpu | 190 | 1 | No (non-network) |
| hba | 195 | 1 | No (non-network) |
| pcie | 198 | 1 | No (non-network) |
| lan_table | - | - | No (non-network; its seats take DHCP leases) |

Non-network types (`disk`, `gpu`, `hba`, `pcie`, `pdu`, `ups`, `lan_table`) are never assigned IPs even when connected to a router.

The demo on the landing page repeats these zones in `frontend/src/features/landing/lib/demo-addresses.ts`. Change them together.

### GORM Tag Requirements

All primary keys use PostgreSQL-native UUID generation:

```go
ID uuid.UUID `gorm:"type:uuid;default:gen_random_uuid();primaryKey"`
```

The server and the test helpers enable the `pgcrypto` extension for it. Postgres is the only database: the models use `uuid` and `jsonb`, and the backend has no other driver (pitfall 2).

---

## IP Assignment Algorithm

`IPService.CalculateNetwork(buildID)` in `internal/services/ip_service.go`:

1. Load all nodes (with `Preload("VirtualMachines")`) and edges for the build.
2. Build an undirected adjacency list from edges.
3. Collect routers; auto-assign `192.168.1.1` to any router with an empty IP.
4. Reset all non-router node IPs and all VM IPs to `""`.
5. For each router, BFS outward through the graph:
   - Nodes not reachable from any router remain unassigned (orphans).
   - Each reachable node gets an IP from the router's `/24` subnet using `ROLE_ZONE` offsets.
   - **Shared offset map per `/24` prefix**: two routers in the same `/24` (e.g. both `192.168.1.x`) share a `usedOffsets` map so their connected nodes never get the same IP.
   - VM IPs are assigned *before* the host's full block is sealed: only the host's base octet is reserved first, VMs claim offsets `.base+1` through `.base+step-1`, then the remaining block slots are sealed.
6. Persist all nodes and VMs.

Nodes, guests and edges are read in a fixed order (`loadTopology`). `syncGraph` rewrites every row on a save, and without the order two saves of the same graph could hand the same addresses to different nodes.

DHCP demand: a `lan_table` sends its seats and an access point its `wifi_clients` as `dhcp_clients`. hlbIPAM sizes the pool of the subnet for them and returns it; the backend stores it as `details.dhcp_pool` on the gateway. See [Gaming Builds](#gaming-builds).

---

## Testing Infrastructure

### Philosophy

- **No mocking the database.** Tests run against a real PostgreSQL instance in Docker.
- **Transaction isolation.** Every test wraps its work in a `db.Begin()` transaction that is always rolled back in `t.Cleanup`. No teardown code needed; tests are fully independent.
- **Backend tests run in Docker.** `docker-compose.test.yml` starts a throwaway PostgreSQL and hlbIPAM and runs `go test ./...` from `backend/Dockerfile.test`. CI runs the same file.
- **Frontend tests need no backend.** API modules are vi.mock'd. Run them in a Node container to keep the host clean (see Running Tests).
- **No real model calls.** Provider adapters are tested against `httptest` servers; the chat agent against a fake `llm.Provider`.

### Backend Test Pattern

```go
// Every DB test follows this exact pattern:
func TestSomething(t *testing.T) {
    tx := testTx(t)              // begins a transaction; rolls back on cleanup
    svc := NewSomeService(tx)    // wire service to the transaction
    buildID := newBuildID(t, tx) // create user+build to satisfy FK constraints

    // ... test body ...
}
```

**CRITICAL**: `nodes.build_id` is a foreign key to `builds.id`. You cannot insert a node with a random `uuid.New()` build ID - it violates `fk_builds_nodes`. Always use `newBuildID(t, tx)` which creates a `User` + `Build` first.

### Helper Functions (`testhelpers_test.go`)

```go
testTx(t)                          // *gorm.DB transaction, auto-rolled back
connectTestDB()                    // connects to homelab_builder_test PG DB
migrateTestDB(db)                  // CREATE EXTENSION pgcrypto + AutoMigrate(database.Models()...)
```

### Helper Functions (`internal/testutil/pgtest.go`)

For packages outside `services` (`assistant`, `mcpserver`, `handlers`):

```go
testutil.Tx(t)                     // *gorm.DB transaction, auto-rolled back
testutil.User(t, db)               // creates a user to own test data
testutil.IPAMStub(t)               // fake hlbIPAM; use with t.Setenv("IPAM_URL", ...)
```

### Helper Functions (`ip_service_test.go`)

```go
newBuildID(t, tx) uuid.UUID        // creates User + Build; returns Build.ID
createNode(t, tx, buildID, type, name, ip) models.Node
connectNodes(t, tx, buildID, srcID, dstID)
fetchIP(t, tx, nodeID) string      // reloads node IP from DB
hasPrefix(s, prefix string) bool
```

### Test Files

| File | Package | Tests |
|---|---|---|
| `internal/services/testhelpers_test.go` | `services` | Infrastructure (TestMain, helpers) |
| `internal/services/build_service_test.go` | `services` | Build CRUD tests; the list carries nodes and edges |
| `internal/services/ip_service_test.go` | `services` | DB tests + pure unit tests |
| `internal/services/auth_service_test.go` | `services` | Auth service tests |
| `internal/services/hardware_service_test.go` | `services` | Hardware catalog tests |
| `internal/services/recommendation_service_test.go` | `services` | Recommendation generation tests |
| `internal/services/service_service_test.go` | `services` | Service catalog tests |
| `internal/handlers/health_test.go` | `handlers` | Health endpoint test |
| `internal/handlers/assistant_handler_test.go` | `handlers` | Settings API never returns the key; chat SSE stream; the selection sent with a message |
| `internal/services/topology_ops_test.go` | `services` | Change-set engine: refs, ports, loops, racks, VMs; a replay places new nodes on the canvas as it is then |
| `internal/services/proposal_service_test.go` | `services` | Dry run, supersede, apply with rebase, conflict, reject |
| `internal/services/api_token_service_test.go` | `services` | Token hashing, scopes, expiry, limits |
| `internal/services/assistant_settings_service_test.go` | `services` | Key encryption, owner binding, key wipe on destination change, audit |
| `internal/assistant/tools_test.go`, `agent_test.go` | `assistant` | Tool scopes and schemas; chat loop with a fake provider: event order, step texts, a stopped reply is kept, selection, `running` |
| `internal/mcpserver/server_test.go` | `mcpserver` | End to end with the go-sdk client: auth, scopes, origin check, rate limits |
| `internal/llm/provider_test.go`, `ssrf_test.go` | `llm` | Provider adapters against `httptest`, including the start and growth of a tool call; blocked-address table |
| `internal/llm/llmtest/server_test.go` | `llmtest` | The scripted provider, driven through the real OpenAI-compatible adapter |
| `internal/secrets/aesgcm_test.go` | `secrets` | Round trip, tampering, wrong owner |
| `internal/gaming/*_test.go` | `gaming` | Registry consistency, plan validation, sizing, every report check, compose files, plan merge and diff |
| `internal/services/build_kind_test.go` | `services` | Kind and plan round trip; an unaware client cannot wipe them; share links hide the public host |
| `internal/services/topology_gaming_test.go` | `services` | Console and LAN table rules, Wi-Fi association, DHCP demand and the stored pool |
| `internal/services/gaming_service_test.go` | `services` | Game server sizing in the change-set engine; report, compose and export files end to end |
| `internal/services/proposal_gaming_test.go` | `services` | `set_plan` alone is a change and is validated; game settings are diffed |
| `internal/services/hardware_seed_test.go`, `default_service_seed_test.go` | `services` | Catalog seeds: idempotent, approved, game profiles attached; `Models()` covers every table |
| `internal/assistant/tools_gaming_test.go` | `assistant` | Planning a game server through the tools; a homelab gets no gaming output |
| `internal/inventory/inventory_test.go` | `inventory` | Item validation, an item as a node, how an item reads as in use |
| `internal/netguard/netguard_test.go` | `netguard` | Blocked-address table, internal host names |
| `internal/proxmox/*_test.go` | `proxmox` | The client against the made-up cluster: token, certificate trust and pinning, what a weak token still reads; exports; host matching; plan against reality |
| `internal/services/inventory_service_test.go` | `services` | Items belong to the account; placements are read from the builds; state |
| `internal/services/integration_service_test.go` | `services` | Secret encryption and owner binding, the secret wiped with a changed address, certificate trust, links to items, limits |
| `internal/services/proxmox_import_test.go` | `services` | The comparison; an import is a proposal; a new build; addresses in a DHCP range; size limits; the owner only |
| `internal/handlers/integration_handler_test.go` | `handlers` | No response contains the secret; a saved connection is read at once; an import through a proposal; the inventory API |
| `hlbipam/internal/core/dhcp_demand_test.go` | `core` | Pool grows with demand, no demand keeps the default, console zone, tables get no address |
| `hlbipam/internal/core/allocator_test.go` | `core` | IPAM allocator tests |
| `hlbipam/internal/core/validator_test.go` | `core` | IPAM validator tests |
| `frontend/src/features/builder/store/builder-store.test.ts` | - | The save path, both kinds of conflict, a reload that keeps what was measured, what the browser remembers, deleting devices and racks |
| `frontend/src/features/builder/store/autosave.test.ts` | - | Fake timers: the wait, retries, no save when in sync, during a review or before the canvas is loaded |
| `frontend/src/features/builder/store/builder-store.layout.test.ts` | - | Polish as one undo step; `measured` and rack contents kept; nothing moves during a review |
| `frontend/src/features/builder/store/builder-store.proposals.test.ts` | - | A review leaves the live graph alone, apply as one undo step, glow, sync |
| `frontend/src/features/builder/lib/layout/*.test.ts` | - | Layout engine: every promise on fixtures, planner output and random networks; the route against React Flow's own; the canvas adapter |
| `frontend/src/features/builder/lib/polish.test.ts` | - | What Polish says and remembers |
| `frontend/src/features/builder/canvas-idle.test.ts` | - | Reads the source of everything that draws a canvas: no endless animation, no blur behind floating panels, the grid and the moving mark in place (pitfall 41) |
| `frontend/src/features/builder/components/canvas-grid.test.tsx`, `hooks/use-canvas-moving.test.ts` | - | The dot grid: step, wrap, fading when zoomed out; the canvas is marked while it moves and through wheel notches |
| `frontend/src/features/builder/store/workspace-storage.test.ts` | - | What the browser remembers is written when it changes, not on every change of the store |
| `frontend/src/features/builder/components/proposal-review-panel.test.tsx`, `proposal-review-bar.test.tsx` | - | List of changes; review bar and the banner of a waiting proposal |
| `frontend/src/features/builder/pages/__tests__/projects-page.test.tsx` | - | Projects page, with rename and delete of the open project; the first-project screen and an empty search |
| `frontend/src/components/layout/project-card.test.tsx`, `sidebar.test.tsx` | - | Project card after a reload, save states, proposal badge, switcher; what the sidebar lists and where, the account menu, the survey row, a visitor, collapsed state |
| `frontend/src/features/setup-guide/lib/setup-plan.test.ts`, `pages/checklist-page.test.tsx` | - | The guide from a build: cable schedule and its order, ids that survive a redraw, Wi-Fi clients, addresses, hosts with and without a hypervisor, a NAS, services, a rack; progress; a tick lands in the build's settings and an untouched build stays untouched |
| `frontend/src/features/catalog/lib/service-catalog.test.ts`, `pages/service-catalog-page.test.tsx` | - | Filtering, sorting with ties, category counts, tags, figures; the table, a row opened, favorites, a visitor without an account |
| `frontend/src/features/guides/pages/homelab-guide-page.test.tsx` | - | The article's sections, the patterns as a table, the sign-in setup folded away and opened by a link |
| `frontend/src/components/ui/user-avatar.test.tsx` | - | Picture, initials, a generated avatar that is not fetched |
| `frontend/src/features/settings/**/*.test.ts(x)` | - | MCP snippets and source links, token card, assistant settings card |
| `frontend/src/features/assistant/**/*.test.ts(x)` | - | SSE reader; chat store (every event, reading the thread again, a queued message); chat panel; activity timeline |
| `frontend/src/features/gaming/**/*.test.ts(x)` | - | Sizing, tables, kinds, setup steps, game compose text, plan dialog (it asks nothing of the build while closed), node fields |
| `frontend/src/features/gaming/components/gaming-node-fields.store.test.tsx` | - | The device fields on the real store, in a build without power circuits (pitfall 37) |
| `frontend/src/features/builder/components/node-properties-panel.store.test.tsx` | - | Selecting a device leaves it as it is; an edit of the form is saved to that device (pitfall 43) |
| `frontend/src/features/inventory/**/*.test.ts(x)` | - | Items as nodes and components, what a canvas uses, state, spare memory for a host; placing; the panel; the inventory page and the item form |
| `frontend/src/features/integrations/**/*.test.ts(x)` | - | What an import does unless told otherwise, and counts; the Proxmox dialog: connection, certificate trust, hosts, compare, import |
| `frontend/src/features/builder/lib/planner/planner.test.ts`, `lib/connection-rules.test.ts` | - | Plan builders for the three kinds; canvas connection rules |
| `frontend/src/features/landing/lib/demo-plan.test.ts` | - | Demo addresses by role; the demo plans from the real planners |
| `frontend/src/features/landing/lib/ascii-rack.test.ts`, `components/ascii-rack.test.tsx` | - | The ASCII rack: grid, characters, framing, lights from the front only, fans from behind; pause, and standing still under reduced motion until started |
| `frontend/src/lib/site.test.ts`, `features/auth/pages/welcome-page.test.tsx` | - | Which hosts get the landing page; the welcome screen of an own instance and what it reports |
| `frontend/src/features/landing/pages/landing-page.test.tsx` | - | Heading, answers, tables, sign-in; the copy in index.html is released; the prerender entry |
| `frontend/src/lib/version.test.ts` | - | `package.json` and `backend/internal/version` carry the same version |

### Test Database

- Name: `homelab_builder_test` (separate from the production `homelab_builder`). Packages outside `services` share a second one, `homelab_builder_pkg_test`.
- Created automatically by `TestMain` if it does not exist.
- Migrated via GORM `AutoMigrate` of `database.Models()`, the same list the server migrates at startup. There are no SQL migration files: catalog data is seeded in Go at startup (`SeedCatalog`).
- The shared package database is migrated once per schema: `testutil` keeps a fingerprint of the models in `test_schema_state` and skips `AutoMigrate` when it matches (pitfall 17).

---

## Running Tests

Docker is the only prerequisite: the backend tests start their own Postgres and hlbIPAM, and the frontend tests run in a Node container.

### All tests

```bash
make test
```

### Backend only

```bash
make test-backend
# same as CI:
docker compose -f docker-compose.test.yml up --build --abort-on-container-exit --exit-code-from backend-test
```

This starts a throwaway Postgres and hlbIPAM, builds `backend/Dockerfile.test`, and runs `go test ./...` (every package, not only `services`).

To iterate on one package without rebuilding the image, keep the two services up and mount the source:

```bash
docker compose -f docker-compose.test.yml up -d test-postgres hlbipam
docker run --rm --network homelab-builder_default -v "$PWD/backend:/app" -w /app \
  -e CGO_ENABLED=0 -e DB_HOST=test-postgres -e DB_USER=homelab -e DB_PASSWORD=homelab_password \
  -e TEST_DB_NAME=homelab_builder_test -e IPAM_URL=http://hlbipam:8081 \
  golang:1.25-alpine go test ./internal/assistant/... -count=1
```

### Frontend only

```bash
make test-frontend
# the same, written out (node_modules stays in a named volume, off the host):
docker run --rm -v "$PWD:/repo" -v hlb-frontend-node-modules:/repo/frontend/node_modules -w /repo/frontend \
  node:22-alpine sh -c "npm ci --legacy-peer-deps && npx tsc -b && npx vitest run"
# lint (CI does not run it; keep it at zero problems):
docker run --rm -v "$PWD:/repo" -v hlb-frontend-node-modules:/repo/frontend/node_modules -w /repo/frontend \
  node:22-alpine npx eslint .
```

The whole repository is mounted because one test checks that the source files the settings page links to exist.

CI runs this suite on Node 20 (`.github/workflows/test.yml`), which is slower on it than Node 22. Use `node:20-alpine` in the command above before trusting a timing (pitfall 31).

### Watching frontend tests

```bash
cd frontend && npm run test:watch
```

### The assistant in a browser, without a key

`backend/cmd/fakellm` serves the scripted provider from `internal/llm/llmtest` (`go test` uses the same handler). It is a development tool without authentication and is not built into the image. Run it on a stack of its own, so the database of the usual local stack is not touched. Both publish port 8080: stop the usual one first with `docker compose -f docker-compose.local.yml down`, never with `-v`, because its volume holds the projects built locally.

```bash
docker compose -p hlb-verify -f docker-compose.local.yml up -d --build
docker run -d --name hlb-verify-fakellm --network hlb-verify_default -v "$PWD/backend:/app" -w /app \
  golang:1.25-alpine go run ./cmd/fakellm -delay 140ms
# the frontend with hot reload; on Windows a bind mount needs polling (pitfall 30)
docker run -d --name hlb-verify-vite -p 127.0.0.1:5173:5173 -e CHOKIDAR_USEPOLLING=true \
  -v "$PWD:/repo" -v hlb-frontend-node-modules:/repo/frontend/node_modules -w /repo/frontend \
  node:22-alpine sh -c "npm install --legacy-peer-deps && npm run dev -- --host 0.0.0.0 --port 5173"
```

In Settings choose "Other OpenAI-compatible endpoint", address `http://hlb-verify-fakellm:8089/v1`, model `scripted-1`, any key. A private address is accepted because the local stack runs without login unless `GOOGLE_CLIENT_ID` is set (`ASSISTANT_ALLOW_PRIVATE_ENDPOINTS`). The script answers to words in the message: "nas" reads the build and proposes a NAS, "validate" checks the build, "search X" searches the catalog, "slow" writes a long reply to try Stop on, "fail" is a provider error.

```bash
docker rm -f hlb-verify-vite hlb-verify-fakellm
docker compose -p hlb-verify -f docker-compose.local.yml down
docker volume rm hlb-verify_local_postgres
```

### Proxmox in a browser, without a cluster

`backend/cmd/fakepve` serves the made-up cluster of `internal/proxmox/pvetest` (three hosts, eleven virtual machines, seven containers) over TLS, with a certificate it makes when it starts, and prints the token and the certificate's SHA-256. Like `fakellm` it is a development tool and is not built into the image. On the same throwaway stack:

```bash
docker run -d --name hlb-verify-fakepve --network hlb-verify_default -v "$PWD/backend:/app" -w /app \
  golang:1.25-alpine go run ./cmd/fakepve
docker logs hlb-verify-fakepve   # token id, secret, SHA-256 of the certificate
```

In the builder, under Integrations, choose Connect Proxmox: address `https://hlb-verify-fakepve:8006`, token id and secret from the log. The first test shows the certificate: compare the fingerprint with the log and trust it. Restarting the container makes a new certificate, which is how the "the host presents a different certificate" path is tried. Remove it with `docker rm -f hlb-verify-fakepve`.

---

## Common Issues & Pitfalls

### 1. "fk_builds_nodes" foreign key violation in tests

**Symptom**: `ERROR: insert or update on table "nodes" violates foreign key constraint "fk_builds_nodes"`

**Cause**: Creating a `Node` with a `build_id` that doesn't exist in the `builds` table. Using `uuid.New()` as a build ID does not work.

**Fix**: Always use `newBuildID(t, tx)` which creates a real `User` + `Build` first.

### 2. Postgres only

`models.go` uses `gorm:"type:uuid;default:gen_random_uuid()"` and `gorm:"type:jsonb"`, and the backend links no other database driver. Tests always run against a real PostgreSQL instance in Docker.

### 3. "no router found to establish gateway" from calculateNetwork

**Cause A** (frontend bug, fixed): `reassignAllIPs` was calling `calculateNetwork` before `buildApi.update`. The backend read stale/empty `nodes` and found no router. A save is one request now (`PUT /builds/:id/topology`): the backend saves and calculates in one transaction, so the order cannot be wrong any more.

**Cause B** (real): The build genuinely has no node with `type = "router"`. `CalculateNetwork` returns this as an error - the caller should handle it gracefully.

### 4. VMs not getting IPs

**Symptom**: Server/NAS nodes have IPs but their `VirtualMachine` records have empty `IP`.

**Root cause** (fixed in `ip_service.go`): The entire step-block (e.g. `.150`–`.159` for a server) was marked as `usedOffsets` before VM assignment ran. `assignVMIPInSubnet` found all candidate offsets taken.

**Fix**: Reserve only the host's base octet first, assign VMs, then seal the remaining block.

### 5. Duplicate IPs when two routers share a `/24`

**Symptom**: Switch A and Switch B both receive `192.168.1.10` when connected to two different routers both configured as `192.168.1.x`.

**Root cause** (fixed): Each router's BFS had an independent `usedOffsets` map.

**Fix**: `sharedOffsets map[subnetPrefix]map[int]bool` is populated before BFS; all routers in the same `/24` share the same inner map.

### 6. ReactFlow node data not reflecting updated IPs

**Symptom**: IP calculation succeeds on the backend, but the frontend canvas still shows old/empty IPs on nodes.

**Root cause** (fixed): The store updated `nodes` (ReactFlow nodes) but `hardwareNodes` (the richer internal representation) was not refreshed. The canvas reads from `hardwareNodes`.

**Fix**: The answer to a save carries the calculated addresses, and the store overlays them onto the matching `hardwareNodes` and `nodes` entries by id.

### 7. Docker network name

The docker-compose default network is `homelab-builder_default` (derived from the project folder name). Commands that attach a one-off container to the test stack name it explicitly. If you rename the project folder, adjust them.

### 8. pgcrypto extension

`migrateTestDB` runs `CREATE EXTENSION IF NOT EXISTS "pgcrypto"` before AutoMigrate, and the server does the same at startup. Primary keys default to `gen_random_uuid()`.

### 9. Missing `Preload("Nodes.VirtualMachines")`

GORM does not eager-load associations by default. Any `BuildService` query that returns a build must explicitly preload `Nodes` and `Nodes.VirtualMachines` or VM data will be missing from API responses. The regression test `TestGetByID_PreloadsVirtualMachines` guards this.

### 10. Edge IDs are not stable

`syncGraph` recreates every edge on save, so an edge ID is only valid until the next save. Anything that outlives a save (proposals, diffs, LLM tool arguments) identifies a connection by its two node IDs.

### 11. Provider SDK default clients read server credentials

`anthropic.NewClient()` and `openai.NewClient()` pick up `ANTHROPIC_API_KEY` / `OPENAI_API_KEY` and base URLs from the environment. A user's request must never run on the server's credentials: build the services with explicit options, as `internal/llm` does.

### 12. Autosave and the sync poll

Loading a build must not be followed by a save of the same data. `loadBuild` sets `lastSyncedFingerprint`, and autosave compares against it. If you add a field to `getBuildData`, make sure `mapBuildToFlow` restores it, or every load will look like an unsaved change (`power_draw` was dropped this way before).

### 13. The assistant needs a master key on public instances

With login enabled and `GIN_MODE=release`, a missing `SECRETS_KEY` does not stop the server: the assistant is switched off and the log says `AI assistant disabled`. The settings page then shows it as unavailable.

### 14. Kind, plan and settings are part of the autosave fingerprint

`loadBuild` must set `buildKind`, `gamingPlan` and `buildSettings` before it computes `lastSyncedFingerprint`, and the server must return the plan exactly as stored (`Plan.Normalize` adds no defaults). Otherwise every load looks like an unsaved change and two tabs save in turns (pitfall 12). `completePlan()` is for display: do not write its result back unless the user edited something.

### 15. `details.dhcp_pool` is derived

The pool on a gateway is written by the IP calculation, like `wan_ip` and `interfaces`. It must stay in `reservedDetailKeys` (`topology_ops.go`), `derivedDetailKeys` (`topology_diff.go`) and `DERIVED_DETAIL_KEYS` (`builder-store.ts`). Leave one out and a proposal shows a pool change the user did not make, or a removed pool lingers on the canvas.

### 16. The Wi-Fi association rule lives in three places

`access_point` to `pc` / `minipc` / `sbc` / `console` is a Wi-Fi association: forced wireless, no hub needed, and it does not use the access point's port. The rule is keyed on the two device types, not on the connection type, because an access point's own uplink is also drawn as wireless. It is implemented in `build_service.go` (`validateEdgeEndpoints`), in the change-set engine (`topology_ops_connections.go`, `topology_ports.go`) and on the canvas (`connection-rules.ts`). Changed in one place only, the canvas draws links the server rejects, or the other way round.

### 17. AutoMigrate is not a no-op, and test binaries share a database

`go test ./...` runs the test binaries of several packages at the same time against `homelab_builder_pkg_test`. `AutoMigrate` re-issues `ALTER TABLE ... SET DEFAULT` for every `jsonb` default even when nothing changed, and each one needs an exclusive lock on its table. A binary that migrates while another runs a test holding two transactions deadlocks, and the suite hangs instead of failing. `testutil.migrateOnce` migrates only when the fingerprint of the models changed. Use `testutil.Tx` in new packages and do not call `AutoMigrate` on the shared database yourself.

### 18. Read a topology in a fixed order

`syncGraph` deletes and recreates every node, guest and edge row on each save. Anything that depends on the order of nodes or edges, the hlbIPAM request above all, must read through `loadTopology` (`ip_service.go`), which orders by `created_at` and then by ids that survive a save. Without it, saving an unchanged graph twice could swap the addresses of two equal devices.

### 19. Share links and the gaming plan

`gaming_plan.uplink.public_host` is the owner's home address on the internet. Everything returned to a share link, the read and the answer to a save, goes through `asSharedView` in `build_service.go`. A new endpoint that serves a shared build must use it too. A save through a share link never changes the kind or the plan.

### 20. Game facts come from the registry, not from the database

`Service.Game` is filled from `internal/gaming` in `AfterFind`; the `services` row only holds the name, category and requirements. Changing a port or an image is a code change in `profiles_data.go`, and the registry test checks slugs, service ids and port ranges (a port plus the largest offset must stay below 65536). Game servers get their own compose file per host (`gaming/compose.go`) because they publish ports on the host; the homelab compose file skips them.

### 21. A controlled React Flow node needs `measured`

React Flow hides a controlled node that has no `measured` size, forgets where its handles are, and leaves it out of `fitView`. Whoever builds new node objects for nodes that are on screen must carry `measured`, `width` and `height` over: `loadBuild` (`keepMeasured`), `buildProposalPreview`, `applyLayout`. Otherwise the canvas goes blank for a frame and cables jump. Code that moves the camera to new nodes has to wait until they are measured (`previewFocusMeasured` in `visual-builder.tsx`).

### 22. The layout engine routes cables like the canvas, or its promises are worth nothing

"No crossings" is computed from `cableRoute`. It only holds while the canvas draws the same line, so the bend of a step cable comes from one function (`stepBusY`) used by `custom-edge.tsx`, `proposal-edge.tsx` and the engine. Do not change the path in an edge component alone. `route.test.ts` fails when React Flow's own routing changes.

### 23. A review never touches the live graph

During a review the canvas draws `proposalPreview`, and `nodes` / `edges` in the store stay as they are. That is what keeps a proposal from being saved before Apply: the autosave fingerprint is built from the live arrays. Do not write preview nodes into them, and guard every canvas handler that changes something (drag, connect, delete, drop) with the review mode. `applyPreviewNodeChanges` accepts measured sizes only.

### 24. Step texts in the chat are plain text

`detail` and `summary` of a step and the name of a tool come from what the model wrote. They are cut by `brief` on the server and must be rendered as text. Putting them through the Markdown renderer would hand the model a way to draw links and markup outside its reply.

### 25. `sr-only` inside a scroll container

Tailwind's `sr-only` is `position: absolute`. In a scrolling list without a positioned ancestor of its own, such a label is laid out against a container further up and can make that one scrollable: labels in the chat's message list made the whole builder scroll. The scroller that holds them must be `relative`.

### 26. Radix `asChild` and a `className` function

`Slot` merges class names as strings. A `NavLink` under `TooltipTrigger asChild` with `className={({isActive}) => ...}` ends up with the source text of the function as its class. Use `Link`, compute the class and set `aria-current` yourself (`project-card.tsx`, collapsed variant).

### 27. Postgres cannot store NUL

`jsonb` rejects `\u0000` (SQLSTATE 22P05) and `text` rejects the byte 0x00. A model can write either into tool arguments. `Registry.Call` refuses such arguments with a reason the model can read, and `storableJSON` in `assistant_thread_service.go` strips NUL from what is stored; the provider's native message is dropped when it contains one. Without this the reply cannot be stored and the turn fails after the work was done.

### 28. React Flow's default edge options reach every edge

`defaultEdgeOptions` is merged into controlled edges too. While it carried `animated: true`, the dash animation that brings overrode a stroke style set on the path, and ran on every cable for ever (pitfall 41). The canvas no longer sets it; edges of a preview still set `animated: false`, and the rules that draw a new cable are more specific than `.react-flow__edge.animated path`.

### 29. Motion is decoration

The reveal of a proposal, the glide after Polish and the glow after Apply are CSS inside `@media (prefers-reduced-motion: no-preference)`. The state without them must be complete and right: final positions are in the store before anything glides, and a removed device is a ghost whether or not it fades. An automated browser often reports `reduce`; seeing no animation there is not a bug.

### 30. Vite in Docker on Windows needs polling

A bind mount from Windows delivers no file events to the container, so Vite keeps serving old modules and a fix seems not to work. Start the dev server with `CHOKIDAR_USEPOLLING=true` (see Running Tests).

### 31. A test that passes alone can time out in the full run

The frontend suite runs every file at once, and CI uses Node 20. Under that load a component test that clicks and types through a dialog took over 5 s, and the random-network test of the layout engine 16 s, with no assertion failing. `testTimeout` is 15 s for that reason (`vite.config.ts`), and the random-network test has a budget of its own. Judge a timing by the whole suite on `node:20-alpine`, not by one file on a newer Node.

`clearance` in `layout/place.ts` is the engine's hot loop: every subtree that is appended to a row is compared with what stands there. It walks the placed items newest first and skips those that cannot matter. When you change it, compare the drawings before and after (`LAYOUT_PREVIEW` with a few hundred seeds gives a file to diff; the planner drawings differ in order only, their ids are random).

### 32. The landing page is drawn twice

Once as HTML when the app is built, once by React in the browser, and the swap must not be seen. Whatever differs between the two (the sign-in button, the demo, the star count) is mounted after the first paint (`useMounted`, `DemoSlot`, `useStars`). `LandingPage` has to stay importable without a browser: nothing it imports at the top may touch `window` or pull in the API client, which is why `GoogleLoginButton` is loaded lazily. The frame around the page is `APP_SHELL_CLASS`, shared by `App.tsx` and `src/prerender.tsx`. `landing-page.test.tsx` renders the prerender entry.

### 33. A new route needs a line in nginx.conf

nginx no longer falls back to the app for an unknown path. A route added to `App.tsx` must be added to the matching `location` in `frontend/nginx.conf` (public, or behind the login), or it is a 404 in the image while it works in `vite dev`.

### 34. Setup progress is part of the build

The ticks of the Setup Guide are `settings.setupDone`, saved through the one save path. Two things follow. `setSetupDone` must leave the settings object alone when nothing is ticked and nothing is stored, or opening the guide would look like an unsaved change (pitfalls 12 and 14). And the id of a step must survive a save: build it from node and guest ids, never from an edge id (pitfall 10) or an index, or every tick is lost when the build is saved.

### 35. `dark:` follows the operating system, not the theme

The app's theme is a class on `<html>` (`dark` or `light`) plus tokens set inline by `ThemeProvider`. Tailwind's `dark:` variant is not tied to that class here: it follows `prefers-color-scheme`. A `dark:text-amber-400` is therefore wrong for a user on a dark system with a light theme. Outside the canvas use tokens (`text-status-warn`, `text-muted-foreground`), which are right in every theme; `frontend/DESIGN.md` has the list.

### 36. A page outside the canvas is a document, not a card grid

Before adding a page or a section, read `frontend/DESIGN.md`. The things that crept in before and were taken out again: gradient washes behind a page, a tinted square around every icon, the same icon on every card, pill badges above titles, all-caps tracked labels, hard-coded palette colours, a hero banner on a tool page. `scripts/detect.mjs` of avoid-ai-design finds most of them in source.

### 37. A store selector must hand back the same thing for the same state

Zustand 5 reads a selector through `useSyncExternalStore` and compares what it returns with the call before. A selector that builds a new array or object every time (`state => state.x ?? []`, `state => complete(state.plan).list`) never settles: React renders until it gives up, and the whole builder goes blank. Return something that is in the store, or a constant declared outside the component (`NO_CIRCUITS` in `gaming-node-fields.tsx`). A test whose store double only calls the selector does not notice; `gaming-node-fields.store.test.tsx` runs on the real store for that reason.

### 38. The address plan pins nothing inside a DHCP range

hlbIPAM answers a request for an address inside a gateway's DHCP pool with another address and a conflict note. Whoever sets `ip` on a node or `static_ip` on a guest from outside (an import, a tool) checks `details.dhcp_pool` of the gateway first (`inDHCPPool` in `proxmox_import.go`), or the device asks for one address and shows another. A build that is only being made has no pool yet: the import writes it, reads which addresses were not given, and writes it again without asking for those (`unhonoured`).

### 39. A copy is not the same machine

`details.inventory_item_id`, `inventory_label`, `inventory_quantity` and `proxmox_node` say which physical machine a node is. Whatever makes a second node from a first on one canvas (duplicate, paste, a blueprint, a preset) drops them (`withoutAssetLink` in `lib/asset-link.ts`) and the MAC address, or two devices claim to be one machine and the inventory counts it twice. A duplicated build keeps them: it is a variant that plans the same hardware.

### 40. One policy for calling out

The LLM client and the Proxmox client both dial through `internal/netguard`. A new client that calls an address a user named uses `netguard.DialControl` too, follows no redirects and takes no proxy from the environment. A second copy of the address rules would drift.

### 41. Nothing on the canvas animates for ever

**Symptom**: an open builder tab keeps one or two processor cores busy while nobody touches it (issue #32).

**Cause**: an animation that never ends keeps the browser producing frames. Moving dashes (`stroke-dashoffset`), an animated `filter`, a light that pulses inside a card: none of these can be handed to the compositor, so every frame paints what they touch again. React Flow's `animated` option does it to every path of a cable, the wide invisible one for the pointer included.

**Rule**: state on the canvas is shown by colour, weight and shape. Motion that ends (the reveal of a proposal, the glide of Polish, the glow after Apply) is fine; a spinner is fine while something is being waited for. The same care goes for what makes every repaint dear: a `backdrop-filter` on a panel over the canvas is worked out again for each frame the canvas moves, and a `drop-shadow()` on a cable or a zone outline for each repaint near it. `canvas-idle.test.ts` fails when one of these comes back.

### 42. What renders on every frame of a drag

React Flow reports a drag as a change of `nodes` on every move of the pointer. Whatever reads all nodes renders that often: `useBuilderStore()` without a selector, React Flow's `useNodes()`. And a store selector runs on every change whether or not its component renders, so it must be cheap: `state.hasUnsavedChanges()` serialises the whole build, which the closed game plan dialog did sixty times a second.

Take one value with a selector and several with `useShallow`; in a cable use `useInternalNode`, or `useStore` with a selector that returns a plain value. A node object handed to React Flow has to be the same object for as long as nothing in it changed, or `memo` on the card is worth nothing (`drawnNode` in `visual-builder.tsx`). The same holds for what the store writes to `localStorage`: `workspaceStorage` writes only what differs from what is there.

### 43. The properties form saves through a plain effect

`NodePropertiesPanel` copies the selected device into its form while rendering and writes the form back half a second after it changes. Do not move that write into `useEffectEvent`: with state set during render (React 19.2), the effect event kept a closure from before the copy, so selecting a device wrote the empty form over it, and an edit was saved with the old values. The write is an ordinary effect with all its dependencies that reads the device from the store by id. `node-properties-panel.store.test.tsx` runs the panel on the real store.

---

## Fixed Bugs (Historical)

These bugs were diagnosed and fixed; tests guard against regression.

| # | Location | Bug | Fix |
|---|---|---|---|
| 1 | `builder-store.ts` | `calculateNetwork` called before `update` → "no router found" | Swap order: `update` → `calculateNetwork` → `get` |
| 2 | `builder-store.ts` | `hardwareNodes` IP not updated after `reassignAllIPs` | Overlay backend `node.ip` onto `hardwareNodes` after `buildApi.get` |
| 3 | `ip_service.go` | BFS was per-router; orphan nodes (not connected to queried router) got wrong subnet IPs | Graph-aware BFS: visited set is shared across all routers |
| 4 | `ip_service.go` | Two routers on same `/24` produced duplicate IPs | Shared `usedOffsets` map keyed by `/24` prefix |
| 5 | `ip_service.go` | VM IPs never assigned (entire host block marked used first) | Reserve base octet → assign VMs → seal block |
| 6 | `build_service.go` | `GetByID` missing `Preload("Nodes.VirtualMachines")` | Added preload |
| 7 | `visual-builder.tsx`, `builder-store.ts` | Reopening a build in the SPA kept a stale revision (e.g. after a rename), so every save/Reassign IPs got a silent 409 until reload | Builder always reloads via queued `openBuild`; a 409 adopts the server's build and raises `BuildConflictError`; Reassign IPs shows errors |
| 8 | `catalog-mapper.ts`, `hardware-instance.ts` | Blueprint VMs (`vm-<serviceId>`) and copied VMs/components reused non-UUID or duplicate IDs; the backend replaced them, so assigned VM IPs never reached the canvas until reload | Placed and duplicated nodes get fresh UUIDs via `withFreshChildIds` |
| 9 | `build_service.go` | Deleting a build with nodes failed with `fk_builds_nodes` (500) | `Delete` clears the topology first, in one transaction |
| 10 | `builder-store.ts` | `power_draw` was neither saved nor loaded, so a value set elsewhere vanished on the next save | Included in `getBuildData` and restored by `mapBuildToFlow` |
| 11 | `builder-store.ts` | Every save replaced `settings` with `boughtItems`/`showBought` only, wiping other keys such as `settings.planner` | The store keeps the loaded settings object and spreads it in `getBuildData` |
| 12 | `build_service.go` | `Duplicate` dropped `power_draw` and `mac_address` and left rack children pointing at the original rack | Copies both fields and remaps `parent_id` |
| 13 | `ip_service.go` | Nodes and edges were read without `ORDER BY`, so two saves of the same graph could swap addresses between equal devices | `loadTopology` reads in a fixed order |
| 14 | `testutil/pgtest.go` | The backend suite could hang: `AutoMigrate` in one test binary waited on a test of another that held two transactions | `migrateOnce` skips the migration when the fingerprint of the models is unchanged |
| 15 | `pkg/database/database.go`, `services/` | `SteeringRule` and `CatalogComponent` were not migrated at startup, and the hardware catalog was empty on a fresh database: its rows only existed in SQL files nothing applied | Both models are in `Models()`; `SeedCatalog` seeds hardware and services in Go; the SQL files and `cmd/migrate` are removed |
| 16 | `shared-build-page.tsx` | A save from a shared editable build did not send the connection type, so a wireless link came back as a cable | Sends the full edge payload |
| 17 | `build_service.go` | The answer to a save through an editable share link was the full build, including `gaming_plan.uplink.public_host` that the shared read hides | Both paths return through `asSharedView` |
| 18 | `builder-store.ts`, `sidebar.tsx` | The browser kept the last canvas but not which build it was: the sidebar's project link vanished on reload and Setup Guide showed whatever was open last | Only id, name and kind are kept; `buildStatus`; the canvas is read from the server |
| 19 | `builder-store.ts` | A save conflict loaded the server's build and threw the local edit away | The local canvas becomes an undo step; a save whose answer was lost is recognised and continued |
| 20 | `visual-builder.tsx` | "Saved" was shown while changes were pending, and a failed save was never tried again | `saveState` in the store; `autosave.ts` retries and reports |
| 21 | `use-proposals.ts` | A newer revision on the server was loaded only when the poll result changed, so a reload skipped because of unsaved edits never happened | The effect runs on every poll and when the save state changes |
| 22 | `builder-store.ts` | Deleting several selected devices left them in `hardwareNodes`, so the panels and Setup Guide still listed them | `onNodesChange` removes them, with the contents of a deleted rack |
| 23 | `builder-store.ts` | Validation issues of an earlier revision, or of another build, stayed after a reload | `loadBuild` drops them; they are fetched again |
| 24 | `use-projects-page.ts` | Deleting or renaming the open project on the Projects page left the old one open everywhere else | The store follows; a rename with an outdated revision is retried on the current one |
| 25 | `topology_ops.go` | A proposal kept the position the server chose for a new device, so applied after the canvas was rearranged it could land on other cards | The position is chosen again on refresh and apply |
| 26 | `visual-builder.tsx` | Zone outlines used rack-relative positions for devices in a rack and were drawn in the wrong place | Absolute positions |
| 27 | `command-palette.tsx` | The two groups were split by list position, which put Settings under the builder's actions | Each action names its group |
| 28 | `agent.go`, `assistant-store.ts` | After Stop or a lost connection the screen and the server disagreed about the conversation until the page was reloaded | A stopped reply is stored as written; the client reads the thread again after anything but a clean end |
| 29 | `assistant_thread_service.go`, `tools.go` | A NUL character in tool arguments made storing the reply fail (22P05) | Refused as an argument, stripped before storing |
| 30 | `activity-timeline.tsx`, `assistant-panel.tsx` | Screen-reader labels in the message list made the whole builder scrollable | The scroller is `relative` |
| 31 | `layout/place.ts`, `layout/index.ts`, `vite.config.ts` | The frontend suite failed on Node 20 under load: the layout engine's random-network test and one dialog test ran out of time | The engine no longer places the chosen drawing twice and skips placed items that cannot matter (the same drawings, in a third of the time on Node 20); `testTimeout` is 15 s |
| 32 | `sidebar.tsx` | The links of the mobile menu had no styling: `NavLink` with a class function sat under `SheetClose asChild` (pitfall 26) | Plain `Link`s with the class and `aria-current` worked out in place |
| 33 | `sidebar.tsx`, `profile-page.tsx` | An account without a picture was shown with one fetched from an avatar service, with the user's e-mail address in the request | `UserAvatar` draws initials; a generated avatar address is never fetched |
| 34 | `checklist-page.tsx` | The setup guide called itself personalised and used nothing of the build but the presence of device types; its numbering skipped; its check marks could not be ticked | Rewritten as a guide generated from the build (`setup-plan.ts`), with progress saved in the build |
| 35 | `sidebar.tsx`, `checklist-page.tsx` | Invalid HTML: the sign-in button sat inside a button, and a `<div>` badge inside a `<p>` | Both rewritten; the account row is one button, the sign-in button stands alone |
| 36 | `gaming-node-fields.tsx` | Selecting a device in a build without power circuits blanked the builder: the selector of the circuits returned a new empty array on every call (pitfall 37) | One constant stands for "no circuits"; a test runs the fields on the real store |
| 37 | `visual-builder.tsx`, `custom-edge.tsx`, `hardware-node.tsx`, `index.css` | An open canvas kept one to two processor cores busy while idle (issue #32): every cable ran React Flow's dash animation on each of its paths, zone outlines flowed and the lights of loaded hosts pulsed, all without end | Nothing on the canvas animates for ever (pitfall 41); a test reads the source for it |
| 38 | `custom-edge.tsx`, `visual-builder.tsx`, `hardware-node.tsx` | Dragging one card rendered every card and every cable on each frame: a cable read all nodes and kept its settings mounted, node objects were made anew on every change, the canvas and its panels took the whole store | Selectors, node objects kept while unchanged, cable buttons mounted when needed (pitfall 42) |
| 39 | `index.css`, `canvas-grid.tsx`, `custom-edge.tsx` | Panning and zooming painted the whole canvas again for each frame, under a blur behind every floating panel and an SVG dot pattern; blur filters on cables and zone outlines made each of those paintings dear | Solid panels, `CanvasGrid`, a compositor layer while the view moves, glows drawn as paths or dropped |
| 40 | `gaming-plan-dialog.tsx` | The closed game plan dialog compared the build with the server on every change of the store, a drag included | Asked only while the dialog is open |

---

## Environment Variables

### Backend (set by docker-compose or passed to test container)

| Variable | Default | Description |
|---|---|---|
| `DB_HOST` | `postgres` | PostgreSQL hostname |
| `DB_PORT` | `5432` | PostgreSQL port |
| `DB_USER` | `homelab` | PostgreSQL user |
| `DB_PASSWORD` | `homelab_password` | PostgreSQL password |
| `DB_NAME` | `homelab_builder` | Production database name |
| `DB_SSLMODE` | `disable` | PostgreSQL SSL mode |
| `TEST_DB_NAME` | `homelab_builder_test` | Test database name (used by TestMain) |
| `JWT_SECRET` | - | Secret for signing JWTs |
| `GOOGLE_CLIENT_ID` | - | Google OAuth client ID |
| `SERVER_PORT` | `8080` | HTTP listen port |
| `IPAM_URL` | `http://hlbipam:8081` | HLBIPAM microservice URL |
| `MCP_ENABLED` | `true` | Serves the `/mcp` endpoint |
| `MCP_ALLOWED_ORIGINS` | - | Browser origins allowed to call `/mcp` cross-origin (comma-separated) |
| `ASSISTANT_ENABLED` | `true` | Makes the in-app assistant available |
| `SECRETS_KEY` | - | Master key for stored provider keys and Proxmox token secrets: base64 of 32 bytes (`openssl rand -base64 32`). Required with login enabled in release mode |
| `SECRETS_KEY_VERSION` | `1` | Version label stored with each ciphertext |
| `ASSISTANT_ALLOW_PRIVATE_ENDPOINTS` | same as `AUTH_DISABLED` | Whether custom provider endpoints may be private addresses |
| `PUBLIC_APP_URL` | derived from the request | Browser-facing origin used in proposal review links |
| `INTEGRATIONS_ENABLED` | `true` | Makes integrations (Proxmox) available. The inventory itself is always there |
| `INTEGRATIONS_ALLOW_PRIVATE_ENDPOINTS` | same as `ASSISTANT_ALLOW_PRIVATE_ENDPOINTS` | Whether the server may call a Proxmox host at a private address. Where it may not, pasted exports are read instead |

### HLBIPAM

| Variable | Default | Description |
|---|---|---|
| `PORT` | `8081` | HTTP listen port |

### Frontend (Vite build args)

| Variable | Description |
|---|---|
| `VITE_API_URL` | Backend base URL (default: `http://localhost:8080`) |
| `VITE_GOOGLE_CLIENT_ID` | Google OAuth client ID |
