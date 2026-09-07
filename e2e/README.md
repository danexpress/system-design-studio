# End-to-end tests

The Playwright test runs the full interviewer/candidate collaboration flow against
the app and PostgreSQL services from `docker-compose.yaml`.

Install Playwright once, then run the isolated stack and test:

```sh
make e2e-install
make e2e-test
```

The Make target builds the app, starts a separate Compose project, waits for both
services to become healthy, and removes its containers, network, and database
volume after the run. Compose logs and Playwright traces are retained on failure.
