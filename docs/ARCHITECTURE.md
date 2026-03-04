# Homelab Builder — AI Agent Reference

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
4. [Frontend Architecture](#frontend-architecture)
5. [Data Model](#data-model)
6. [IP Assignment Algorithm](#ip-assignment-algorithm)
7. [Testing Infrastructure](#testing-infrastructure)
8. [Running Tests](#running-tests)
9. [Common Issues & Pitfalls](#common-issues--pitfalls)
10. [Fixed Bugs (Historical)](#fixed-bugs-historical)
11. [Environment Variables](#environment-variables)

---

## Project Overview

**Homelab Builder** is a full-stack web app that lets users visually design their home lab network — placing hardware nodes (routers, switches, servers, NAS, etc.), wiring them, and automatically receiving IP address assignments and service recommendations.

- **Backend**: Go 1.24.5, Gin, GORM v1.31.1, PostgreSQL 15
- **Frontend**: React 18, TypeScript, Vite, ReactFlow, Zustand, Vitest
- **Infrastructure**: Docker Compose (postgres + backend + frontend)

---

## Monorepo Layout

```
homelab-builder/
├── docker-compose.yml          # postgres + backend + frontend services
├── Makefile                    # dev and test commands
├── MVP.md                      # feature roadmap
├── AGENTS.md                   # this file
├── backend/
│   ├── cmd/
│   │   ├── server/main.go      # HTTP server entrypoint
│   │   └── migrate/main.go     # standalone migration runner
│   ├── internal/
│   │   ├── config/config.go    # env var loading
│   │   ├── handlers/           # Gin route handlers (one file per domain)
│   │   ├── middleware/         # auth, rate limiter, security headers
│   │   ├── models/models.go    # ALL GORM models in one file
│   │   └── services/           # business logic; the only layer with tests
│   ├── migrations/             # raw SQL migrations (applied by postgres init)
│   ├── pkg/database/database.go
│   ├── go.mod
│   └── Dockerfile              # multi-stage: builder → final scratch image
└── frontend/
    ├── src/
    │   ├── features/           # domain-sliced feature modules
    │   │   ├── builder/        # visual network builder (main feature)
    │   │   ├── admin/
    │   │   ├── auth/
    │   │   ├── catalog/
    │   │   └── shopping/
    │   ├── components/         # shared UI components
    │   ├── lib/api.ts          # base axios instance
    │   └── types/index.ts      # shared TypeScript types
    ├── vite.config.ts
    └── package.json
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

### Key Services

| File | Responsibility |
|---|---|
| `build_service.go` | CRUD for builds; syncs ReactFlow JSON → relational `nodes`/`edges` tables |
| `ip_service.go` | Graph-aware BFS IP assignment per subnet |
| `auth_service.go` | Google OAuth token verification, JWT issuance |
| `hardware_service.go` | Hardware catalog queries |
| `recommendation_service.go` | Service/hardware recommendations based on selections |

### Build Sync Flow

When a build is saved (`PUT /builds/:id`), `BuildService.Update` calls `SyncDataFromJSON`:
1. Parses the `data` JSON blob (ReactFlow state) from the request.
2. Deletes all existing nodes/edges for the build.
3. Re-inserts nodes and edges from the JSON.
4. IMPORTANT: `Preload("Nodes.VirtualMachines")` is required on all build fetches or VMs disappear from responses.

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

### Feature Structure

Each feature under `src/features/` follows the same pattern:
```
feature/
├── api/       # axios calls (typed with backend DTOs)
├── components/
├── hooks/
├── pages/
└── store/     # Zustand store (builder feature only)
```

---

## Data Model

Primary entities and their relationships:

```
User ──< Build ──< Node ──< VirtualMachine
                  Node ──< Edge (source/target are Node IDs)
Service ──< ServiceRequirement
UserSelection >── User
UserSelection >── Service
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
- **Backend tests run in Docker.** The builder stage of `backend/Dockerfile` contains the full Go toolchain and source. A temporary container is spun up on the same Docker network as the running `postgres` service.
- **Frontend tests run locally.** `buildApi` is fully vi.mock'd — no backend or Docker needed.

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

**CRITICAL**: `nodes.build_id` is a foreign key to `builds.id`. You cannot insert a node with a random `uuid.New()` build ID — it violates `fk_builds_nodes`. Always use `newBuildID(t, tx)` which creates a `User` + `Build` first.

### Helper Functions (`testhelpers_test.go`)

```go
testTx(t)                          // *gorm.DB transaction, auto-rolled back
connectTestDB()                    // connects to homelab_builder_test PG DB
migrateTestDB(db)                  // CREATE EXTENSION uuid-ossp + AutoMigrate
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
| `internal/services/build_service_test.go` | `services` | 10 build CRUD tests |
| `internal/services/ip_service_test.go` | `services` | 11 DB tests + 5 pure unit tests |
| `frontend/src/features/builder/store/builder-store.test.ts` | — | 14 Vitest tests |

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
```

Internally this:
1. Builds `backend/Dockerfile` up to the `builder` stage → image `homelab-builder-test-runner`
2. Runs a temporary container on `homelab-builder_default` network (same network as the `postgres` service from docker-compose)
3. Executes `go test ./internal/services/... -v -count=1`

### Frontend only

```bash
make test-frontend
# or: cd frontend && npm test
```

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

**Cause B** (real): The build genuinely has no node with `type = "router"`. `CalculateNetwork` returns this as an error — the caller should handle it gracefully.

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

The docker-compose default network is `homelab-builder_default` (derived from the project folder name). The `test-backend` make target hardcodes this. If you rename the project folder, update the Makefile.

### 8. uuid-ossp extension

`migrateTestDB` runs `CREATE EXTENSION IF NOT EXISTS "uuid-ossp"` before AutoMigrate. If this step is skipped (e.g. in a fresh DB), insert of any model will fail because `uuid_generate_v4()` is undefined.

### 9. Missing `Preload("Nodes.VirtualMachines")`

GORM does not eager-load associations by default. Any `BuildService` query that returns a build must explicitly preload `Nodes` and `Nodes.VirtualMachines` or VM data will be missing from API responses. The regression test `TestGetByID_PreloadsVirtualMachines` guards this.

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
| `JWT_SECRET` | — | Secret for signing JWTs |
| `GOOGLE_CLIENT_ID` | — | Google OAuth client ID |
| `SERVER_PORT` | `8080` | HTTP listen port |

### Frontend (Vite build args)

| Variable | Description |
|---|---|
| `VITE_API_URL` | Backend base URL (default: `http://localhost:8080`) |
| `VITE_GOOGLE_CLIENT_ID` | Google OAuth client ID |
