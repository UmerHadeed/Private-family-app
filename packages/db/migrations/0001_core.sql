-- Private Family OS production baseline
-- Apply through the migration runner with a non-superuser migration role.
-- Application requests must use `SET LOCAL app.user_id = '<uuid>'` inside a transaction.

begin;

create schema if not exists app;
revoke all on schema app from public;

create extension if not exists pgcrypto;
create extension if not exists citext;
create extension if not exists vector;

create type app.household_role as enum ('owner', 'adult_member', 'viewer');
create type app.profile_type as enum ('adult', 'child', 'dependent');
create type app.profile_status as enum ('active', 'archived', 'ownership_transfer_pending', 'transferred');
create type app.space_type as enum ('private_vault', 'family', 'profile', 'custom_shared');
create type app.space_role as enum ('owner', 'editor', 'viewer');
create type app.asset_type as enum ('photo', 'video', 'audio', 'document', 'note');
create type app.agent_status as enum ('draft', 'active', 'paused', 'archived');
create type app.proposal_status as enum ('pending', 'accepted', 'rejected', 'expired', 'auto_applied');
create type app.audit_action as enum ('create', 'read', 'update', 'delete', 'share', 'revoke', 'download', 'export', 'ai_process', 'ai_propose', 'ai_apply');

create table app.users (
  id uuid primary key,
  oidc_subject text not null unique,
  email citext not null unique,
  display_name text not null check (char_length(display_name) between 1 and 120),
  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now(),
  deleted_at timestamptz
);

create table app.households (
  id uuid primary key default gen_random_uuid(),
  name text not null check (char_length(name) between 1 and 120),
  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now(),
  deleted_at timestamptz
);

create table app.household_members (
  household_id uuid not null references app.households(id) on delete cascade,
  user_id uuid not null references app.users(id) on delete cascade,
  role app.household_role not null,
  joined_at timestamptz not null default now(),
  revoked_at timestamptz,
  primary key (household_id, user_id)
);

create table app.profiles (
  id uuid primary key default gen_random_uuid(),
  household_id uuid not null references app.households(id) on delete cascade,
  profile_type app.profile_type not null,
  status app.profile_status not null default 'active',
  owner_user_id uuid references app.users(id) on delete set null,
  display_name text not null check (char_length(display_name) between 1 and 120),
  birth_date date,
  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now(),
  deleted_at timestamptz,
  check ((profile_type = 'adult' and owner_user_id is not null) or profile_type <> 'adult')
);

create table app.profile_guardians (
  profile_id uuid not null references app.profiles(id) on delete cascade,
  user_id uuid not null references app.users(id) on delete cascade,
  granted_by_user_id uuid not null references app.users(id),
  granted_at timestamptz not null default now(),
  revoked_at timestamptz,
  primary key (profile_id, user_id)
);

create table app.spaces (
  id uuid primary key default gen_random_uuid(),
  household_id uuid not null references app.households(id) on delete cascade,
  profile_id uuid references app.profiles(id) on delete cascade,
  space_type app.space_type not null,
  name text not null check (char_length(name) between 1 and 120),
  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now(),
  deleted_at timestamptz,
  check ((space_type = 'profile' and profile_id is not null) or space_type <> 'profile')
);

create table app.space_memberships (
  space_id uuid not null references app.spaces(id) on delete cascade,
  user_id uuid not null references app.users(id) on delete cascade,
  role app.space_role not null,
  granted_by_user_id uuid not null references app.users(id),
  granted_at timestamptz not null default now(),
  revoked_at timestamptz,
  primary key (space_id, user_id)
);

create table app.assets (
  id uuid primary key default gen_random_uuid(),
  household_id uuid not null references app.households(id) on delete cascade,
  space_id uuid not null references app.spaces(id) on delete restrict,
  uploaded_by_user_id uuid not null references app.users(id),
  asset_type app.asset_type not null,
  original_object_key text not null unique,
  content_sha256 text not null check (content_sha256 ~ '^[a-f0-9]{64}$'),
  media_created_at timestamptz,
  captured_timezone text,
  filename text not null check (char_length(filename) <= 512),
  mime_type text not null check (char_length(mime_type) <= 255),
  byte_size bigint not null check (byte_size >= 0),
  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now(),
  deleted_at timestamptz,
  version integer not null default 1,
  unique (household_id, content_sha256, space_id)
);

create index assets_space_created_idx on app.assets(space_id, created_at desc) where deleted_at is null;
create index assets_household_media_created_idx on app.assets(household_id, media_created_at desc) where deleted_at is null;

create table app.asset_people (
  asset_id uuid not null references app.assets(id) on delete cascade,
  profile_id uuid not null references app.profiles(id) on delete cascade,
  source text not null check (source in ('user', 'ai')),
  status app.proposal_status not null default 'pending',
  confidence numeric(4,3) check (confidence is null or (confidence >= 0 and confidence <= 1)),
  reviewed_by_user_id uuid references app.users(id),
  reviewed_at timestamptz,
  created_at timestamptz not null default now(),
  primary key (asset_id, profile_id)
);

create table app.agents (
  id uuid primary key default gen_random_uuid(),
  household_id uuid not null references app.households(id) on delete cascade,
  created_by_user_id uuid not null references app.users(id),
  name text not null check (char_length(name) between 1 and 120),
  purpose text not null check (char_length(purpose) <= 4000),
  status app.agent_status not null default 'draft',
  model_route text not null check (char_length(model_route) <= 120),
  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now(),
  deleted_at timestamptz
);

create table app.agent_scope_grants (
  id uuid primary key default gen_random_uuid(),
  agent_id uuid not null references app.agents(id) on delete cascade,
  space_id uuid references app.spaces(id) on delete cascade,
  profile_id uuid references app.profiles(id) on delete cascade,
  granted_by_user_id uuid not null references app.users(id),
  capabilities text[] not null check (cardinality(capabilities) > 0),
  granted_at timestamptz not null default now(),
  revoked_at timestamptz,
  check (num_nonnulls(space_id, profile_id) = 1)
);

create unique index active_agent_scope_grant_idx
  on app.agent_scope_grants(agent_id, coalesce(space_id, '00000000-0000-0000-0000-000000000000'), coalesce(profile_id, '00000000-0000-0000-0000-000000000000'))
  where revoked_at is null;

create table app.consents (
  id uuid primary key default gen_random_uuid(),
  household_id uuid not null references app.households(id) on delete cascade,
  granted_by_user_id uuid not null references app.users(id),
  profile_id uuid references app.profiles(id) on delete cascade,
  agent_id uuid references app.agents(id) on delete cascade,
  consent_type text not null check (consent_type in ('source_ingestion', 'face_reference', 'face_match', 'auto_file', 'ai_processing')),
  policy_version text not null,
  payload jsonb not null default '{}'::jsonb,
  granted_at timestamptz not null default now(),
  revoked_at timestamptz,
  check (jsonb_typeof(payload) = 'object')
);

create table app.ai_derivations (
  id uuid primary key default gen_random_uuid(),
  asset_id uuid not null references app.assets(id) on delete cascade,
  agent_id uuid references app.agents(id) on delete set null,
  derivation_type text not null check (derivation_type in ('transcript', 'ocr', 'caption', 'embedding', 'classification', 'face_match')),
  model_identifier text not null,
  model_version text,
  source_hash text not null,
  content jsonb not null,
  confidence numeric(4,3) check (confidence is null or (confidence >= 0 and confidence <= 1)),
  created_at timestamptz not null default now(),
  check (jsonb_typeof(content) in ('object', 'array', 'string'))
);

create table app.ai_proposals (
  id uuid primary key default gen_random_uuid(),
  household_id uuid not null references app.households(id) on delete cascade,
  asset_id uuid references app.assets(id) on delete cascade,
  agent_id uuid not null references app.agents(id) on delete cascade,
  proposal_type text not null check (proposal_type in ('person_tag', 'memory', 'timeline', 'reminder', 'caption', 'filing')),
  payload jsonb not null,
  confidence numeric(4,3) check (confidence is null or (confidence >= 0 and confidence <= 1)),
  status app.proposal_status not null default 'pending',
  decided_by_user_id uuid references app.users(id),
  decided_at timestamptz,
  created_at timestamptz not null default now(),
  expires_at timestamptz,
  check (jsonb_typeof(payload) = 'object')
);

create table app.audit_events (
  id uuid primary key default gen_random_uuid(),
  household_id uuid not null references app.households(id) on delete restrict,
  actor_user_id uuid references app.users(id) on delete set null,
  agent_id uuid references app.agents(id) on delete set null,
  action app.audit_action not null,
  resource_type text not null,
  resource_id uuid,
  request_id uuid,
  ip_hash text,
  metadata jsonb not null default '{}'::jsonb,
  occurred_at timestamptz not null default now(),
  check (num_nonnulls(actor_user_id, agent_id) <= 1),
  check (jsonb_typeof(metadata) = 'object')
);

create index audit_events_household_time_idx on app.audit_events(household_id, occurred_at desc);

-- Application transaction context. A missing/invalid setting evaluates to no access.
create function app.current_user_id() returns uuid
language sql stable as $$
  select nullif(current_setting('app.user_id', true), '')::uuid
$$;

create function app.is_active_space_member(target_space_id uuid) returns boolean
language sql stable security definer set search_path = app, public as $$
  select exists (
    select 1 from app.space_memberships membership
    where membership.space_id = target_space_id
      and membership.user_id = app.current_user_id()
      and membership.revoked_at is null
  )
$$;

create function app.is_active_household_member(target_household_id uuid) returns boolean
language sql stable security definer set search_path = app, public as $$
  select exists (
    select 1 from app.household_members membership
    where membership.household_id = target_household_id
      and membership.user_id = app.current_user_id()
      and membership.revoked_at is null
  )
$$;

create function app.is_profile_guardian(target_profile_id uuid) returns boolean
language sql stable security definer set search_path = app, public as $$
  select exists (
    select 1 from app.profile_guardians guardian
    where guardian.profile_id = target_profile_id
      and guardian.user_id = app.current_user_id()
      and guardian.revoked_at is null
  )
$$;

alter table app.users enable row level security;
alter table app.households enable row level security;
alter table app.household_members enable row level security;
alter table app.profiles enable row level security;
alter table app.profile_guardians enable row level security;
alter table app.spaces enable row level security;
alter table app.space_memberships enable row level security;
alter table app.assets enable row level security;
alter table app.asset_people enable row level security;
alter table app.agents enable row level security;
alter table app.agent_scope_grants enable row level security;
alter table app.consents enable row level security;
alter table app.ai_derivations enable row level security;
alter table app.ai_proposals enable row level security;
alter table app.audit_events enable row level security;

create policy user_self_access on app.users
  using (id = app.current_user_id());

create policy household_access on app.households
  using (app.is_active_household_member(id));

create policy household_member_access on app.household_members
  using (app.is_active_household_member(household_id));

create policy profile_access on app.profiles
  using (app.is_active_household_member(household_id) and (profile_type = 'adult' and owner_user_id = app.current_user_id() or profile_type <> 'adult' and app.is_profile_guardian(id)));

create policy profile_guardian_access on app.profile_guardians
  using (app.is_profile_guardian(profile_id));

create policy space_access on app.spaces
  using (app.is_active_space_member(id));

create policy space_membership_access on app.space_memberships
  using (app.is_active_space_member(space_id));

create policy asset_access on app.assets
  using (app.is_active_space_member(space_id));

create policy asset_people_access on app.asset_people
  using (exists (select 1 from app.assets a where a.id = asset_id and app.is_active_space_member(a.space_id)));

create policy agent_access on app.agents
  using (app.is_active_household_member(household_id));

create policy agent_scope_grant_access on app.agent_scope_grants
  using (exists (select 1 from app.agents a where a.id = agent_id and app.is_active_household_member(a.household_id)));

create policy consent_access on app.consents
  using (app.is_active_household_member(household_id));

create policy ai_proposal_access on app.ai_proposals
  using (app.is_active_household_member(household_id));

create policy ai_derivation_access on app.ai_derivations
  using (exists (select 1 from app.assets a where a.id = asset_id and app.is_active_space_member(a.space_id)));

create policy audit_event_access on app.audit_events
  using (app.is_active_household_member(household_id));

commit;
