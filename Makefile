.DEFAULT_GOAL := help

UV ?= uv
BACKEND_DIR := backend
FRONTEND_DIR := frontend
HOST ?= 127.0.0.1
PORT ?= 8000
DATABASE_URL ?= sqlite:////data/system_design_studio.db
INTEGRATION_PORT ?= 18083
INTEGRATION_COMPOSE_PROJECT ?= system-design-studio-integration
E2E_PORT ?= 18084
E2E_COMPOSE_PROJECT ?= system-design-studio-e2e
AWS_DEV_STACK ?= system-design-studio
AWS_PRODUCTION_STACK ?= system-design-studio-production

.PHONY: help sync run frontend dev test frontend-test frontend-build format lint check integration-test e2e-install e2e-test aws-deploy aws-deploy-dev aws-deploy-production aws-promote-production docker-build docker-run compose-up compose-down compose-logs

help:
	@printf '%s\n' \
		'make sync    Install and lock backend dependencies' \
		'make run     Start the backend with auto-reload' \
		'make frontend Start the frontend development server' \
		'make dev     Start the backend and frontend together' \
		'make test    Run the backend test suite' \
		'make frontend-test Run frontend unit tests' \
		'make frontend-build Build the production frontend' \
		'make integration-test Test the isolated Compose stack' \
		'make e2e-install Install Playwright and Chromium' \
		'make e2e-test Run browser tests against isolated Compose stack' \
		'make aws-deploy-dev Deploy the development AWS environment' \
		'make aws-deploy-production Deploy the production AWS environment' \
		'make aws-promote-production Promote the deployed dev image to production' \
		'make docker-build Build the full-stack container image' \
		'make docker-run Run the full-stack container on PORT' \
		'make compose-up Start the app and PostgreSQL' \
		'make compose-down Stop the Compose stack' \
		'make compose-logs Follow Compose service logs' \
		'make format  Format backend Python code' \
		'make lint    Check backend formatting and lint rules' \
		'make check   Run lint and tests'

sync:
	cd $(BACKEND_DIR) && $(UV) sync

run:
	cd $(BACKEND_DIR) && $(UV) run uvicorn app.main:app --reload --host $(HOST) --port $(PORT)

frontend:
	cd $(FRONTEND_DIR) && npm run dev

dev:
	$(MAKE) -j2 run frontend

test:
	cd $(BACKEND_DIR) && $(UV) run pytest

frontend-test:
	cd $(FRONTEND_DIR) && npm test -- --run

frontend-build:
	cd $(FRONTEND_DIR) && npm run build
	cd $(FRONTEND_DIR) && npm run build:static

docker-build:
	docker build -t system-design-studio .

docker-run:
	docker run --rm -p $(PORT):8000 -e DATABASE_URL="$(DATABASE_URL)" -v system-design-studio-data:/data system-design-studio

compose-up:
	docker compose up --build -d

compose-down:
	docker compose down

compose-logs:
	docker compose logs -f

integration-test:
	@set -eu; \
	project="$(INTEGRATION_COMPOSE_PROJECT)"; \
	cleanup() { \
		status=$$?; \
		trap - EXIT INT TERM; \
		if [ $$status -ne 0 ]; then docker compose -f "$(CURDIR)/docker-compose.yaml" -p "$$project" logs; fi; \
		docker compose -f "$(CURDIR)/docker-compose.yaml" -p "$$project" down -v; \
		exit $$status; \
	}; \
	trap cleanup EXIT INT TERM; \
	PORT="$(INTEGRATION_PORT)" \
	POSTGRES_PASSWORD=integration-password \
	JWT_SECRET=integration-secret-with-more-than-thirty-two-characters \
		docker compose -f "$(CURDIR)/docker-compose.yaml" -p "$$project" up --build -d --wait --wait-timeout 120; \
	cd "$(BACKEND_DIR)"; \
	INTEGRATION_BASE_URL="http://127.0.0.1:$(INTEGRATION_PORT)" \
	INTEGRATION_COMPOSE_PROJECT="$$project" \
		$(UV) run pytest integration_tests -m integration

e2e-install:
	cd e2e && npm install
	cd e2e && npm run install-browser

e2e-test:
	@set -eu; \
	project="$(E2E_COMPOSE_PROJECT)"; \
	cleanup() { \
		status=$$?; \
		trap - EXIT INT TERM; \
		if [ $$status -ne 0 ]; then docker compose -f "$(CURDIR)/docker-compose.yaml" -p "$$project" logs; fi; \
		docker compose -f "$(CURDIR)/docker-compose.yaml" -p "$$project" down -v; \
		exit $$status; \
	}; \
	trap cleanup EXIT INT TERM; \
	PORT="$(E2E_PORT)" \
	POSTGRES_PASSWORD=e2e-password \
	JWT_SECRET=e2e-secret-with-more-than-thirty-two-characters \
		docker compose -f "$(CURDIR)/docker-compose.yaml" -p "$$project" up --build -d --wait --wait-timeout 120; \
	cd e2e; \
	E2E_BASE_URL="http://127.0.0.1:$(E2E_PORT)" npm test

aws-deploy: aws-deploy-dev

aws-deploy-dev:
	STACK_NAME="$(AWS_DEV_STACK)" DEPLOY_ENVIRONMENT=development bash infra/deploy.sh

aws-deploy-production:
	STACK_NAME="$(AWS_PRODUCTION_STACK)" DEPLOY_ENVIRONMENT=production bash infra/deploy.sh

aws-promote-production:
	DEV_STACK_NAME="$(AWS_DEV_STACK)" PRODUCTION_STACK_NAME="$(AWS_PRODUCTION_STACK)" bash infra/promote.sh

format:
	cd $(BACKEND_DIR) && $(UV) run ruff format app tests integration_tests
	cd $(BACKEND_DIR) && $(UV) run ruff check --fix app tests integration_tests

lint:
	cd $(BACKEND_DIR) && $(UV) run ruff format --check app tests integration_tests
	cd $(BACKEND_DIR) && $(UV) run ruff check app tests integration_tests

check: lint test frontend-test frontend-build
