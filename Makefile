.DEFAULT_GOAL := help

UV ?= uv
BACKEND_DIR := backend
FRONTEND_DIR := frontend
HOST ?= 127.0.0.1
PORT ?= 8000
DATABASE_URL ?= sqlite:////data/system_design_studio.db

.PHONY: help sync run frontend dev test frontend-test frontend-build format lint check docker-build docker-run compose-up compose-down compose-logs

help:
	@printf '%s\n' \
		'make sync    Install and lock backend dependencies' \
		'make run     Start the backend with auto-reload' \
		'make frontend Start the frontend development server' \
		'make dev     Start the backend and frontend together' \
		'make test    Run the backend test suite' \
		'make frontend-test Run frontend unit tests' \
		'make frontend-build Build the production frontend' \
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

format:
	cd $(BACKEND_DIR) && $(UV) run ruff format app tests
	cd $(BACKEND_DIR) && $(UV) run ruff check --fix app tests

lint:
	cd $(BACKEND_DIR) && $(UV) run ruff format --check app tests
	cd $(BACKEND_DIR) && $(UV) run ruff check app tests

check: lint test frontend-test frontend-build
