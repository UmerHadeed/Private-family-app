# Private Family OS — Phase 2 Production Foundation

**Status:** Proposed implementation baseline  
**Purpose:** Turn the current UI prototype into a secure, local-first family platform without compromising the privacy promise.

## 1. Non-negotiable product principles

1. **Local-first:** the mobile app retains an encrypted local cache and remains useful offline.
2. **Explicit consent:** an agent can access only the sources, profiles and spaces explicitly granted to it.
3. **No inherited household access:** inviting a spouse never exposes either adult's private vault. A shared family space is a separate permission boundary.
4. **Source-grounded AI:** every AI-created caption, tag, summary, reminder or answer must point to source assets and record how it was produced.
5. **Privacy before automation:** automatic filing is opt-in, reversible and has a clear audit trail.
6. **Export and deletion:** users can export their content and delete it; deletion requests propagate to derived AI records and search indexes.
7. **No secrets in clients:** API keys, model credentials, encryption root keys and privileged database access remain server-side.

## 2. Recommended production baseline

This is the recommended architecture for the U.S. MVP. It uses mature managed services, standard protocols and portable data models.

| Concern | Recommendation | Why |
|---|---|---|
| Client applications | Native iOS (Swift) and Android (Kotlin), shared API contract | Required for reliable Photos, Files, Calendar, notification and background-job permissions. The current React app remains the product prototype and admin/web surface. |
| API | TypeScript service using Fastify or NestJS, REST/OpenAPI first | Typed contracts, mobile-friendly, easily testable. |
| Core database | PostgreSQL 16+ | Strong transactions, JSON support, full-text search, mature migrations, row-level security and broad portability. |
| Database access | Prisma or Drizzle for application queries; versioned SQL migrations for security policies | Developer productivity without hiding security-critical SQL. |
| Authorization | PostgreSQL row-level security (RLS) plus application-layer authorization | Database remains a final enforcement layer even if an API route is misconfigured. |
| Authentication | OIDC provider with passkeys, email/password and MFA; short-lived tokens | Avoid custom authentication. Support secure account recovery later. |
| Object storage | Private S3-compatible storage with per-object encryption and short-lived signed upload/download URLs | Correct place for original photos, videos, voice notes and documents. PostgreSQL stores metadata, not large binaries. |
| Background work | Managed queue plus idempotent workers | Transcription, OCR, image analysis, embeddings and reminder delivery must not run during the upload request. |
| Search / retrieval | PostgreSQL full-text search + pgvector initially | Keeps early search and embeddings close to permissioned data; separate search infrastructure only when scale requires it. |
| Key management | Cloud KMS plus per-household data-encryption keys (envelope encryption) | Supports encrypted backups and key rotation without storing raw key material in the app database. |
| Observability | Structured logs, error monitoring, traces and security audit events | Required for production incidents, access investigations and reliable operations. |

## 3. Trust boundaries

```text
Native mobile app
  ├─ encrypted local database / local media cache
  ├─ OS permission prompts: Photos, Files, Calendar, Microphone, Notifications
  └─ authenticated API calls

API / authorization layer
  ├─ validates identity, household membership and grants
  ├─ creates signed object-storage uploads
  ├─ writes immutable audit events
  └─ enqueues ingestion jobs

Private data layer
  ├─ PostgreSQL: metadata, permissions, timeline, consent, audit references
  ├─ Object storage: encrypted original media and documents
  └─ KMS: protected encryption keys

AI worker boundary
  ├─ receives only the minimum approved asset and scope
  ├─ creates derived metadata: transcript, OCR, caption, tags, embeddings
  ├─ writes provenance and confidence scores
  └─ never changes sharing/ownership without a policy-approved action
```

## 4. Data classification

| Classification | Examples | Storage and handling rule |
|---|---|---|
| Restricted | Original photos, video, voice notes, medical documents, private journals | Encrypt at rest; no public URLs; signed access only; least-privilege service access. |
| Sensitive metadata | Person tags, family relationships, locations, facial embeddings, reminders | Encrypt at rest; RLS; access logging; minimised AI-worker access. |
| Operational | Agent job status, retries, non-sensitive app configuration | Tenant-scoped; do not include raw user content in logs. |
| Security | Audit events, grant decisions, authentication events | Append-only policy; restricted internal access; retention policy. |

**Important:** facial reference embeddings and face-match results are sensitive biometric-derived data. They must be opt-in, segregated by household/profile, encrypted, never used for public model training, and deletable with the source reference.

## 5. Core database model

The database should use UUID primary keys, UTC timestamps, `created_at` / `updated_at`, soft deletion where recovery is needed, and immutable audit records. Every tenant-owned row carries `household_id`.

### Identity and household

- `users` — authenticated adults.
- `households` — security/ownership boundary for a family unit.
- `household_members` — user membership, role (`owner`, `adult_member`, `viewer`) and status.
- `profiles` — personal, partner, child or dependent profile. A profile has an owner model and a lifecycle state.
- `profile_guardians` — parent/guardian administrative rights for child profiles.
- `spaces` — containers: private vault, family space, child profile space, or explicitly shared space.
- `space_memberships` — explicit role-based membership in each space.

### Content and family memory

- `assets` — metadata for an original photo, video, audio recording, document or note.
- `asset_versions` — immutable versions/originals and derived renditions.
- `asset_people` — suggested/confirmed person tags, confidence, source and reviewer.
- `memories` — curated timeline records built from one or more assets.
- `memory_assets` — asset-to-memory links.
- `timeline_entries` — display and chronology records, including user-entered date precision.
- `reminders` — user-created or AI-proposed reminder schedules with delivery state.
- `conversations`, `messages`, `message_assets` — Family Space content and references.

### AI, consent and provenance

- `agents` — purpose, model route, autonomy level and state.
- `agent_scope_grants` — explicit many-to-many grant: agent → space/profile/source capability.
- `source_connections` — device source connection and permission status; never store OS tokens in plaintext.
- `ingestion_jobs` — idempotent work units for upload, transcription, OCR, captioning, face-match proposal and embedding generation.
- `ai_derivations` — transcript, OCR, caption, summary, classification or embedding metadata linked to its source asset and model/version.
- `ai_proposals` — proposed filing, people tags, memory creation and reminders; includes confidence and review status.
- `face_reference_sets` — opt-in references for a single profile; encrypted and versioned.
- `consents` — versioned record of user approval for sensitive processing and automatic filing.

### Security and operations

- `audit_events` — immutable append-only events: read, share, export, grant, revoke, agent action, download and deletion.
- `outbox_events` — transactional event outbox for reliable worker handoff.
- `deletion_requests` — deletion/export workflow and completion status.
- `device_sessions` — registered client devices, encrypted sync state and revocation status.

## 6. Required access-control rules

1. Every API request resolves an authenticated `user_id`, selected `household_id` and permitted `space_ids`.
2. RLS policies prevent a user from reading an asset unless they are an explicit member of its space or a guardian of the applicable child profile.
3. `agent_scope_grants` are additive, not hierarchical. An agent must have every required grant; it does not inherit a user or household owner’s permissions.
4. Private adult spaces can never be traversed by Family AI unless the adult explicitly grants that exact agent and source capability.
5. A child profile is parent-managed by default; ownership transfer is a controlled workflow with an audit event, guardian-policy checks and revocation of former access where appropriate.
6. AI may create only `ai_proposals` by default. It may auto-file only where a current consent record authorizes a specific action, profile and confidence threshold.
7. Every download, AI processing action, share change and export produces an audit event.

## 7. AI ingestion and filing pipeline

1. **Capture:** app receives an item from the user or an approved device source.
2. **Encrypt and upload:** client encrypts where supported; backend creates a short-lived signed upload URL; object metadata never exposes a public file URL.
3. **Register:** API creates `asset`, `asset_version`, provenance record and `ingestion_job` in one transaction using the outbox pattern.
4. **Process asynchronously:** worker performs allowed processing (transcription, OCR, thumbnailing, captioning, embeddings).
5. **Propose:** worker writes an `ai_proposal` for person tags, date, short reference description, timeline placement and reminder—not a silent ownership or sharing change.
6. **Decide:** user accepts, edits or rejects a proposal. If a consented automatic rule applies, a policy engine verifies scope, profile, confidence and action type before filing.
7. **Record:** asset/memory/timeline changes, AI derivation and decision are all source-linked and audited.

## 8. Initial database standards

- PostgreSQL migrations are immutable, versioned and executed in CI against an empty database and a migration-upgrade fixture.
- No direct production SQL changes outside migrations.
- Foreign keys on every relationship; explicit cascade behavior chosen per relation.
- Check constraints for role, state, asset type and confidence range.
- Unique idempotency keys for uploads, background jobs and external notifications.
- Paginate every list API with cursor-based pagination.
- API schemas use OpenAPI and request/response validation.
- Use optimistic concurrency (`version` or ETag) for permission changes and editing memories.
- Encrypt highly sensitive fields at the application layer in addition to infrastructure encryption when the threat model requires it.
- Backups are encrypted, regularly restore-tested and assigned a retention period.

## 9. Security baseline before any beta user

- Threat model and data-flow diagram reviewed.
- MFA/passkeys available for adults.
- Encryption in transit (TLS) and at rest enabled.
- KMS-managed encryption keys, rotation procedure and secret manager in use.
- Production, staging and development are separate accounts/projects and databases.
- Least-privilege IAM/service accounts; no shared root credentials.
- Centralised structured logging with raw private content redacted.
- Rate limiting, input validation, file-type validation and malware scanning pipeline for uploaded files.
- Dependency scanning, secret scanning, SAST and migration checks in CI.
- Incident response, backup restore and account-recovery runbooks written and exercised.

## 10. First implementation tranche

Build this before connecting real AI providers or ingesting real personal photo libraries:

1. Replace the Vite-only application setup with a monorepo structure: `apps/web`, `apps/api`, `apps/worker`, `packages/contracts`, `packages/db`.
2. Add TypeScript, formatter, strict linting, tests and CI.
3. Provision development PostgreSQL, private object storage, KMS/secret manager and queue.
4. Add migrations for `users`, `households`, `household_members`, `profiles`, `spaces`, `space_memberships`, `assets`, `agents`, `agent_scope_grants`, `consents` and `audit_events`.
5. Implement authentication, household creation and explicit space membership API.
6. Implement signed upload flow and encrypted object-storage policy.
7. Implement an upload registration endpoint and a no-op background job that proves the outbox/worker path before AI processing is introduced.
8. Add automated tests specifically proving: private adult vault isolation, shared-space access, child guardian access, revoked grant rejection and audit event creation.

## 11. Decisions required before provisioning

1. **Cloud foundation:** AWS (recommended for long-term control and compliance readiness), Google Cloud, or a faster managed-backend route for the MVP.
2. **Region:** choose U.S. region and document data residency.
3. **Authentication vendor:** managed OIDC provider vs cloud-native identity service.
4. **Backup model:** app-managed encrypted backup only vs user-controlled storage option later.
5. **Face recognition:** opt-in in MVP, opt-in later, or excluded until post-MVP legal/privacy review.
6. **Compliance target:** baseline U.S. privacy/security controls now; HIPAA-grade health workflows remain out of scope until a separate compliance program is approved.
