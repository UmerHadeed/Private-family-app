# API service

This service is the first production-facing application boundary. It deliberately does **not** contain a real AI provider, a real database credential or live S3 configuration yet.

## Current working behaviour

- `GET /healthz` and `GET /readyz`
- `POST /v1/assets/upload-intents`
  - validates the payload
  - authenticates an injected principal
  - requires both household membership and explicit space membership
  - creates an object-storage upload intent
  - registers an asset record through a tenant database interface
  - writes an audit event

The included test adapters are in-memory only. `DevelopmentHeaderAuthenticator` accepts `x-development-user-id` only outside production so the API can be exercised before an OIDC provider exists.

## Production adapter requirements

Replace development adapters before staging with:

1. OIDC JWT verifier using issuer, audience, JWKS rotation and expiry checks.
2. PostgreSQL adapter that runs each tenant query in a transaction with `SET LOCAL app.user_id` before any query.
3. Private S3 adapter that creates short-lived signed URLs and binds MIME type, size and checksum requirements.
4. AWS SQS outbox publisher for post-upload ingestion.
5. Audit sink that appends to `app.audit_events` and excludes raw private content from logs.

## Run locally

```bash
npm install
npm run test --workspace=@private-family-os/api
npm run typecheck --workspace=@private-family-os/api
npm run dev --workspace=@private-family-os/api
```

A production process refuses development-header authentication by design.
