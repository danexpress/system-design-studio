.DEFAULT_GOAL := help

UV ?= uv
BACKEND_DIR := backend
HOST ?= 127.0.0.1
PORT ?= 8000

.PHONY: help sync run test format lint check

help:
	@printf '%s\n' \
		'make sync    Install and lock backend dependencies' \
		'make run     Start the backend with auto-reload' \
		'make test    Run the backend test suite' \
		'make format  Format backend Python code' \
		'make lint    Check backend formatting and lint rules' \
		'make check   Run lint and tests'

sync:
	cd $(BACKEND_DIR) && $(UV) sync

run:
	cd $(BACKEND_DIR) && $(UV) run uvicorn app.main:app --reload --host $(HOST) --port $(PORT)

test:
	cd $(BACKEND_DIR) && $(UV) run pytest

format:
	cd $(BACKEND_DIR) && $(UV) run ruff format app tests
	cd $(BACKEND_DIR) && $(UV) run ruff check --fix app tests

lint:
	cd $(BACKEND_DIR) && $(UV) run ruff format --check app tests
	cd $(BACKEND_DIR) && $(UV) run ruff check app tests

check: lint test
