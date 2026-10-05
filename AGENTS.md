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
- **Infrastructure**: Docker Compose (postgres + backend + hlbipam + frontend)

---

## Monorepo Layout

```
homelab-builder/
├── docker-compose.yml          # postgres + backend + hlbipam + frontend services
├── docker-compose.test.yml     # test-specific compose overrides
├── Makefile                    # dev and test commands
├── AGENTS.md                   # this file
├── backend/
│   ├── cmd/
│   │   ├── server/main.go      # HTTP server entrypoint
│   │   └── migrate/main.go     # standalone migration runner
│   ├── internal/
│   │   ├── assistant/          # LLM tool registry, chat agent, instructions
│   │   ├── config/config.go    # env var loading
│   │   ├── handlers/           # Gin route handlers (one file per domain)
│   │   ├── llm/                # provider adapters (Anthropic, OpenAI-compatible), SSRF guard
│   │   ├── mcpserver/          # /mcp endpoint: token auth, rate limits
│   │   ├── middleware/         # auth, admin, rate limiter, security headers
│   │   ├── models/models.go    # ALL GORM models in one file
│   │   ├── secrets/            # AES-256-GCM sealing of stored provider keys
│   │   ├── services/           # business logic; most tests live here
│   │   └── testutil/           # Postgres transaction helper for packages outside services
│   ├── migrations/             # raw SQL migrations (applied by postgres init)
│   ├── pkg/database/database.go
│   ├── go.mod
│   ├── Dockerfile              # multi-stage: builder → final scratch image
│   └── Dockerfile.test         # test runner image
├── hlbipam/                    # standalone IPAM microservice
│   ├── cmd/server/             # entrypoint
│   ├── internal/
│   │   ├── api/                # HTTP handlers
│   │   ├── core/               # allocator, subnet, types, validator
│   │   ├── models/             # data models
│   │   └── utils/              # utility functions
│   ├── Dockerfile
│   ├── Dockerfile.test
│   ├── go.mod
│   └── test_ipam.go            # integration test script
├── discord-bot/                # placeholder (empty)
├── frontend/
│   ├── src/
│   │   ├── features/           # domain-sliced feature modules
│   │   │   ├── admin/          # admin dashboard & management
│   │   │   ├── assistant/      # in-app chat panel (SSE client, store, components)
│   │   │   ├── auth/           # authentication (Google OAuth, profile)
│   │   │   ├── builder/        # visual network builder (main feature)
│   │   │   ├── catalog/        # hardware & service catalog browsing
│   │   │   ├── donate/         # donation page
│   │   │   ├── landing/        # landing/login page
│   │   │   ├── settings/       # settings page: appearance, AI assistant, MCP access
│   │   │   ├── setup-guide/    # setup checklist
│   │   │   ├── shopping/       # shopping list generation
│   │   │   └── survey/         # beta survey
│   │   ├── components/         # shared UI components
│   │   │   ├── auth/           # auth guards (RequireAuth)
│   │   │   ├── icons/          # icon components
│   │   │   ├── layout/         # sidebar, main layout
│   │   │   └── ui/             # design system primitives (button, dialog, etc.)
│   │   ├── lib/                # shared utilities
│   │   │   ├── api.ts          # base axios instance
│   │   │   ├── templates.ts    # config templates
│   │   │   └── utils.ts        # general utilities
│   │   ├── services/           # shared service layer (api.ts)
│   │   ├── types/index.ts      # shared TypeScript types
│   │   ├── App.tsx             # root component with routing
│   │   └── main.tsx            # React entry point
│   ├── vite.config.ts
│   └── package.json
└── docs/
    ├── ARCHITECTURE.md         # copy of this file
    ├── MCP.md                  # connecting LLM clients over MCP
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
| `auth.go` | Google OAuth login, dev login, get current user, update preferences |
| `build_handler.go` | Build CRUD, duplicate, calculate-network, validate-network |
| `hardware_handler.go` | Public hardware catalog + admin CRUD, bulk import, approve, buy URLs |
| `services.go` | Service CRUD + community submission |
| `recommendations.go` | Generate recommendations |
| `shopping_list.go` | Generate shopping list |
| `selections.go` | User service selections CRUD |
| `admin_handler.go` | Admin dashboard, user list, service management, events |
| `config_handler.go` | Config generation for builds |
| `steering_handler.go` | Steering rules CRUD (admin) |
| `catalog_component_handler.go` | Catalog component CRUD |
| `donate_handler.go` | Donation progress read/update |
| `survey_handler.go` | Beta survey CRUD |
| `health.go` | Health check endpoint |
| `proposal_handler.go` | Sync state poll, proposal get / apply / reject |
| `api_token_handler.go` | Personal access tokens for MCP clients (JWT only) |
| `assistant_handler.go` | Assistant settings, provider test, chat thread, chat stream (SSE) |

### Key Services

| File | Responsibility |
|---|---|
| `build_service.go` | CRUD for builds; saves the submitted graph into the relational `nodes`/`edges` tables and recalculates IPs |
| `build_snapshot.go` | `BuildToSyncInput`, `GetOwned`, `PreviewTopology` (dry run) |
| `proposal_service.go` | LLM proposals: propose, refresh, apply, reject, sync state |
| `topology_ops*.go`, `topology_ports.go`, `topology_layout.go`, `topology_diff.go` | Change-set engine behind proposals |
| `api_token_service.go` | Personal access tokens |
| `assistant_settings_service.go`, `assistant_thread_service.go` | Assistant settings with the encrypted key; stored chat |
| `ip_service.go` | Graph-aware BFS IP assignment per subnet |
| `auth_service.go` | Google OAuth token verification, JWT issuance |
| `hardware_service.go` | Hardware catalog queries + admin operations |
| `recommendation_service.go` | Service/hardware recommendations based on selections |
| `service_service.go` | Service catalog CRUD + community submissions |
| `shopping_service.go` | Shopping list generation from build data |
| `selection_service.go` | User service selections |
| `config_service.go` | Network config generation (e.g. router configs) |
| `steering_service.go` | Affiliate steering rules per hardware category |
| `catalog_component_service.go` | Catalog component CRUD |
| `analytics_service.go` | Analytics tracking (available for future handler integration) |

### Build Save Flow

Builds are stored as relational rows (`nodes`, `edges`, `virtual_machines`, `internal_components`), not as a JSON blob.

Every write goes through one path: `PUT /builds/:id/topology` -> `BuildService.UpdateAndCalculate` -> `SaveAndCalculateTx`:
1. Locks the build row and checks the revision the client sent (a stale revision returns 409 with the current build).
2. `syncGraph` replaces the build's nodes, edges, VMs and components with the submitted `SyncGraphInput`. Node, VM and component UUIDs sent by the client are kept; **edge IDs are regenerated on every save**, so nothing may refer to an edge by ID.
3. Runs the IP calculation (hlbIPAM) in the same transaction and bumps the revision.
4. IMPORTANT: `Preload("Nodes.VirtualMachines")` is required on all build fetches or VMs disappear from responses.

`BuildService.PreviewTopology` runs the same steps and then rolls the transaction back (sentinel `errDryRun`). It is how a proposal is checked without touching the build.

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
│   │   ├── subnet.go    # Subnet calculations
│   │   ├── types.go     # Data types for network topology
│   │   └── validator.go # Network validation rules
│   ├── models/          # Data models
│   └── utils/           # Utility functions
└── test_ipam.go         # Integration test script
```

The backend communicates with HLBIPAM via `IPAM_URL` (default: `http://hlbipam:8081`).

---

## LLM Access: MCP Server and Assistant

Two ways for an LLM to work with a user's builds. Both use the same tool registry and the same rule: **an LLM never writes to a build**. It creates a proposal, and only the owner's Apply in the web UI saves it.

User-facing docs: `docs/MCP.md` (client setup) and `docs/AI-ASSISTANT-SECURITY.md` (key handling, threat model).

### Pieces

| Package / file | Responsibility |
|---|---|
| `internal/assistant/tools*.go` | Tool registry shared by MCP and the chat: `list_builds`, `get_build`, `validate_build`, `generate_configs`, `search_hardware`, `list_services`, `recommend_hardware`, `get_proposal`, `propose_changes`, `create_build` (MCP only). `Registry.Call` validates arguments against the tool's JSON schema, enforces the actor's scope and build restriction, and audits state-changing calls. |
| `internal/assistant/instructions.go` | The fixed domain primer: MCP server instructions and the chat system prompt. |
| `internal/assistant/agent.go` | Chat loop for the in-app assistant: one turn per user at a time, at most 12 model calls per message, history stored append-only. |
| `internal/mcpserver/` | `/mcp` endpoint (official `modelcontextprotocol/go-sdk`, stateless streamable HTTP). Authenticates a personal access token, rate-limits per token, and builds a per-request server exposing only the tools the token's scope allows. |
| `internal/llm/` | Provider adapters behind one `Provider` interface: Anthropic (official SDK) and OpenAI-compatible (OpenAI, Gemini, OpenRouter, Ollama, custom). `ssrf.go` restricts which addresses the server may call. |
| `internal/secrets/` | AES-256-GCM sealing of provider keys, bound to the owner through the AAD. |
| `services/proposal_service.go` | Propose (dry run + diff), Refresh, Apply (replays the operations on the latest revision), Reject, SyncState. |
| `services/topology_ops*.go` | Applies a change set (`add_node`, `connect`, `add_vm`, ...) to a `SyncGraphInput` in memory. Mirrors the canvas rules: port handles, port counts, cable orientation, loop rejection, rack slots, auto layout. |
| `services/topology_diff.go` | Diff between two builds, shown in the review panel. |
| `services/api_token_service.go` | Personal access tokens (`hlb_...`): only the SHA-256 is stored; scopes `read` / `propose`; optional single-build restriction. |
| `services/assistant_settings_service.go` | Per-user provider, model and encrypted key. `LoadKeyring` picks the master key (`SECRETS_KEY`, or a generated one kept in `system_settings` on instances without login). |
| `services/assistant_thread_service.go` | Stored chat messages: provider-neutral parts plus the provider's native message for replay. |

### Proposal flow

```
propose_changes (MCP tool or chat tool)
  -> ApplyTopologyOps(current build, ops)      in memory, new entities get their final UUIDs
  -> BuildService.PreviewTopology              dry run: save + IPAM + validation, rolled back
  -> DiffBuilds                                stored with the proposal (status: pending)
builder polls GET /builds/:id/sync-state every 4s -> banner -> read-only preview canvas
POST /builds/:id/proposals/:pid/apply          replays the ops on the latest revision, then saves
```

- One pending proposal per build: a new one supersedes the older.
- Apply rebases: edits saved after the proposal was created are kept. If the operations no longer fit, the proposal becomes `conflict` (409).
- Connections are addressed by their unordered node pair, never by edge ID.

### Rules that must not be broken

- A provider key is write-only. `AssistantSettings` key fields are `json:"-"`; only `AssistantSettingsService.ResolveCredentials` decrypts, for one request. Never log, return or store the plaintext.
- Changing the provider or base URL wipes the stored key unless a new key comes in the same request.
- Provider SDK clients are built with explicit options only (`NewBetaMessageService`, `NewChatCompletionService`, ...). The SDKs' default clients read credentials from the server's environment, which must never be used for a user's request.
- All provider calls use `AssistantSettingsService.HTTPClient()` (`llm.SafeHTTPClient`): it checks the resolved address on every dial.
- `/mcp` always requires a token, also when `AUTH_DISABLED` is on. JWT routes never accept an access token, so a token cannot mint tokens.
- The SQL logger runs with `ParameterizedQueries: true`: statement values (chat text, ciphertext) never reach the log. Keep it that way.
- Model output is untrusted: the chat renders Markdown without raw HTML and without images.

---

## Frontend Architecture

### State Management (Zustand)

The builder feature uses a single Zustand store at `features/builder/store/builder-store.ts`.

**Critical ordering rule in `reassignAllIPs`:**
```
1. buildApi.update(currentBuildId, buildPayload)   ← MUST be first
2. buildApi.calculateNetwork(currentBuildId)        ← reads what was just saved
3. buildApi.get(currentBuildId)                    ← reload IPs into local state
```
If `calculateNetwork` runs before `update`, the backend reads stale/empty relational tables and returns "no router found".

**Trigger rules:**
- `onConnect` (new edge drawn) → triggers `reassignAllIPs` via `setTimeout(0)`
- `addHardware`, `addVM`, `duplicateHardware` → do NOT trigger `reassignAllIPs`

**Proposal preview and sync:**
- `proposalPreview` is a separate slice rendered by a read-only overlay canvas. The live `nodes`/`edges` are never swapped out, so a preview cannot trigger autosave. Undo/redo do nothing during a preview.
- `lastSyncedFingerprint` records the graph as last saved or loaded. Autosave is skipped while the canvas matches it. Without this, two open tabs would save in turns forever, because each reloads when the other's save bumps the revision (`useSyncState` polls every 4s).
- `applyProposal` saves pending edits first, applies on the server, reloads, and pushes one undo step.

The assistant has its own store (`features/assistant/store/assistant-store.ts`, not persisted). The side panel in `visual-builder.tsx` shows the proposal review while a proposal is open, otherwise the assistant.

### Feature Structure

Each feature under `src/features/` follows this general pattern (not all subdirs are present in every feature):
```
feature/
├── api/       # axios calls (typed with backend DTOs)
├── components/
├── data/      # static data / constants (e.g. shopping feature)
├── hooks/
├── lib/       # feature-specific utilities (e.g. builder, auth)
├── pages/
└── store/     # Zustand store (builder feature only)
```

### Frontend Features

| Feature | Description |
|---|---|
| `builder/` | Visual network builder - the main feature (ReactFlow canvas, node management, IP display) |
| `admin/` | Admin dashboard, user management, service/hardware admin, steering rules, catalog components |
| `auth/` | Login page (Google OAuth), profile page |
| `catalog/` | Public hardware & service catalog browsing |
| `shopping/` | Shopping list generation from build data |
| `donate/` | Donation page with progress tracking |
| `landing/` | Landing page shown to unauthenticated users |
| `setup-guide/` | Interactive setup checklist |
| `survey/` | Beta user survey |
| `settings/` | Settings page: appearance, AI assistant (provider, key, key-protection panel), MCP access tokens |
| `assistant/` | Chat panel in the builder: SSE reader, store, message list, proposal cards |

### Routing (App.tsx)

| Path | Component | Auth Required |
|---|---|---|
| `/` | `ProjectsPage` (logged in) / `LoginPage` (guest) | No |
| `/builder/:id` | `VisualBuilderPage` | Yes |
| `/generate` | `ConfigGeneratorPage` | Yes |
| `/admin` | `AdminPage` | Yes |
| `/profile` | `ProfilePage` | Yes |
| `/settings` | `SettingsPage` | Yes |
| `/donate` | `DonatePage` | Yes |
| `/checklist` | `ChecklistPage` | Yes |
| `/hardware` | `HardwareCatalogPage` | No |
| `/services` | `ServiceCatalogPage` | No |

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
Build ──< BuildProposal
User ──1 AssistantSettings         (encrypted provider key)
User + Build ──1 AssistantThread ──< AssistantMessage
SystemSetting                      (key/value, instance-wide)
```

### Node Types and IP Zones

Each node type maps to a fixed IP offset block within a `/24` subnet:

| Type | Base Octet | Block Size | VM-capable |
|---|---|---|---|
| router | 1 | 1 | No |
| switch | 10 | 1 | No |
| access_point | 20 | 1 | No |
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

Non-network types (`disk`, `gpu`, `hba`, `pcie`, `pdu`, `ups`) are never assigned IPs even when connected to a router.

### GORM Tag Requirements

All primary keys use PostgreSQL-native UUID generation:

```go
ID uuid.UUID `gorm:"type:uuid;default:uuid_generate_v4();primaryKey"`
```

This requires the `uuid-ossp` extension. **SQLite cannot be used for tests** because:
- `uuid_generate_v4()` does not exist in SQLite
- `jsonb` type does not exist in SQLite
- AutoMigrate fails on both

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
migrateTestDB(db)                  // CREATE EXTENSION uuid-ossp + AutoMigrate
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
| `internal/services/build_service_test.go` | `services` | Build CRUD tests |
| `internal/services/ip_service_test.go` | `services` | DB tests + pure unit tests |
| `internal/services/auth_service_test.go` | `services` | Auth service tests |
| `internal/services/hardware_service_test.go` | `services` | Hardware catalog tests |
| `internal/services/recommendation_service_test.go` | `services` | Recommendation generation tests |
| `internal/services/service_service_test.go` | `services` | Service catalog tests |
| `internal/services/shopping_service_test.go` | `services` | Shopping list tests |
| `internal/services/steering_service_test.go` | `services` | Steering rules tests |
| `internal/handlers/health_test.go` | `handlers` | Health endpoint test |
| `internal/handlers/assistant_handler_test.go` | `handlers` | Settings API never returns the key; chat SSE stream |
| `internal/services/topology_ops_test.go` | `services` | Change-set engine: refs, ports, loops, racks, VMs |
| `internal/services/proposal_service_test.go` | `services` | Dry run, supersede, apply with rebase, conflict, reject |
| `internal/services/api_token_service_test.go` | `services` | Token hashing, scopes, expiry, limits |
| `internal/services/assistant_settings_service_test.go` | `services` | Key encryption, owner binding, key wipe on destination change, audit |
| `internal/assistant/tools_test.go`, `agent_test.go` | `assistant` | Tool scopes and schemas; chat loop with a fake provider |
| `internal/mcpserver/server_test.go` | `mcpserver` | End to end with the go-sdk client: auth, scopes, origin check, rate limits |
| `internal/llm/provider_test.go`, `ssrf_test.go` | `llm` | Provider adapters against `httptest`; blocked-address table |
| `internal/secrets/aesgcm_test.go` | `secrets` | Round trip, tampering, wrong owner |
| `hlbipam/internal/core/allocator_test.go` | `core` | IPAM allocator tests |
| `hlbipam/internal/core/validator_test.go` | `core` | IPAM validator tests |
| `frontend/src/features/builder/store/builder-store.test.ts` | - | Vitest tests |
| `frontend/src/features/builder/store/builder-store.proposals.test.ts` | - | Preview, apply as one undo step, sync |
| `frontend/src/features/builder/components/proposal-review-panel.test.tsx` | - | Review panel |
| `frontend/src/features/settings/**/*.test.ts(x)` | - | MCP snippets and source links, token card, assistant settings card |
| `frontend/src/features/assistant/**/*.test.ts(x)` | - | SSE reader, chat store, chat panel |

### Test Database

- Name: `homelab_builder_test` (separate from the production `homelab_builder`)
- Created automatically by `TestMain` if it does not exist.
- Migrated via GORM `AutoMigrate` (not the raw SQL migration files in `migrations/`).

---

## Running Tests

### Prerequisites

```bash
make setup   # or: docker compose up -d
# Wait for postgres container to be healthy before running backend tests.
```

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
  -e CGO_ENABLED=0 -e DB_TYPE=postgres -e DB_HOST=test-postgres -e DB_USER=homelab -e DB_PASSWORD=homelab_password \
  -e TEST_DB_NAME=homelab_builder_test -e IPAM_URL=http://hlbipam:8081 \
  golang:1.25-alpine go test ./internal/assistant/... -count=1
```

### Frontend only

```bash
make test-frontend
# or: cd frontend && npm test
# in Docker, keeping node_modules off the host:
docker run --rm -v "$PWD:/repo" -v hlb-frontend-node-modules:/repo/frontend/node_modules -w /repo/frontend \
  node:22-alpine sh -c "npm ci --legacy-peer-deps && npx tsc -b && npx vitest run"
```

The whole repository is mounted because one test checks that the source files the settings page links to exist.

### Watching frontend tests

```bash
cd frontend && npm run test:watch
```

---

## Common Issues & Pitfalls

### 1. "fk_builds_nodes" foreign key violation in tests

**Symptom**: `ERROR: insert or update on table "nodes" violates foreign key constraint "fk_builds_nodes"`

**Cause**: Creating a `Node` with a `build_id` that doesn't exist in the `builds` table. Using `uuid.New()` as a build ID does not work.

**Fix**: Always use `newBuildID(t, tx)` which creates a real `User` + `Build` first.

### 2. Tests cannot use SQLite

`models.go` uses `gorm:"type:uuid;default:uuid_generate_v4()"` and `gorm:"type:jsonb"`. These are PostgreSQL-specific. GORM AutoMigrate will fail on SQLite with both types. Tests must always run against a real PostgreSQL instance via Docker.

### 3. "no router found to establish gateway" from calculateNetwork

**Cause A** (frontend bug, fixed): `reassignAllIPs` was calling `calculateNetwork` before `buildApi.update`. The backend read stale/empty `nodes` and found no router.

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

**Fix**: After `buildApi.get`, the store now overlays backend `node.ip` values onto matching `hardwareNodes` entries by `node.id`.

### 7. Docker network name

The docker-compose default network is `homelab-builder_default` (derived from the project folder name). Commands that attach a one-off container to the test stack name it explicitly. If you rename the project folder, adjust them.

### 8. uuid-ossp extension

`migrateTestDB` runs `CREATE EXTENSION IF NOT EXISTS "uuid-ossp"` before AutoMigrate. If this step is skipped (e.g. in a fresh DB), insert of any model will fail because `uuid_generate_v4()` is undefined.

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
| `DB_TYPE` | `postgres` | Database driver type |
| `TEST_DB_NAME` | `homelab_builder_test` | Test database name (used by TestMain) |
| `JWT_SECRET` | - | Secret for signing JWTs |
| `GOOGLE_CLIENT_ID` | - | Google OAuth client ID |
| `SERVER_PORT` | `8080` | HTTP listen port |
| `IPAM_URL` | `http://hlbipam:8081` | HLBIPAM microservice URL |
| `MCP_ENABLED` | `true` | Serves the `/mcp` endpoint |
| `MCP_ALLOWED_ORIGINS` | - | Browser origins allowed to call `/mcp` cross-origin (comma-separated) |
| `ASSISTANT_ENABLED` | `true` | Makes the in-app assistant available |
| `SECRETS_KEY` | - | Master key for stored provider keys: base64 of 32 bytes (`openssl rand -base64 32`). Required with login enabled in release mode |
| `SECRETS_KEY_VERSION` | `1` | Version label stored with each ciphertext |
| `ASSISTANT_ALLOW_PRIVATE_ENDPOINTS` | same as `AUTH_DISABLED` | Whether custom provider endpoints may be private addresses |
| `PUBLIC_APP_URL` | derived from the request | Browser-facing origin used in proposal review links |

### HLBIPAM

| Variable | Default | Description |
|---|---|---|
| `PORT` | `8081` | HTTP listen port |

### Frontend (Vite build args)

| Variable | Description |
|---|---|
| `VITE_API_URL` | Backend base URL (default: `http://localhost:8080`) |
| `VITE_GOOGLE_CLIENT_ID` | Google OAuth client ID |
