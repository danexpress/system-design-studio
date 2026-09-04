# System Design Studio backend

The API is an in-memory FastAPI implementation of the repository's
`openapi.yaml` contract. Data resets whenever the process restarts.

## Development

```sh
uv sync
uv run uvicorn app.main:app --reload
uv run pytest
```

The seeded development accounts are:

- Interviewer: `interviewer@example.com` / `interviewer-password`
- Candidate: `candidate@example.com` / `candidate-password`

Exchange credentials at `POST /api/auth/token`, then send the returned token as
`Authorization: Bearer <token>`.
