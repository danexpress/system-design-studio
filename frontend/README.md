# System Design Studio

Create the System Design Interview Platform MVP described by the user. Build a polished browser-based clickable application covering the interviewer dashboard, create-session form, candidate lobby, live shared system-design canvas, and ended-session review. Implement the key UI flows and role/permission states (share/revoke link, participant presence, candidate editing lock, start/end, reconnect indicator, autosave feedback). Use a robust system-design canvas experience with palette components, connectors, notes/text, drawing affordances, pan/zoom and selection interactions as feasible. Centralize every backend call in a single services layer and provide a mock implementation so the app works fully without a real backend. Add meaningful tests for core service and workflow behavior. Favor desktop-first professional UX, accessible controls, responsive support UI, and seeded demo data.

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
