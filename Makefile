.PHONY: help setup up down test test-backend test-frontend lint build clean

help:
	@echo "Available commands:"
	@echo "  make setup          - Start all services"
	@echo "  make up             - Start Docker Compose services"
	@echo "  make down           - Stop Docker Compose services"
	@echo "  make test           - Run all tests (backend + frontend)"
	@echo "  make test-backend   - Run Go service tests against the postgres container"
	@echo "  make test-frontend  - Run Vitest frontend tests locally (no backend needed)"
	@echo "  make lint           - Run linters"
	@echo "  make build          - Build the application"
	@echo "  make clean          - Clean up containers and volumes"

setup:
	docker compose up -d

up:
	docker compose up -d

down:
	docker compose down

# Run all tests
test: test-backend test-frontend

# Build the Go builder stage (has toolchain + source) and run tests in a
# temporary container on the same Docker network as the running postgres service.
# Requires: docker compose up (postgres container must be healthy).
test-backend:
	@echo "Building test runner image from builder stage..."
	docker build --target builder -t homelab-builder-test-runner ./backend
	@echo "Running backend tests against postgres..."
	docker run --rm \
		--network homelab-builder_default \
		-e DB_HOST=postgres \
		-e DB_PORT=5432 \
		-e DB_USER=homelab \
		-e DB_PASSWORD=homelab_password \
		-e DB_SSLMODE=disable \
		-e TEST_DB_NAME=homelab_builder_test \
		homelab-builder-test-runner \
		go test ./internal/services/... -v -count=1

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