# Database migrations

`migrations/` is the canonical, append-only schema history for Private Family OS.

- `0001_core.sql` defines household/profile/space/asset/agent/consent/audit boundaries and RLS.
- `0002_ingestion.sql` adds opt-in source connections, idempotent ingestion jobs and the transactional outbox.

## Runtime rules

- The migration role owns schema changes but is never used by the API.
- The API uses a dedicated, non-owner runtime role with `NOBYPASSRLS`.
- Each authenticated API transaction sets `SET LOCAL app.user_id = '<UUID>'` before querying user data.
- Background workers use a separate role and must receive a server-created execution envelope containing only the agent's approved scopes.
- Migration files are never edited after an environment has applied them. Add a new migration instead.

## Required CI checks

1. Apply all migrations to a fresh PostgreSQL 16 database.
2. Apply all migrations to a database at the previous schema version.
3. Run role/RLS integration tests for private adult vaults, Family Space, child guardians, revoked grants and AI-proposal visibility.
4. Run `pg_restore` against a backup fixture to validate restore procedures.

## Security note

The baseline schema creates tables and policies; deployment must also create narrowly scoped database roles and revoke default public privileges. RLS protects only when the application does not connect as a table owner or `BYPASSRLS` role.
