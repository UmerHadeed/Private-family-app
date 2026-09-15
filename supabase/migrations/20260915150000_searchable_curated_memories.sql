-- Curated memories are user-authored collections. Profile tags remain descriptive and never grant access.
begin;

create table public.curated_memories (
  id uuid primary key default gen_random_uuid(),
  household_id uuid not null references public.households(id) on delete cascade,
  space_id uuid not null references public.spaces(id) on delete restrict,
  created_by_user_id uuid not null references public.profiles(id) on delete restrict,
  title text not null check (char_length(btrim(title)) between 1 and 240),
  summary text not null default '' check (char_length(summary) <= 4000),
  search_document tsvector generated always as (
    setweight(to_tsvector('simple', coalesce(title, '')), 'A') ||
    setweight(to_tsvector('simple', coalesce(summary, '')), 'B')
  ) stored,
  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now(),
  archived_at timestamptz
);

create table public.curated_memory_assets (
  memory_id uuid not null references public.curated_memories(id) on delete cascade,
  asset_id uuid not null references public.assets(id) on delete restrict,
  linked_by_user_id uuid not null references public.profiles(id) on delete restrict,
  created_at timestamptz not null default now(),
  primary key (memory_id, asset_id)
);

create index curated_memories_space_active_idx on public.curated_memories(space_id, created_at desc) where archived_at is null;
create index curated_memories_search_idx on public.curated_memories using gin(search_document) where archived_at is null;
create index curated_memory_assets_asset_idx on public.curated_memory_assets(asset_id, memory_id);

create or replace function public.validate_curated_memory_write()
returns trigger language plpgsql security definer set search_path = public as $$
declare target_space public.spaces;
begin
  select * into target_space from public.spaces where id = new.space_id;
  if auth.uid() is null or target_space.id is null or target_space.household_id <> new.household_id then
    raise exception 'A curated memory must belong to an existing space in the same household.';
  end if;
  if new.created_by_user_id <> auth.uid() then
    raise exception 'Curated memories must identify the signed-in creator.';
  end if;
  if tg_op = 'UPDATE' and (new.created_by_user_id <> old.created_by_user_id or new.household_id <> old.household_id) then
    raise exception 'A curated memory creator and household cannot be changed.';
  end if;
  if not public.is_space_editor(new.space_id) then
    raise exception 'Only an editor of the memory space can create or update this curated memory.';
  end if;
  return new;
end;
$$;

create trigger curated_memories_guard_write
before insert or update on public.curated_memories
for each row execute procedure public.validate_curated_memory_write();

create or replace function public.validate_curated_memory_asset_write()
returns trigger language plpgsql security definer set search_path = public as $$
declare memory_record public.curated_memories;
declare asset_record public.assets;
begin
  select * into memory_record from public.curated_memories where id = new.memory_id and archived_at is null;
  select * into asset_record from public.assets where id = new.asset_id and deleted_at is null;
  if memory_record.id is null or asset_record.id is null then
    raise exception 'Curated memories can only link active, non-deleted assets.';
  end if;
  if new.linked_by_user_id <> auth.uid() or memory_record.created_by_user_id <> auth.uid() or not public.is_space_editor(memory_record.space_id) then
    raise exception 'Only the memory creator who can edit its space can link assets.';
  end if;
  if asset_record.household_id <> memory_record.household_id or not public.is_space_member(asset_record.space_id) then
    raise exception 'A curated memory can only link an accessible asset from the same household.';
  end if;
  return new;
end;
$$;

create trigger curated_memory_assets_guard_write
before insert on public.curated_memory_assets
for each row execute procedure public.validate_curated_memory_asset_write();

create or replace function public.audit_curated_memory_write()
returns trigger language plpgsql security definer set search_path = public as $$
declare record public.curated_memories := coalesce(new, old);
begin
  insert into public.audit_events(household_id, actor_user_id, action, resource_type, resource_id, metadata)
  values (
    record.household_id, auth.uid(),
    case when tg_op = 'INSERT' then 'create' when tg_op = 'DELETE' then 'delete' else 'update' end,
    'curated_memory', record.id,
    jsonb_build_object('operation', tg_op, 'space_id', record.space_id, 'archived', record.archived_at is not null)
  );
  return coalesce(new, old);
end;
$$;

create trigger curated_memories_audit
after insert or update or delete on public.curated_memories
for each row execute procedure public.audit_curated_memory_write();

create or replace function public.audit_curated_memory_asset_write()
returns trigger language plpgsql security definer set search_path = public as $$
declare memory_record public.curated_memories;
begin
  select * into memory_record from public.curated_memories where id = coalesce(new.memory_id, old.memory_id);
  if memory_record.id is not null then
    insert into public.audit_events(household_id, actor_user_id, action, resource_type, resource_id, metadata)
    values (memory_record.household_id, auth.uid(), case when tg_op = 'INSERT' then 'update' else 'delete' end, 'curated_memory_asset', memory_record.id, jsonb_build_object('operation', tg_op, 'asset_id', coalesce(new.asset_id, old.asset_id)));
  end if;
  return coalesce(new, old);
end;
$$;

create trigger curated_memory_assets_audit
after insert or delete on public.curated_memory_assets
for each row execute procedure public.audit_curated_memory_asset_write();

-- Full-text search is evaluated inside the database and re-checks every returned memory's space access.
-- Asset filenames are durable metadata; this does not make unsupported file contents searchable.
create or replace function public.search_curated_memories(search_query text, result_limit integer default 50)
returns table (
  id uuid, household_id uuid, space_id uuid, created_by_user_id uuid,
  title text, summary text, created_at timestamptz, updated_at timestamptz,
  asset_match boolean, rank real
) language sql stable security definer set search_path = public as $$
  with query as (select websearch_to_tsquery('simple', coalesce(search_query, '')) as terms),
  matches as (
    select m.id, m.household_id, m.space_id, m.created_by_user_id, m.title, m.summary, m.created_at, m.updated_at,
      false as asset_match, ts_rank_cd(m.search_document, q.terms) as rank
    from public.curated_memories m cross join query q
    where m.archived_at is null and public.is_space_member(m.space_id) and q.terms @@ m.search_document
    union all
    select m.id, m.household_id, m.space_id, m.created_by_user_id, m.title, m.summary, m.created_at, m.updated_at,
      true as asset_match, ts_rank_cd(to_tsvector('simple', a.filename), q.terms) as rank
    from public.curated_memories m
    join public.curated_memory_assets ma on ma.memory_id = m.id
    join public.assets a on a.id = ma.asset_id and a.deleted_at is null
    cross join query q
    where m.archived_at is null
      and public.is_space_member(m.space_id)
      and public.is_space_member(a.space_id)
      and q.terms @@ to_tsvector('simple', a.filename)
  )
  select id, household_id, space_id, created_by_user_id, title, summary, created_at, updated_at,
    bool_or(asset_match) as asset_match, max(rank) as rank
  from matches
  group by id, household_id, space_id, created_by_user_id, title, summary, created_at, updated_at
  order by max(rank) desc, max(created_at) desc
  limit greatest(1, least(coalesce(result_limit, 50), 100));
$$;

alter table public.curated_memories enable row level security;
alter table public.curated_memory_assets enable row level security;

create policy "curated memories: space members read" on public.curated_memories
for select to authenticated using (archived_at is null and public.is_space_member(space_id));
create policy "curated memories: creators create" on public.curated_memories
for insert to authenticated with check (created_by_user_id = auth.uid() and public.is_space_editor(space_id));
create policy "curated memories: creators update" on public.curated_memories
for update to authenticated using (created_by_user_id = auth.uid() and public.is_space_editor(space_id)) with check (created_by_user_id = auth.uid() and public.is_space_editor(space_id));
create policy "curated memory assets: permitted members read" on public.curated_memory_assets
for select to authenticated using (
  exists (select 1 from public.curated_memories m where m.id = memory_id and m.archived_at is null and public.is_space_member(m.space_id))
  and exists (select 1 from public.assets a where a.id = asset_id and a.deleted_at is null and public.is_space_member(a.space_id))
);
create policy "curated memory assets: creators link" on public.curated_memory_assets
for insert to authenticated with check (
  linked_by_user_id = auth.uid()
  and exists (select 1 from public.curated_memories m where m.id = memory_id and m.archived_at is null and m.created_by_user_id = auth.uid() and public.is_space_editor(m.space_id))
  and exists (select 1 from public.assets a where a.id = asset_id and a.deleted_at is null and public.is_space_member(a.space_id))
);
create policy "curated memory assets: creators unlink" on public.curated_memory_assets
for delete to authenticated using (
  exists (select 1 from public.curated_memories m where m.id = memory_id and m.created_by_user_id = auth.uid() and public.is_space_editor(m.space_id))
);

alter table public.curated_memories replica identity full;
alter table public.curated_memory_assets replica identity full;
alter publication supabase_realtime add table public.curated_memories;
alter publication supabase_realtime add table public.curated_memory_assets;

grant select, insert, update, delete on public.curated_memories, public.curated_memory_assets to authenticated;
grant execute on function public.search_curated_memories(text, integer) to authenticated;
revoke all on function public.validate_curated_memory_write() from public;
revoke all on function public.validate_curated_memory_asset_write() from public;
revoke all on function public.audit_curated_memory_write() from public;
revoke all on function public.audit_curated_memory_asset_write() from public;

commit;
