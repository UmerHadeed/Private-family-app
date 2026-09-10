-- Private Family OS: Supabase baseline
-- Run with `supabase db push`. Authentication comes from auth.users; application data is in public.

begin;

create extension if not exists pgcrypto;

create type public.household_role as enum ('owner', 'adult_member', 'viewer');
create type public.profile_type as enum ('adult', 'child', 'dependent');
create type public.space_type as enum ('private_vault', 'family', 'profile', 'custom_shared');
create type public.space_role as enum ('owner', 'editor', 'viewer');
create type public.asset_type as enum ('photo', 'video', 'audio', 'document', 'note');
create type public.agent_status as enum ('draft', 'active', 'paused', 'archived');
create type public.proposal_status as enum ('pending', 'accepted', 'rejected', 'expired', 'auto_applied');

create table public.profiles (
  id uuid primary key references auth.users(id) on delete cascade,
  display_name text not null check (char_length(display_name) between 1 and 120),
  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now()
);

create table public.households (
  id uuid primary key default gen_random_uuid(),
  name text not null check (char_length(name) between 1 and 120),
  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now()
);

create table public.household_members (
  household_id uuid not null references public.households(id) on delete cascade,
  user_id uuid not null references public.profiles(id) on delete cascade,
  role public.household_role not null,
  joined_at timestamptz not null default now(),
  revoked_at timestamptz,
  primary key (household_id, user_id)
);

create table public.family_profiles (
  id uuid primary key default gen_random_uuid(),
  household_id uuid not null references public.households(id) on delete cascade,
  profile_type public.profile_type not null,
  owner_user_id uuid references public.profiles(id) on delete set null,
  display_name text not null check (char_length(display_name) between 1 and 120),
  birth_date date,
  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now(),
  check ((profile_type = 'adult' and owner_user_id is not null) or profile_type <> 'adult')
);

create table public.profile_guardians (
  profile_id uuid not null references public.family_profiles(id) on delete cascade,
  user_id uuid not null references public.profiles(id) on delete cascade,
  granted_by_user_id uuid not null references public.profiles(id),
  granted_at timestamptz not null default now(),
  revoked_at timestamptz,
  primary key (profile_id, user_id)
);

create table public.spaces (
  id uuid primary key default gen_random_uuid(),
  household_id uuid not null references public.households(id) on delete cascade,
  profile_id uuid references public.family_profiles(id) on delete cascade,
  space_type public.space_type not null,
  name text not null check (char_length(name) between 1 and 120),
  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now(),
  check ((space_type = 'profile' and profile_id is not null) or space_type <> 'profile')
);

create table public.space_memberships (
  space_id uuid not null references public.spaces(id) on delete cascade,
  user_id uuid not null references public.profiles(id) on delete cascade,
  role public.space_role not null,
  granted_by_user_id uuid not null references public.profiles(id),
  granted_at timestamptz not null default now(),
  revoked_at timestamptz,
  primary key (space_id, user_id)
);

create table public.assets (
  id uuid primary key default gen_random_uuid(),
  household_id uuid not null references public.households(id) on delete cascade,
  space_id uuid not null references public.spaces(id) on delete restrict,
  uploaded_by_user_id uuid not null references public.profiles(id),
  asset_type public.asset_type not null,
  storage_path text not null unique check (storage_path ~ '^[0-9a-f-]+/[0-9a-f-]+/.+'),
  content_sha256 text check (content_sha256 is null or content_sha256 ~ '^[a-f0-9]{64}$'),
  media_created_at timestamptz,
  filename text not null check (char_length(filename) <= 512),
  mime_type text not null check (char_length(mime_type) <= 255),
  byte_size bigint not null check (byte_size >= 0),
  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now(),
  deleted_at timestamptz,
  unique (household_id, content_sha256, space_id)
);

create index assets_space_created_idx on public.assets(space_id, created_at desc) where deleted_at is null;

create table public.audit_events (
  id uuid primary key default gen_random_uuid(),
  household_id uuid not null references public.households(id) on delete restrict,
  actor_user_id uuid references public.profiles(id) on delete set null,
  action text not null check (action in ('create', 'read', 'update', 'delete', 'share', 'revoke', 'download', 'export', 'ai_process', 'ai_propose', 'ai_apply')),
  resource_type text not null,
  resource_id uuid,
  metadata jsonb not null default '{}'::jsonb check (jsonb_typeof(metadata) = 'object'),
  occurred_at timestamptz not null default now()
);

create or replace function public.handle_new_user()
returns trigger language plpgsql security definer set search_path = public as $$
begin
  insert into public.profiles (id, display_name)
  values (new.id, coalesce(new.raw_user_meta_data ->> 'full_name', new.raw_user_meta_data ->> 'name', split_part(new.email, '@', 1), 'Family member'));
  return new;
end;
$$;

create trigger on_auth_user_created
after insert on auth.users for each row execute procedure public.handle_new_user();

create or replace function public.is_household_member(target_household_id uuid)
returns boolean language sql stable security definer set search_path = public as $$
  select exists (
    select 1 from public.household_members
    where household_id = target_household_id and user_id = auth.uid() and revoked_at is null
  );
$$;

create or replace function public.is_space_member(target_space_id uuid)
returns boolean language sql stable security definer set search_path = public as $$
  select exists (
    select 1 from public.space_memberships
    where space_id = target_space_id and user_id = auth.uid() and revoked_at is null
  );
$$;

create or replace function public.is_space_editor(target_space_id uuid)
returns boolean language sql stable security definer set search_path = public as $$
  select exists (
    select 1 from public.space_memberships
    where space_id = target_space_id and user_id = auth.uid() and role in ('owner', 'editor') and revoked_at is null
  );
$$;

create or replace function public.can_access_storage_path(target_path text)
returns boolean language sql stable security definer set search_path = public as $$
  select public.is_space_member(nullif(split_part(target_path, '/', 2), '')::uuid);
$$;

alter table public.profiles enable row level security;
alter table public.households enable row level security;
alter table public.household_members enable row level security;
alter table public.family_profiles enable row level security;
alter table public.profile_guardians enable row level security;
alter table public.spaces enable row level security;
alter table public.space_memberships enable row level security;
alter table public.assets enable row level security;
alter table public.audit_events enable row level security;

create policy "profiles: self read" on public.profiles for select to authenticated using (id = auth.uid());
create policy "profiles: self update" on public.profiles for update to authenticated using (id = auth.uid()) with check (id = auth.uid());
create policy "households: member read" on public.households for select to authenticated using (public.is_household_member(id));
create policy "household members: member read" on public.household_members for select to authenticated using (public.is_household_member(household_id));
create policy "family profiles: guardian read" on public.family_profiles for select to authenticated using (public.is_household_member(household_id));
create policy "spaces: member read" on public.spaces for select to authenticated using (public.is_space_member(id));
create policy "space memberships: member read" on public.space_memberships for select to authenticated using (public.is_space_member(space_id));
create policy "assets: space member read" on public.assets for select to authenticated using (public.is_space_member(space_id));
create policy "assets: space editor create" on public.assets for insert to authenticated with check (uploaded_by_user_id = auth.uid() and public.is_space_editor(space_id));
create policy "assets: space editor update" on public.assets for update to authenticated using (public.is_space_editor(space_id)) with check (public.is_space_editor(space_id));
create policy "audit events: household member read" on public.audit_events for select to authenticated using (public.is_household_member(household_id));

insert into storage.buckets (id, name, public, file_size_limit, allowed_mime_types)
values ('family-assets', 'family-assets', false, 52428800, array['image/*', 'video/*', 'audio/*', 'application/pdf', 'text/plain'])
on conflict (id) do update set public = false;

create policy "family assets: members read" on storage.objects for select to authenticated
using (bucket_id = 'family-assets' and public.can_access_storage_path(name));
create policy "family assets: editors upload" on storage.objects for insert to authenticated
with check (bucket_id = 'family-assets' and public.is_space_editor(nullif(split_part(name, '/', 2), '')::uuid));
create policy "family assets: editors update" on storage.objects for update to authenticated
using (bucket_id = 'family-assets' and public.is_space_editor(nullif(split_part(name, '/', 2), '')::uuid));
create policy "family assets: editors delete" on storage.objects for delete to authenticated
using (bucket_id = 'family-assets' and public.is_space_editor(nullif(split_part(name, '/', 2), '')::uuid));

grant usage on schema public to authenticated;
grant select, insert, update on all tables in schema public to authenticated;
grant usage, select on all sequences in schema public to authenticated;

commit;
