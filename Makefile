.PHONY: help setup up down test test-backend test-frontend lint build clean

help:
	@echo "Available commands:"
	@echo "  make setup          - Start all services"
	@echo "  make up             - Start Docker Compose services"
	@echo "  make down           - Stop Docker Compose services"
	@echo "  make test           - Run all tests (backend + frontend)"
	@echo "  make test-backend   - Run all backend Go tests in Docker (PostgreSQL + hlbIPAM)"
	@echo "  make test-frontend  - Run Vitest frontend tests locally (no backend needed)"
	@echo "  make lint           - Run linters"
	@echo "  make build          - Build the application"
	@echo "  make clean          - Clean up containers and volumes"

setup:
	docker compose up -d --build

up:
	docker compose up -d --build

down:
	docker compose down

# Run all tests
test: test-backend test-frontend

# Starts a throwaway PostgreSQL and hlbIPAM, then runs `go test ./...` for the
# backend in a container. This is the same compose file CI uses.
test-backend:
	docker compose -f docker-compose.test.yml up --build --abort-on-container-exit --exit-code-from backend-test; \
	status=$$?; docker compose -f docker-compose.test.yml down; exit $$status

# Frontend Vitest tests run locally. buildApi is fully mocked - no backend needed.
test-frontend:
	@echo "Running frontend tests..."
	cd frontend && npm test

lint:
	@echo "Running linters..."
	# Add lint commands here

build:
	@echo "Building application..."
	# Add build commands here

clean:
	docker compose down -v