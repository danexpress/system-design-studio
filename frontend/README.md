# System Design Studio

See the [product specification](../docs/spec.md) for the application requirements.

This project was built with [Lovable](https://lovable.dev).

## Build with Lovable

Continue developing this project in the [Lovable editor](https://lovable.dev/projects/c9ef66c3-435e-4ec7-9d62-f2182555444d).

- **Ship faster**: describe what you want to build and Lovable handles the code.
- **Stay in sync**: every change made in Lovable is committed straight to this repository.
- **Full ownership**: this code is yours. Push to `main` on GitHub and your changes sync back into Lovable, ready for your next prompt.

## Development

Prefer working locally? You need Node.js and npm — [install with nvm](https://github.com/nvm-sh/nvm#installing-and-updating).

```sh
git clone <this-repository-url>
cd <repository-name>
npm i
npm run dev
```

The frontend uses the FastAPI service at `http://127.0.0.1:8000/api` by default.
From the repository root, `make dev` starts both applications. See
`.env.example` to override the API URL or development accounts.

For the current seeded-data workflow, the API client automatically exchanges
the configured interviewer or candidate credentials for a bearer token. This
keeps the existing role-based demo flows working until a user-facing sign-in
screen is added; production credentials must never be placed in `VITE_*`
variables because those values are included in the browser bundle.
