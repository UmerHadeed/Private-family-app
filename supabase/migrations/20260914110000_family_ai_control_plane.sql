-- Family AI control plane: explicit, revocable source grants with no inherited vault access.

begin;

create type public.agent_scope_capability as enum ('read', 'suggest');
create type public.agent_consent_status as enum ('active', 'revoked');

create table public.agents (
  id uuid primary key default gen_random_uuid(),
  household_id uuid not null references public.households(id) on delete cascade,
  created_by_user_id uuid not null references public.profiles(id) on delete restrict,
  name text not null check (char_length(btrim(name)) between 1 and 120),
  purpose text not null default '' check (char_length(purpose) <= 1000),
  instructions text not null default '' check (char_length(instructions) <= 10000),
  status public.agent_status not null default 'draft',
  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now(),
  archived_at timestamptz
);

create table public.agent_scope_grants (
  id uuid primary key default gen_random_uuid(),
  agent_id uuid not null references public.agents(id) on delete cascade,
  space_id uuid not null references public.spaces(id) on delete restrict,
  capability public.agent_scope_capability not null default 'read',
  granted_by_user_id uuid not null references public.profiles(id) on delete restrict,
  granted_at timestamptz not null default now(),
  revoked_at timestamptz,
  revoked_by_user_id uuid references public.profiles(id) on delete restrict
);

create table public.agent_consents (
  id uuid primary key default gen_random_uuid(),
  agent_id uuid not null references public.agents(id) on delete cascade,
  scope_grant_id uuid not null references public.agent_scope_grants(id) on delete cascade,
  consented_by_user_id uuid not null references public.profiles(id) on delete restrict,
  status public.agent_consent_status not null default 'active',
  granted_at timestamptz not null default now(),
  revoked_at timestamptz,
  revoked_by_user_id uuid references public.profiles(id) on delete restrict,
  unique (agent_id, scope_grant_id)
);

create table public.agent_runs (
  id uuid primary key default gen_random_uuid(),
  agent_id uuid not null references public.agents(id) on delete cascade,
  requested_by_user_id uuid references public.profiles(id) on delete set null,
  status text not null check (status in ('queued', 'running', 'completed', 'failed', 'blocked')),
  request_summary text not null default '' check (char_length(request_summary) <= 1000),
  error_message text check (error_message is null or char_length(error_message) <= 1000),
  started_at timestamptz,
  completed_at timestamptz,
  created_at timestamptz not null default now()
);

create index agents_owner_idx on public.agents(created_by_user_id, created_at desc) where archived_at is null;
create index agent_scope_grants_agent_idx on public.agent_scope_grants(agent_id, granted_at desc) where revoked_at is null;
create unique index agent_scope_grants_one_active_idx on public.agent_scope_grants(agent_id, space_id, capability) where revoked_at is null;
create index agent_runs_agent_idx on public.agent_runs(agent_id, created_at desc);

create or replace function public.is_agent_owner(target_agent_id uuid)
returns boolean language sql stable security definer set search_path = public as $$
  select exists (
    select 1 from public.agents
    where id = target_agent_id
      and created_by_user_id = auth.uid()
      and archived_at is null
  );
$$;

create or replace function public.validate_agent_write()
returns trigger language plpgsql security definer set search_path = public as $$
begin
  if tg_op = 'INSERT' then
    if new.created_by_user_id <> auth.uid() or not public.is_household_member(new.household_id) then
      raise exception 'Agents must be created by the signed-in household member.';
    end if;
    new.updated_at := now();
    return new;
  end if;

  if old.created_by_user_id <> auth.uid() then
    raise exception 'Only the agent owner can change this agent.';
  end if;
  if old.household_id <> new.household_id or old.created_by_user_id <> new.created_by_user_id or old.created_at <> new.created_at then
    raise exception 'Agent ownership and household cannot be changed.';
  end if;
  new.updated_at := now();
  if new.status = 'archived' and old.archived_at is null then new.archived_at := now(); end if;
  if new.status <> 'archived' then new.archived_at := null; end if;
  return new;
end;
$$;

create trigger agents_guard_write
before insert or update on public.agents
for each row execute procedure public.validate_agent_write();

create or replace function public.validate_agent_scope_grant()
returns trigger language plpgsql security definer set search_path = public as $$
declare
  agent_household_id uuid;
  source_household_id uuid;
begin
  select household_id into agent_household_id from public.agents where id = new.agent_id;
  select household_id into source_household_id from public.spaces where id = new.space_id;
  if agent_household_id is null or source_household_id is null or agent_household_id <> source_household_id then
    raise exception 'An agent can only use a source from its own household.';
  end if;
  if not public.is_agent_owner(new.agent_id) or new.granted_by_user_id <> auth.uid() or not public.is_space_editor(new.space_id) then
    raise exception 'Only the agent owner with editor access to the exact source can grant it.';
  end if;
  if tg_op = 'UPDATE' then
    if old.agent_id <> new.agent_id or old.space_id <> new.space_id or old.capability <> new.capability or old.granted_by_user_id <> new.granted_by_user_id or old.granted_at <> new.granted_at then
      raise exception 'Source grant identity cannot be changed.';
    end if;
    if old.revoked_at is not null then raise exception 'Revoked source grants cannot be changed.'; end if;
    if new.revoked_at is not null then new.revoked_by_user_id := auth.uid(); end if;
  end if;
  return new;
end;
$$;

create trigger agent_scope_grants_guard_write
before insert or update on public.agent_scope_grants
for each row execute procedure public.validate_agent_scope_grant();

create or replace function public.validate_agent_consent()
returns trigger language plpgsql security definer set search_path = public as $$
begin
  if not public.is_agent_owner(new.agent_id) or new.consented_by_user_id <> auth.uid() then
    raise exception 'Only the agent owner can record consent.';
  end if;
  if not exists (select 1 from public.agent_scope_grants where id = new.scope_grant_id and agent_id = new.agent_id and revoked_at is null) then
    raise exception 'Consent requires an active grant for this exact agent.';
  end if;
  if tg_op = 'UPDATE' and old.status = 'revoked' then raise exception 'Revoked consents cannot be changed.'; end if;
  if new.status = 'revoked' and old.status = 'active' then new.revoked_at := now(); new.revoked_by_user_id := auth.uid(); end if;
  return new;
end;
$$;

create trigger agent_consents_guard_write
before insert or update on public.agent_consents
for each row execute procedure public.validate_agent_consent();

create or replace function public.audit_agent_write()
returns trigger language plpgsql security definer set search_path = public as $$
begin
  insert into public.audit_events(household_id, actor_user_id, action, resource_type, resource_id, metadata)
  values (
    coalesce(new.household_id, old.household_id), auth.uid(),
    case when tg_op = 'INSERT' then 'create' when new.status = 'archived' and old.status <> 'archived' then 'delete' else 'update' end,
    'agents', coalesce(new.id, old.id), jsonb_build_object('operation', tg_op, 'status', coalesce(new.status::text, old.status::text))
  );
  return coalesce(new, old);
end;
$$;

create or replace function public.audit_agent_scope_grant_write()
returns trigger language plpgsql security definer set search_path = public as $$
declare household uuid;
begin
  select household_id into household from public.agents where id = coalesce(new.agent_id, old.agent_id);
  insert into public.audit_events(household_id, actor_user_id, action, resource_type, resource_id, metadata)
  values (
    household, auth.uid(),
    case when tg_op = 'INSERT' then 'share' when new.revoked_at is not null and old.revoked_at is null then 'revoke' else 'update' end,
    'agent_scope_grants', coalesce(new.id, old.id), jsonb_build_object('operation', tg_op, 'agent_id', coalesce(new.agent_id, old.agent_id), 'space_id', coalesce(new.space_id, old.space_id))
  );
  return coalesce(new, old);
end;
$$;

create or replace function public.audit_agent_consent_write()
returns trigger language plpgsql security definer set search_path = public as $$
declare household uuid;
begin
  select household_id into household from public.agents where id = coalesce(new.agent_id, old.agent_id);
  insert into public.audit_events(household_id, actor_user_id, action, resource_type, resource_id, metadata)
  values (
    household, auth.uid(),
    case when tg_op = 'INSERT' then 'share' when new.status = 'revoked' and old.status <> 'revoked' then 'revoke' else 'update' end,
    'agent_consents', coalesce(new.id, old.id), jsonb_build_object('operation', tg_op, 'agent_id', coalesce(new.agent_id, old.agent_id), 'scope_grant_id', coalesce(new.scope_grant_id, old.scope_grant_id))
  );
  return coalesce(new, old);
end;
$$;

create trigger agents_audit
after insert or update on public.agents
for each row execute procedure public.audit_agent_write();
create trigger agent_scope_grants_audit
after insert or update on public.agent_scope_grants
for each row execute procedure public.audit_agent_scope_grant_write();
create trigger agent_consents_audit
after insert or update on public.agent_consents
for each row execute procedure public.audit_agent_consent_write();

alter table public.agents enable row level security;
alter table public.agent_scope_grants enable row level security;
alter table public.agent_consents enable row level security;
alter table public.agent_runs enable row level security;

create policy "agents: creator manages" on public.agents
for all to authenticated using (created_by_user_id = auth.uid()) with check (created_by_user_id = auth.uid() and public.is_household_member(household_id));
create policy "agent scope grants: owner manages" on public.agent_scope_grants
for all to authenticated using (public.is_agent_owner(agent_id)) with check (public.is_agent_owner(agent_id));
create policy "agent consents: owner manages" on public.agent_consents
for all to authenticated using (public.is_agent_owner(agent_id)) with check (public.is_agent_owner(agent_id));
create policy "agent runs: owner reads" on public.agent_runs
for select to authenticated using (public.is_agent_owner(agent_id));

-- Browser clients do not receive insert/update rights for runs. A future server-side AI worker must re-check grants at execution time.
grant select, insert, update on public.agents, public.agent_scope_grants, public.agent_consents to authenticated;
grant select on public.agent_runs to authenticated;

commit;
