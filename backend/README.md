# System Design Studio backend

The API is a FastAPI and SQLAlchemy implementation of the repository's
`openapi.yaml` contract. It uses SQLite by default and persists data across
process restarts.

## Development

```sh
uv sync
uv run uvicorn app.main:app --reload
uv run pytest
```

The database connection is configured with `DATABASE_URL`:

```sh
DATABASE_URL=sqlite:///./local.db uv run uvicorn app.main:app --reload
```

If the variable is omitted, the server uses
`sqlite:///./system_design_studio.db`. Engine creation and persistence are
isolated in `app/database.py`; the store and routers contain no SQLite-specific
queries.

PostgreSQL is supported through Psycopg 3:

```sh
DATABASE_URL=postgresql+psycopg://studio:password@localhost:5432/studio make run
```

The common `postgres://` and `postgresql://` URL forms supplied by hosting
providers are normalized to the Psycopg 3 dialect automatically. The database
must already exist; the backend creates its tables and seed records on first
startup.

Browser origins outside local development can be allowed with a comma-separated
`CORS_ORIGINS` value. Localhost and `127.0.0.1` are accepted on any port by
default:

```sh
CORS_ORIGINS=https://studio.example.com,https://preview.example.com make run
```

The schema and demo records are created only when the database is empty, so
restarting the app does not overwrite existing sessions or password hashes.

## Container

The repository Dockerfile builds the frontend as a static SPA, installs the
backend with `uv`, and copies the frontend output into the final Python image.
FastAPI serves both the `/api` endpoints and frontend routes from one origin.

```sh
make docker-build
make docker-run
```

Open `http://localhost:8000`. The named Docker volume preserves the SQLite
database between container runs.

To run the app with PostgreSQL, use the Compose stack:

```sh
make compose-up
make compose-logs
```

Open `http://localhost:8000`, then stop the services with `make compose-down`.
The `postgres-data` volume preserves database records. `POSTGRES_DB`,
`POSTGRES_USER`, `POSTGRES_PASSWORD`, `JWT_SECRET`, and `PORT` can be overridden
through environment variables or a root `.env` file.

## Compose integration tests

Run the black-box suite against an isolated Compose project:

```sh
make integration-test
```

The target builds and starts both services, waits for their health checks, runs
the tests over HTTP, and removes its containers, network, and test volume. On a
failure it prints the Compose logs before cleanup. The suite covers:

- container health, frontend assets, and SPA fallback routing;
- valid and invalid authentication plus role authorization;
- PostgreSQL seed data;
- session creation, invite links, start/end lifecycle, and revocation;
- candidate canvas editing and interviewer locks;
- realtime SSE delivery after a mutation;
- PostgreSQL persistence across an app-container restart.

The seeded development accounts are:

- Interviewer: `interviewer@example.com` / `interviewer-password`
- Candidate: `candidate@example.com` / `candidate-password`

Exchange credentials at `POST /api/auth/token`, then send the returned token as
`Authorization: Bearer <token>`.
