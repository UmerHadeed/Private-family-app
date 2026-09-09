-- Async ingestion and source-connection foundation.
-- Keep background work idempotent and tenant-scoped. Do not put raw asset content in queue payloads.

begin;

create type app.source_connection_type as enum ('photo_library', 'file_provider', 'voice_notes', 'calendar');
create type app.connection_status as enum ('pending', 'active', 'revoked', 'error');
create type app.ingestion_job_status as enum ('queued', 'processing', 'succeeded', 'failed', 'cancelled');

create table app.source_connections (
  id uuid primary key default gen_random_uuid(),
  household_id uuid not null references app.households(id) on delete cascade,
  profile_id uuid references app.profiles(id) on delete set null,
  granted_by_user_id uuid not null references app.users(id),
  connection_type app.source_connection_type not null,
  status app.connection_status not null default 'pending',
  permission_scope jsonb not null default '{}'::jsonb,
  external_reference_ciphertext bytea,
  last_synced_at timestamptz,
  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now(),
  revoked_at timestamptz,
  check (jsonb_typeof(permission_scope) = 'object')
);

create unique index active_source_connection_idx
  on app.source_connections(household_id, granted_by_user_id, connection_type, coalesce(profile_id, '00000000-0000-0000-0000-000000000000'))
  where revoked_at is null;

create table app.ingestion_jobs (
  id uuid primary key default gen_random_uuid(),
  household_id uuid not null references app.households(id) on delete cascade,
  asset_id uuid not null references app.assets(id) on delete cascade,
  source_connection_id uuid references app.source_connections(id) on delete set null,
  idempotency_key text not null unique,
  job_type text not null check (job_type in ('verify_upload', 'thumbnail', 'transcribe', 'ocr', 'caption', 'embed', 'face_match', 'propose_filing')),
  status app.ingestion_job_status not null default 'queued',
  attempt_count integer not null default 0 check (attempt_count >= 0 and attempt_count <= 20),
  locked_at timestamptz,
  completed_at timestamptz,
  failure_code text,
  failure_detail text,
  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now()
);

create index ingestion_jobs_dispatch_idx
  on app.ingestion_jobs(status, created_at)
  where status in ('queued', 'failed');

create table app.outbox_events (
  id uuid primary key default gen_random_uuid(),
  household_id uuid not null references app.households(id) on delete cascade,
  aggregate_type text not null,
  aggregate_id uuid not null,
  event_type text not null,
  payload jsonb not null,
  occurred_at timestamptz not null default now(),
  published_at timestamptz,
  publish_attempt_count integer not null default 0 check (publish_attempt_count >= 0 and publish_attempt_count <= 20),
  check (jsonb_typeof(payload) = 'object')
);

create index outbox_events_unpublished_idx
  on app.outbox_events(occurred_at)
  where published_at is null;

alter table app.source_connections enable row level security;
alter table app.ingestion_jobs enable row level security;
alter table app.outbox_events enable row level security;

create policy source_connection_access on app.source_connections
  using (app.is_active_household_member(household_id));

create policy ingestion_job_access on app.ingestion_jobs
  using (app.is_active_household_member(household_id));

create policy outbox_event_access on app.outbox_events
  using (app.is_active_household_member(household_id));

commit;
