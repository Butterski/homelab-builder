.PHONY: help up down test test-backend test-frontend clean

help:
	@echo "Available commands:"
	@echo "  make up             - Build and start the whole stack (docker-compose.yml)"
	@echo "  make down           - Stop the stack"
	@echo "  make test           - Run all tests (backend + frontend) in Docker"
	@echo "  make test-backend   - Run all backend Go tests in Docker (PostgreSQL + hlbIPAM)"
	@echo "  make test-frontend  - Type-check and run the Vitest suite in a Node container"
	@echo "  make clean          - Stop the stack and delete its volumes"

up:
	docker compose up -d --build

down:
	docker compose down

test: test-backend test-frontend

# Starts a throwaway PostgreSQL and hlbIPAM, then runs `go test ./...` for the
# backend in a container. This is the same compose file CI uses.
test-backend:
	docker compose -f docker-compose.test.yml up --build --abort-on-container-exit --exit-code-from backend-test; \
	status=$$?; docker compose -f docker-compose.test.yml down; exit $$status

# node_modules lives in a named volume, so nothing is installed on the host.
test-frontend:
	docker run --rm -v "$(CURDIR):/repo" -v hlb-frontend-node-modules:/repo/frontend/node_modules -w /repo/frontend \
		node:22-alpine sh -c "npm ci --legacy-peer-deps && npx tsc -b && npx vitest run"

clean:
	docker compose down -v
