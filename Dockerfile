# syntax=docker/dockerfile:1

FROM node:22-bookworm-slim AS frontend-build

WORKDIR /build/frontend
COPY frontend/package.json ./
RUN npm install --legacy-peer-deps --package-lock=false
COPY frontend/ ./
ARG VITE_API_BASE_URL=/api
ENV VITE_API_BASE_URL=$VITE_API_BASE_URL
RUN npm run build:static


FROM python:3.13-slim AS runtime

COPY --from=ghcr.io/astral-sh/uv:0.9.5 /uv /uvx /bin/

ENV PYTHONUNBUFFERED=1 \
    UV_COMPILE_BYTECODE=1 \
    UV_LINK_MODE=copy \
    PATH=/app/backend/.venv/bin:$PATH \
    DATABASE_URL=sqlite:////data/system_design_studio.db \
    FRONTEND_DIST_DIR=/app/frontend

WORKDIR /app/backend
COPY backend/pyproject.toml backend/uv.lock ./
RUN uv sync --locked --no-dev --no-install-project
COPY backend/app ./app
COPY --from=frontend-build /build/frontend/dist /app/frontend

RUN useradd --create-home appuser \
    && mkdir -p /data \
    && chown appuser:appuser /data

USER appuser
VOLUME ["/data"]
EXPOSE 8000

HEALTHCHECK --interval=30s --timeout=3s --start-period=10s --retries=3 \
    CMD ["python", "-c", "import urllib.request; urllib.request.urlopen('http://127.0.0.1:8000/api/openapi.json', timeout=2)"]

CMD ["uvicorn", "app.main:app", "--host", "0.0.0.0", "--port", "8000"]
