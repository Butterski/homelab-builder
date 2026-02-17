# Homelab Builder

An interactive web application that helps you plan your homelab infrastructure. Select the services you want to self-host, and get hardware recommendations with a shopping list.

## Features

- **Service Catalog** — Browse 15+ popular homelab services (Plex, Jellyfin, Home Assistant, Pi-hole, etc.)
- **Hardware Recommendations** — Get 3-tier specs (Minimal / Recommended / Optimal) based on your selections
- **Shopping List** — Itemized component list with estimated prices (PLN) and purchase links
- **Google OAuth** — Save your selections with authentication
- **Docker Ready** — One-command deployment with Docker Compose

## Tech Stack

| Layer | Technology |
|-------|-----------|
| Frontend | React + TypeScript (Vite) |
| Backend | Go (Gin + GORM) |
| Database | PostgreSQL 15 |
| Auth | Google OAuth + JWT |
| Deploy | Docker + Nginx |

## Quick Start

```bash
# Clone and start
git clone https://github.com/Butterski/homelab-builder.git
cd homelab-builder
docker compose up -d

# Access
# Frontend: http://localhost:3000
# Backend:  http://localhost:8080
# API:      http://localhost:8080/api/services
```

## Development

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

## API Endpoints

| Method | Path | Description |
|--------|------|-------------|
| GET | `/health` | Health check |
| GET | `/api/services` | List all services |
| GET | `/api/services/:id` | Get service by ID |
| POST | `/api/recommendations` | Generate hardware recommendations |
| POST | `/api/shopping-list` | Generate shopping list |
| POST | `/auth/google` | Google OAuth login |
| GET | `/auth/me` | Get current user (auth required) |
| GET | `/api/selections` | Get user selections (auth required) |
| POST | `/api/selections` | Add selection (auth required) |
| DELETE | `/api/selections/:id` | Remove selection (auth required) |

## Architecture

```
frontend/ (React + Vite)
├── src/
│   ├── pages/       # HomePage, ServicesPage, RecommendationsPage, ShoppingListPage
│   ├── components/  # Navbar
│   ├── services/    # API client
│   └── types/       # TypeScript interfaces

backend/ (Go + Gin)
├── cmd/server/      # Entry point
├── internal/
│   ├── handlers/    # HTTP handlers
│   ├── services/    # Business logic
│   ├── models/      # GORM models
│   ├── middleware/   # JWT auth
│   └── config/      # Environment config
├── pkg/database/    # DB connection
└── migrations/      # SQL migrations + seed data
```
