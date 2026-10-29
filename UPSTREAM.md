# Upstream

Base: Ourboard, https://github.com/raimohanska/ourboard (MIT, see `LICENSE.txt`),
taken from commit `b0a194724d94def0f60aa8b7555b70520093fba8` (branch main), without git history.

Removed: Playwright/Cypress E2E setup, Keycloak, Google/OIDC login, the old open `/api/v1`, external image proxy,
husky/lint-staged, perf-tester, benchmark, uWebSockets server.

Changed: npm workspaces instead of yarn, current dependencies, AWS SDK v3, bundler updates (esbuild, sass),
server binds to 127.0.0.1 by default, `ASSETS_DIR`, hardened asset upload paths.

Added: password login for one admin, guest links per board with permission rules, board overview with archive and
thumbnails, REST API `/v2` with bearer token, Python client, new toolbar and styling, freehand drawing, English/German UI,
Docker setup, integration tests against PostgreSQL and Chrome.
