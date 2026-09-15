begin;

-- Tags describe an item. They do not alter the space membership that controls access to that item.
create table public.asset_people (
  asset_id uuid not null references public.assets(id) on delete cascade,
  profile_id uuid not null references public.family_profiles(id) on delete cascade,
  tagged_by_user_id uuid not null references public.profiles(id) on delete restrict,
  created_at timestamptz not null default now(),
  primary key (asset_id, profile_id)
);

create index asset_people_profile_idx on public.asset_people(profile_id, asset_id);

create or replace function public.validate_asset_person_write()
returns trigger language plpgsql security definer set search_path = public as $$
declare asset_household uuid;
begin
  select household_id into asset_household from public.assets where id = new.asset_id and deleted_at is null;
  if asset_household is null or not exists (
    select 1 from public.assets asset where asset.id = new.asset_id and public.is_space_editor(asset.space_id)
  ) then
    raise exception 'Only an editor of the item space can change profile tags.';
  end if;
  if new.tagged_by_user_id <> auth.uid() then
    raise exception 'Profile tags must identify the signed-in editor.';
  end if;
  if not exists (select 1 from public.family_profiles where id = new.profile_id and household_id = asset_household) then
    raise exception 'A profile tag must belong to the same household as the item.';
  end if;
  return new;
end;
$$;

create trigger asset_people_guard_write
before insert on public.asset_people
for each row execute procedure public.validate_asset_person_write();

create or replace function public.audit_asset_person_write()
returns trigger language plpgsql security definer set search_path = public as $$
declare target_asset uuid := coalesce(new.asset_id, old.asset_id);
declare household uuid;
begin
  select household_id into household from public.assets where id = target_asset;
  insert into public.audit_events(household_id, actor_user_id, action, resource_type, resource_id, metadata)
  values (household, auth.uid(), case when tg_op = 'INSERT' then 'update' else 'delete' end, 'asset_profile_tag', target_asset, jsonb_build_object('operation', tg_op, 'profile_id', coalesce(new.profile_id, old.profile_id)));
  return coalesce(new, old);
end;
$$;

create trigger asset_people_audit
after insert or delete on public.asset_people
for each row execute procedure public.audit_asset_person_write();

-- A controlled share creates a separate asset. Copy only descriptive profile tags; destination-space RLS is still the access boundary.
create or replace function public.copy_asset_profile_tags_to_shared_copy()
returns trigger language plpgsql security definer set search_path = public as $$
begin
  insert into public.asset_people(asset_id, profile_id, tagged_by_user_id)
  select new.shared_asset_id, source_tag.profile_id, new.shared_by_user_id
  from public.asset_people source_tag
  where source_tag.asset_id = new.source_asset_id
  on conflict (asset_id, profile_id) do nothing;
  return new;
end;
$$;

create trigger asset_shares_copy_profile_tags
after insert on public.asset_shares
for each row execute procedure public.copy_asset_profile_tags_to_shared_copy();

alter table public.asset_people enable row level security;

create policy "asset people: item members read" on public.asset_people
for select to authenticated using (exists (select 1 from public.assets asset where asset.id = asset_id and asset.deleted_at is null and public.is_space_member(asset.space_id)));

create policy "asset people: item editors tag" on public.asset_people
for insert to authenticated with check (tagged_by_user_id = auth.uid() and exists (select 1 from public.assets asset where asset.id = asset_id and asset.deleted_at is null and public.is_space_editor(asset.space_id)));

create policy "asset people: item editors remove tag" on public.asset_people
for delete to authenticated using (exists (select 1 from public.assets asset where asset.id = asset_id and asset.deleted_at is null and public.is_space_editor(asset.space_id)));

grant select, insert, delete on public.asset_people to authenticated;

commit;
