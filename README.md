# Post-it Chaos

A free, self-hosted collaborative whiteboard: sticky notes, shapes, arrows, freehand drawing, images, rich text and
real-time collaboration. Invite guests with a secret link, no account needed. English and German UI.

Post-it Chaos is a fork of [Ourboard](https://github.com/raimohanska/ourboard) (MIT). See `UPSTREAM.md` for what changed.

## Features

- Infinite board with sticky notes, text, rectangles, ellipses, lines, arrows, connectors, frames, images, links and freehand drawing
- Real-time collaboration (WebSocket + Yjs), undo/redo, minimap, zoom
- One admin login (password), board overview with search, archive and thumbnails
- **Guest links**: share a board via a secret link. Guests can add and edit content and delete their own items,
  but cannot delete or change the admin's items, rename boards or create new ones. Guest notes get their own color.
  Links can be renewed or revoked at any time, which ends all guest sessions immediately.
- REST API (`/v2`) and a Python terminal client (`client/`) to fill boards from scripts
- English (default) and German UI

## Quick start with Docker

Requirements: Docker with the compose plugin.

```sh
git clone <this repository> postit-chaos && cd postit-chaos
cp .env.docker.example .env
```

Fill in `.env`:

- `POSTGRES_PASSWORD`: any long random string, e.g. `openssl rand -base64 24`
- `WHITEBOARD_SESSION_SECRET`: at least 32 random characters, e.g. `openssl rand -base64 48`
- `WHITEBOARD_ADMIN_PASSWORD_HASH`: the hash of your admin password (at least 12 characters):

  ```sh
  read -rs PW && printf %s "$PW" | docker run --rm -i -v "$PWD/scripts:/s:ro" node:24-slim node /s/hash-password.mjs
  ```

Then start it:

```sh
docker compose up -d
```

Open http://localhost:1337 and sign in with your password. Database migrations run automatically on start.
Data lives in two Docker volumes (`db` for the database, `assets` for uploaded images); back them up.

**On a server**, put a reverse proxy with HTTPS in front (for example nginx or Traefik) and set `PUBLIC_URL=https://your-domain`.
With an `https://` URL the session cookie is marked Secure.

## Manual install (without Docker)

Requirements: Node 24 (see `.nvmrc`), npm, PostgreSQL 15+.

```sh
psql postgres -c "create role postitchaos login password 'change-me'" -c "create database postitchaos owner postitchaos"
npm ci
npm run build
cd backend
cp .env.example .env      # fill in DATABASE_URL, WHITEBOARD_SESSION_SECRET, WHITEBOARD_ADMIN_PASSWORD_HASH
npm start                 # http://127.0.0.1:1337
```

Create the password hash with `read -rs PW && printf %s "$PW" | node scripts/hash-password.mjs` (prints only the hash).
The server must be started from `backend/`. Development: `npm run watch:frontend` and `npm run dev:backend` in two terminals.

## Configuration

| Variable | Meaning | Default |
|---|---|---|
| `DATABASE_URL` | PostgreSQL connection | must be set |
| `WHITEBOARD_SESSION_SECRET` | Required, at least 32 characters, signs session cookies | none (server does not start) |
| `WHITEBOARD_ADMIN_PASSWORD_HASH` | Hash of the admin password (`scripts/hash-password.mjs`) | none (no login possible) |
| `WHITEBOARD_ADMIN_NAME` | Admin display name on boards | `Admin` |
| `WHITEBOARD_LANGUAGE` | UI language, `en` or `de`; browsers can override with `?lang=de` | `en` |
| `WHITEBOARD_API_TOKEN` | Bearer token for the REST API (`/v2`); API is off without it | empty |
| `PUBLIC_URL` | Public URL; `https://` enables the Secure cookie flag | `http://localhost:1337` |
| `PORT`, `HOST` | HTTP port and bind address | `1337`, `127.0.0.1` (Docker: `0.0.0.0`) |
| `ASSETS_DIR` | Folder for uploaded images | `./localfiles` (Docker: `/data/assets`) |
| `AWS_ASSETS_BUCKET_URL`, `S3_BUCKET`, `S3_REGION` | Store images in S3 instead of a local folder | off |
| `COLLABORATIVE_EDITING` | `true` / `false` / `opt-in`: collaborative rich-text editor | `opt-in` |

## Security model

- Without a valid session only `/login`, guest-link entry `/s/<token>` and static files are reachable; everything else returns 401
  and WebSocket handshakes are rejected.
- Admin session: signed HttpOnly cookie, 7 days. Login attempts are rate-limited. Changing the password ends all admin sessions.
- Guest links: 256-bit random token, stored hashed, separate from the board ID. A guest session is valid for exactly one board.

## REST API and Python client

Set `WHITEBOARD_API_TOKEN` on the server, then use the API under `/v2` with `Authorization: Bearer <token>`
(boards, sticky notes, texts, shapes, frames, images, connectors, freehand drawings).
The Python client in `client/` wraps it for scripts and the terminal (documentation in German):

```sh
cd client && pip install -r requirements.txt
export WHITEBOARD_URL=http://localhost:1337 WHITEBOARD_API_TOKEN=...
./wb board neu "My board"      # creates a board and prints admin link and guest link
```

## Tests

```sh
npm run test:unit -- --no-file-parallelism
DATABASE_URL=postgres://... npm run test:integration -- --no-file-parallelism   # needs PostgreSQL and Chrome
cd client && python3 -m unittest test_wb
bash scripts/prepublish-scan.sh
```

## Deutsch

Post-it Chaos ist ein kostenloses Whiteboard zum Selbst-Hosten, mit Gastlinks ohne Konto. Die Oberfläche gibt es auf Deutsch
mit `WHITEBOARD_LANGUAGE=de` (oder im Browser `?lang=de`). Installation wie oben unter „Quick start with Docker“.

## License

MIT, see `LICENSE.txt`. Based on Ourboard by its contributors. Third-party components: `THIRD_PARTY.md`.
Provided as is, without warranty. You run your own instance and are responsible for it.

"Post-it" is a registered trademark of 3M. This project is not affiliated with or endorsed by 3M.

## Known issues

- `npm audit` reports one moderate issue in quill 1.3.7 (XSS in HTML export, which is not used). Quill 2 is not compatible with `y-quill`.
