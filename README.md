# HLBuilder
![Logo](./logo.svg)

[![License: AGPL v3](https://img.shields.io/badge/License-AGPL_v3-blue.svg)](https://www.gnu.org/licenses/agpl-3.0)

HLBuilder is a comprehensive, interactive web application designed to simplify the process of planning and architecting home laboratory infrastructure. It provides users with a visual interface to design network topologies, receive intelligent hardware recommendations based on their self-hosting needs, and generate actionable shopping lists.

## 🚀 Key Features

### 1. Visual Network Builder
The core of the application is a visual canvas powered by **ReactFlow**.
- **Drag-and-drop hardware nodes**: Routers, switches, servers, NAS, Mini-PCs, SBCs (like Raspberry Pi), UPS, and more.
- **Wire components**: Graph-based representation of physical and logical connections.
- **Nested Virtualization**: Define Virtual Machines (VMs), Containers, or LXCs directly on compute nodes.
- **Real-time Synchronization**: The visual state is continuously synchronized with a PostgreSQL database.

### 2. Automated IP Management (`hlbIPAM`)
A sophisticated backend microservice manages network addressing:
- **Microservice Architecture for Scaling**: Built as a completely independent, stateless Go service. IP allocation requires heavy graph traversal and subnet math; isolating it means we can horizontally scale the IPAM workers seamlessly under high load without dragging down the main API server.
- **Topology-Aware BFS**: Automatically assigns IP addresses by performing a Breadth-First Search from the gateway.
- **Dynamic Pool Sizing**: Intelligently packs VM-hosting devices into separate pools without collisions.
- **Conflict Prevention**: Handles custom IP assignments and avoids DHCP range overlaps.

### 3. Service Catalog & Hardware Recommendations
- **Comprehensive Catalog**: Browse popular homelab services with pre-defined resource requirements.
- **3-Tier Suggestions**: Generates "Minimal", "Recommended", and "Optimal" hardware profiles.
- **Live Resource Dashboard**: Calculates aggregate CPU, RAM, Storage, and Power needs to ensure hardware can handle the concurrent load.

### 4. Actionable Shopping List
- **Itemized Components**: Automatically generates a shopping list including main hardware and necessary peripherals (RAM, NVMe, etc.).
- **Price Estimation**: Provides estimated costs with direct purchase links based on your region.

---

## 🛠️ Tech Stack

| Layer | Technology |
|-------|-----------|
| **Frontend** | React 18 + TypeScript, Vite, ReactFlow, TailwindCSS, Zustand |
| **Backend API** | Go 1.24+, Gin, GORM v1.25.x |
| **IPAM Microservice**| Go 1.24+, Standard Library REST API |
| **Database** | PostgreSQL 15 |
| **Auth & Security** | Google OAuth 2.0 + JWT |
| **Deploy** | Docker & Docker Compose |

---

## 🏗️ Architecture Overview
For detailed information on the codebase architecture, folder structure, testing infrastructure, and known pitfalls, please refer to [docs/ARCHITECTURE.md](./docs/ARCHITECTURE.md). 
For the feature roadmap and future ideas, see [ROADMAP.md](./ROADMAP.md).

---

## 🚀 Quick Start

```bash
# Clone the repository
git clone https://github.com/Butterski/homelab-builder.git
cd homelab-builder

# Start all services via Docker Compose
docker compose up -d

# Access the application
# Frontend: http://localhost:3000
# Backend:  http://localhost:8080
```

## 👨‍💻 Local Development

```bash
# Backend (requires Go 1.24+)
cd backend
cp ../.env.example ../.env
go run ./cmd/server

# Frontend (requires Node 20+)
cd frontend
npm install
npm run dev
```

## 🎨 Credits
HLBuilder's custom 3-layer structural logo was designed and created by **[Paweł Kręczewski](https://www.linkedin.com/in/pawe%C5%82-kr%C4%99czewski-a2a372242/)**.

## 📄 License
This project is licensed under the **GNU Affero General Public License v3.0 (AGPL-3.0)**. See the [LICENSE](./LICENSE) file for details.
