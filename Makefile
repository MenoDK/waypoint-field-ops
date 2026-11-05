.DEFAULT_GOAL := help
SHELL := /bin/bash
COMPOSE := docker compose
# The browser container runs as you, so what it writes (node_modules, screenshots) is yours to delete.
E2E_USER := --user $$(id -u):$$(id -g) -e HOME=/tmp

.PHONY: help env demo down reset logs install lint typecheck site-syntax test test-e2e db check mutate transcripts e2e screenshots

help: ## list the targets
	@grep -E '^[a-z0-9-]+:.*##' $(MAKEFILE_LIST) | awk -F':.*## ' '{printf "  %-12s %s\n", $$1, $$2}'

env: ## write .env with fresh random secrets (never overwrites an existing one)
	@if [ -f .env ]; then echo ".env already exists, leaving it alone"; else \
	  { echo "DB_PASSWORD=$$(openssl rand -hex 16)"; echo "APP_DB_PASSWORD=$$(openssl rand -hex 16)"; \
	    echo "JWT_SECRET=$$(openssl rand -hex 32)"; echo "SIGNED_URL_SECRET=$$(openssl rand -hex 32)"; \
	    echo "DEMO_PASSWORD=$$(openssl rand -hex 12)"; echo "METRICS_TOKEN="; } > .env; \
	  echo "wrote .env with fresh random secrets"; fi

demo: env ## build and start PostgreSQL/PostGIS, the API, the worker and the simulated field (http://localhost:8400)
	$(COMPOSE) up --build --wait -d
	@echo; echo "  the system:   http://localhost:8400   (the live map starts moving by itself)"; echo "  stop with:    make down"

down: ## stop everything and keep the data
	$(COMPOSE) down

reset: ## stop everything and delete the database
	$(COMPOSE) down -v

logs: ## follow the logs
	$(COMPOSE) logs -f api worker field

install: ## install dependencies for local development
	pnpm install --frozen-lockfile

lint: ## eslint and prettier
	pnpm lint && pnpm format:check

typecheck: ## tsc --strict
	pnpm typecheck

site-syntax: ## syntax-check every script the site ships
	pnpm site-syntax

test: ## unit tests (no database needed)
	pnpm test

db: ## a throwaway PostGIS on 127.0.0.1:15450 for the e2e tests
	docker compose -p waypoint-dev -f compose.dev.yml up -d --wait

test-e2e: db ## the API against a real PostGIS (the tests migrate it themselves)
	pnpm test:e2e

check: lint typecheck site-syntax test test-e2e ## lint, types, formatting, unit tests and the database tests (needs Docker for the PostGIS)
	pnpm format:check

mutate: db ## break each critical rule on purpose and confirm a test notices (rewrites sources in place: touch nothing meanwhile)
	node scripts/mutation-check.mjs

transcripts: db ## re-record the guided tour on the landing page from the running code
	RECORD=1 pnpm exec jest --selectProjects e2e --runInBand test/transcripts.e2e-spec.ts

e2e: env ## browser tests (Playwright + axe) against the Compose stack
	$(COMPOSE) up --build --wait -d
	$(COMPOSE) --profile e2e run --rm $(E2E_USER) e2e

screenshots: env ## re-take the README screenshots (docs/img) from the running stack
	@mkdir -p docs/img
	$(COMPOSE) up --build --wait -d
	$(COMPOSE) --profile e2e run --rm $(E2E_USER) -e SHOTS=1 e2e bash -lc "npm ci --no-audit --no-fund && npx playwright test shots"
