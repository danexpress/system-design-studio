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
queries. A future PostgreSQL deployment can use a SQLAlchemy PostgreSQL URL once
the corresponding database driver is installed.

Browser origins outside local development can be allowed with a comma-separated
`CORS_ORIGINS` value. Localhost and `127.0.0.1` are accepted on any port by
default:

```sh
CORS_ORIGINS=https://studio.example.com,https://preview.example.com make run
```

The schema and demo records are created only when the database is empty, so
restarting the app does not overwrite existing sessions or password hashes.

The seeded development accounts are:

- Interviewer: `interviewer@example.com` / `interviewer-password`
- Candidate: `candidate@example.com` / `candidate-password`

Exchange credentials at `POST /api/auth/token`, then send the returned token as
`Authorization: Bearer <token>`.
