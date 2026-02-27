# Homelab Builder v2 Sprint Plan

Based on the requirements outlined in [ideas.md](file:///g:/projekty/homelab-builder/ideas.md) and [ipam_desc.md](file:///g:/projekty/homelab-builder/ipam_desc.md), here is a proposed sprint plan specifically structured to gradually introduce the new "v2" features while ensuring system stability and scalability.

## User Review Required
> [!IMPORTANT]
> Please review the structure of the proposed sprints. Let me know if you would like to adjust the priorities, move certain tasks between sprints, or if you approve of this roadmap.

---

## Testing Requirements
> [!IMPORTANT]
> **Every single sprint** must include comprehensive test coverage for all new features and changes.
> Furthermore, **all tests must be run inside Docker**. Docker is the target environment for the application, so running tests inside the containers ensures environment consistency and accurate validation of the integration.

---

## Proposed Sprints

### Sprint 1: UX Quick Wins (COMPLETED)
The quickest way to add value is making the app less overwhelming for new users.
- **Fast Start Feature**: Create a wizard that generates a basic homelab template based on simple Q&A.
- **Interactive Onboarding**: Build a quick, step-by-step UI tour highlighting key canvas features.
- **Template Projects**: Provide 2-3 predefined homelabs using real catalog hardware as reference points.

### Sprint 2: Architecture & Database Constraints (COMPLETED)
We executed the "Full Architecture Upgrade" (Option 2) in this phase.
- **Relational DB Shift**: Moved away from monolithic JSON blob storage into strict relational tables (`nodes`, `vms`, `components`, `edges`). Added full `Preload` cascading logic.
- **Strict Frontend DTOs**: Overhauled the React Flow `builder-store.ts` to transmit deeply normalized Arrays instead of raw stringified React DOM components, hardening both the visual state and Postgres stability.
- **Query Optimization**: Completely removed N+1 looping query bloat by mapping directly via unique UUID allocations seamlessly persisting across node relations.

### Sprint 3: Authentication & Profiles (completed)
Secure the platform so users can save projects reliably.
- **OAuth2 Implementation**: Enforce robust token validation on the Go backend.
- **User Sessions**: Manage secure sessions and basic profile data.
- **Save State Protection**: Ensure projects are securely tied to authenticated users.

### Sprint 4: External Data Integration (Live Pricing)
Make the shopping list a killer feature.
- **PL Retailers API**: Integrate Ceneo, Skąpiec, or custom scrapers for localized polish pricing.
- **International Pricing**: Integrate Amazon PA API (or similar) for USD/EUR pricing.
- **Catalog Auto-Enrichment**: Add logic to update the hardware catalog with real specs scraped from these sources.

### Sprint 5: Affiliate Links & Admin Expansion
Start testing the shopping flow and revenue mechanisms safely, moving towards a production-ready 1.0 setup.
- **Production-Ready Links**: Generate real, functional affiliate links in the shopping list instead of mocked ones. The infrastructure will be built to scale for production.
- **Admin Link Management**: Build an admin UI to manage these affiliate links directly on hardware components.
- **Admin Dashboard Expansion**: Add full CRUD operations to the Service Catalog directly within the Admin panel (inline edit, delete, resource requirements logic).
- **Admin Component Mass Planner**: Bulk-define reference component types (disks, GPUs) for consistent use across the canvas.
- **Link & Service Steering**: Add rules for prioritizing specific retailers globally, controlled via the Admin panel.
- **Strict Admin Security**: Promotion to the Admin role is a critical security boundary. **There will be no API or UI for promoting admins.** Users will be promoted to the admin role *exclusively* via a secure SQL migration directly against the database (e.g., `012_promote_initial_admin.up.sql`). The Admin Panel button in the frontend will be strictly hidden from any user where `!user.is_admin`.

### Sprint 6: hlbIPAM Microservice - Core Logic & Architecture (completed and testing)
Build the standalone, stateless IP assignment engine as a new service, explicitly designed to be easily open-sourced as a standalone repository later.
- **Monorepo Structure**: Create a new `hlbipam/` directory at the root (alongside `backend/` and `frontend/`) to keep the monorepo clean.
- **Stateless Microservice**: Initialize a lightweight Go (1.21+) HTTP REST API server with no external database dependencies. Calculations must be based entirely on the JSON payload.
- **BFS Algorithm**: Implement topology-aware IP allocation with multiple subnets, intelligent reservation, and DHCP range exclusion (e.g., `< 100ms` performance).
- **Device Ranges**: Define configurable IP offset blocks for roles (router .1, switches .10, servers .150-.159, vms incrementing, etc.).
- **API Endpoints**: 
  - `POST /api/v1/allocate`: Calculate and fill in missing IPs.
  - `POST /api/v1/validate`: Check for conflicts and rule violations in existing/user-assigned IPs.

### Sprint 7: hlbIPAM - Application Integration (completed and testing)
Connect the new brain to the front end.
- **Backend Proxy**: Route IPAM-related requests from the main Go backend to the `hlbipam` service.
- **Frontend Canvas Integration**: Update ReactFlow to request and display allocated IPs in real-time.
- **Conflict Handling**: Surface IPAM validation warnings (e.g., "IP conflict", "Subnet exhausted") gracefully in the UI.

### Sprint 8: Emulation, Testing & Validation
Help users verify their designs before they buy hardware.
- **Homelab Simulation Engine**: Develop checks for network bottlenecks or incompatible connections.
- **Resource Exhaustion Checker**: Warn when proposed VMs exceed the physical node's CPU/RAM limits.
- **Pre-flight Checks**: Add a "Validate Topology" button summarizing all hardware and logical constraints.

### Sprint 9: "Pro" Tier Foundation
Gated features to reward power users and support the platform.
- **Subscription Architecture**: Implement basic payment/tier tracking logic.
- **Project Limits**: Enforce free tier (max 3 projects) vs. Pro tier (max 30 projects).
- **Pro IPAM Features**: Unlock flexible subnetting and custom VLAN support in `hlbipam` for Pro users.

### Sprint 10: Advanced Pro Features & AI
The long-term vision features.
- **AI Planning Assistant**: Chat-based helper for beginners to architect their homelab.
- **AI Hardware Finder**: Suggests specific components based on precise budget and needs.
- **Community Benefits**: Implement Discord gating for Pro users and priority support mechanisms.

---

## Verification Plan

### Manual Verification
- **Review**: The user will review the sprint plan for alignment with their product goals.
- **Execution**: Future tasks will involve creating GitHub/Jira issues or project board tickets based on these sprint items.
