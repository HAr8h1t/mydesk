# MyDesk Sync API

The API is optional. MyDesk continues to read and write each device's local
SQLite database when the server is unavailable or the user is signed out.

## Requirements

- Node.js 20 or later
- PostgreSQL 14 or later
- A TLS-terminated HTTPS endpoint for non-local deployments

## Configure and run

Install the server dependencies and provide a PostgreSQL connection string and
a private JWT signing secret of at least 32 bytes:

```powershell
npm install --prefix server
$env:DATABASE_URL = "postgresql://mydesk:password@localhost:5432/mydesk"
$env:JWT_SECRET = "<generate-a-private-random-secret-of-at-least-32-bytes>"
npm run server
```

The API applies the versioned SQL migration at startup. Keep PostgreSQL backups
and rotate the JWT secret only with a planned session invalidation. Optional
settings are `HOST`, `PORT`, `PG_POOL_SIZE`, `PGSSLMODE`, and `CORS_ORIGINS`.
For production, configure `PGSSLMODE=require`, use a secret manager for
credentials, and set `CORS_ORIGINS` to the exact web origins that need access.
Electron requests use the main process and do not require browser CORS.

In MyDesk Settings, enter the HTTPS API URL, then create an account or sign in.
The desktop stores credentials with Electron `safeStorage`; Android stores
credentials through Android Keystore-backed encrypted storage. Access tokens
are short-lived, refresh tokens rotate, and the server stores only a hash of
each refresh token. Logging out leaves local records and queued changes on the
device.

## API behavior

- `POST /v1/auth/register`, `/login`, `/refresh`, and `/logout`
- `POST /v1/devices`
- `POST /v1/sync/push` uses stable operation IDs and base server revisions
- `GET /v1/sync/pull` returns account-scoped change pages and a durable cursor

All synchronized records are isolated by authenticated user ID. Concurrent
updates with a stale revision return a conflict rather than silently replacing
newer server data. The local queue retains failed operations and retries with
backoff. Active focus timers and device-specific notification state are not
shared. Attachment files remain device-local: task and note attachment
contents and metadata are excluded from sync rather than uploading local paths
or large embedded files.

The client synchronizes while running and retries on reconnect or resume.
Android OS-managed periodic work after the app is closed is not currently
implemented; do not treat the current foreground scheduler as guaranteed
background delivery.

## Validation

Run `npm test --prefix server` for API validation, password-hashing, and token
tests. A PostgreSQL instance is required for end-to-end migration and API
integration tests; these unit tests do not substitute for deploying and
verifying that service against the target database.
