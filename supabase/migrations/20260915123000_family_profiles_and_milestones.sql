begin;

-- Profiles represent family members without an account. A profile never grants sign-in or inherited access.
create unique index family_profiles_household_name_idx
  on public.family_profiles(household_id, lower(display_name));

create or replace function public.is_household_owner(target_household_id uuid)
returns boolean language sql stable security definer set search_path = public as $$
  select exists (
    select 1 from public.household_members
    where household_id = target_household_id
      and user_id = auth.uid()
      and role = 'owner'
      and revoked_at is null
  );
$$;

create or replace function public.create_family_profile_with_milestone(
  profile_name text,
  kind public.profile_type,
  profile_birth_date date default null,
  guardian_user_ids uuid[] default array[]::uuid[],
  publish_birthday boolean default false
)
returns public.family_profiles
language plpgsql
security definer
set search_path = public
as $$
declare
  household uuid;
  new_profile public.family_profiles;
  profile_space uuid;
  family_calendar uuid;
  guardian_id uuid;
  birthday_year integer;
begin
  select household_id into household
  from public.household_members
  where user_id = auth.uid() and revoked_at is null
  limit 1;

  if household is null or not public.is_household_owner(household) then
    raise exception 'Only the household owner can create a family profile.';
  end if;

  if kind not in ('child', 'dependent') then
    raise exception 'Profiles created here must be a child or dependant.';
  end if;

  if char_length(btrim(profile_name)) not between 1 and 120 then
    raise exception 'Give the profile a name between 1 and 120 characters.';
  end if;

  if profile_birth_date is not null and profile_birth_date > current_date then
    raise exception 'A birth date cannot be in the future.';
  end if;

  if exists (select 1 from public.family_profiles where household_id = household and lower(display_name) = lower(btrim(profile_name))) then
    raise exception 'A profile with this name already exists in this household.';
  end if;

  foreach guardian_id in array guardian_user_ids loop
    if not exists (
      select 1 from public.household_members
      where household_id = household and user_id = guardian_id and revoked_at is null
    ) then
      raise exception 'Every guardian must be a current household member.';
    end if;
  end loop;

  if not auth.uid() = any(guardian_user_ids) then
    guardian_user_ids := array_append(guardian_user_ids, auth.uid());
  end if;

  insert into public.family_profiles(household_id, profile_type, display_name, birth_date)
  values (household, kind, btrim(profile_name), profile_birth_date)
  returning * into new_profile;

  insert into public.spaces(household_id, profile_id, space_type, name)
  values (household, new_profile.id, 'profile', new_profile.display_name || '''s profile space')
  returning id into profile_space;

  foreach guardian_id in array guardian_user_ids loop
    insert into public.profile_guardians(profile_id, user_id, granted_by_user_id)
    values (new_profile.id, guardian_id, auth.uid())
    on conflict (profile_id, user_id) do update set revoked_at = null, granted_by_user_id = excluded.granted_by_user_id, granted_at = now();

    insert into public.space_memberships(space_id, user_id, role, granted_by_user_id)
    values (profile_space, guardian_id, case when guardian_id = auth.uid() then 'owner'::public.space_role else 'editor'::public.space_role end, auth.uid())
    on conflict (space_id, user_id) do update set revoked_at = null, role = excluded.role, granted_by_user_id = excluded.granted_by_user_id, granted_at = now();
  end loop;

  if publish_birthday and profile_birth_date is not null then
    select id into family_calendar from public.calendars where household_id = household limit 1;
    if family_calendar is not null then
      birthday_year := extract(year from current_date)::integer;
      insert into public.calendar_events(calendar_id, created_by_user_id, title, event_kind, starts_at, ends_at, all_day, timezone, recurrence_frequency, recurrence_interval, related_profile_id)
      values (
        family_calendar, auth.uid(), new_profile.display_name || '''s birthday', 'birthday',
        make_timestamptz(birthday_year, extract(month from profile_birth_date)::integer, extract(day from profile_birth_date)::integer, 0, 0, 0, 'UTC'),
        make_timestamptz(birthday_year, extract(month from profile_birth_date)::integer, extract(day from profile_birth_date)::integer, 23, 59, 0, 'UTC'),
        true, 'UTC', 'yearly', 1, new_profile.id
      );
    end if;
  end if;

  insert into public.audit_events(household_id, actor_user_id, action, resource_type, resource_id, metadata)
  values (household, auth.uid(), 'create', 'family_profile', new_profile.id, jsonb_build_object('profile_type', kind, 'profile_space_id', profile_space, 'birthday_published', publish_birthday and profile_birth_date is not null));

  return new_profile;
end;
$$;

create or replace function public.update_family_profile_guardians(profile_id uuid, guardian_user_ids uuid[])
returns void
language plpgsql
security definer
set search_path = public
as $$
declare
  target public.family_profiles;
  profile_space uuid;
  guardian_id uuid;
begin
  select * into target from public.family_profiles where id = profile_id for update;
  if not found or not public.is_household_owner(target.household_id) then
    raise exception 'Only the household owner can manage guardians.';
  end if;
  if not auth.uid() = any(guardian_user_ids) then guardian_user_ids := array_append(guardian_user_ids, auth.uid()); end if;
  foreach guardian_id in array guardian_user_ids loop
    if not exists (select 1 from public.household_members where household_id = target.household_id and user_id = guardian_id and revoked_at is null) then
      raise exception 'Every guardian must be a current household member.';
    end if;
  end loop;
  select id into profile_space from public.spaces where profile_id = target.id and space_type = 'profile';
  update public.profile_guardians set revoked_at = now() where profile_id = target.id and user_id <> all(guardian_user_ids) and revoked_at is null;
  update public.space_memberships set revoked_at = now() where space_id = profile_space and user_id <> all(guardian_user_ids) and revoked_at is null;
  foreach guardian_id in array guardian_user_ids loop
    insert into public.profile_guardians(profile_id, user_id, granted_by_user_id) values(target.id, guardian_id, auth.uid()) on conflict(profile_id, user_id) do update set revoked_at = null, granted_by_user_id = excluded.granted_by_user_id, granted_at = now();
    insert into public.space_memberships(space_id, user_id, role, granted_by_user_id) values(profile_space, guardian_id, case when guardian_id = auth.uid() then 'owner'::public.space_role else 'editor'::public.space_role end, auth.uid()) on conflict(space_id, user_id) do update set revoked_at = null, role = excluded.role, granted_by_user_id = excluded.granted_by_user_id, granted_at = now();
  end loop;
  insert into public.audit_events(household_id, actor_user_id, action, resource_type, resource_id, metadata) values(target.household_id, auth.uid(), 'update', 'profile_guardians', target.id, jsonb_build_object('guardian_count', cardinality(guardian_user_ids)));
end;
$$;

create or replace function public.update_family_profile_details(profile_id uuid, profile_name text, profile_birth_date date)
returns public.family_profiles
language plpgsql security definer set search_path = public as $$
declare target public.family_profiles;
begin
  select * into target from public.family_profiles where id = profile_id for update;
  if not found or not public.is_household_owner(target.household_id) then raise exception 'Only the household owner can update a family profile.'; end if;
  if char_length(btrim(profile_name)) not between 1 and 120 then raise exception 'Give the profile a name between 1 and 120 characters.'; end if;
  if profile_birth_date is not null and profile_birth_date > current_date then raise exception 'A birth date cannot be in the future.'; end if;
  update public.family_profiles set display_name = btrim(profile_name), birth_date = profile_birth_date, updated_at = now() where id = target.id returning * into target;
  update public.spaces set name = target.display_name || '''s profile space', updated_at = now() where profile_id = target.id and space_type = 'profile';
  insert into public.audit_events(household_id, actor_user_id, action, resource_type, resource_id, metadata) values(target.household_id, auth.uid(), 'update', 'family_profile', target.id, '{}'::jsonb);
  return target;
end;
$$;

-- Profile and guardian visibility becomes precise: household members can see profiles, but only guardians see guardian assignments and profile-space records.
drop policy "family profiles: guardian read" on public.family_profiles;
create policy "family profiles: household member read" on public.family_profiles for select to authenticated using (public.is_household_member(household_id));
create policy "profile guardians: profile guardian read" on public.profile_guardians for select to authenticated using (exists (select 1 from public.family_profiles fp where fp.id = profile_id and public.is_household_member(fp.household_id)));

revoke insert, update, delete on public.family_profiles, public.profile_guardians from authenticated;
grant execute on function public.create_family_profile_with_milestone(text, public.profile_type, date, uuid[], boolean) to authenticated;
grant execute on function public.update_family_profile_guardians(uuid, uuid[]) to authenticated;
grant execute on function public.update_family_profile_details(uuid, text, date) to authenticated;

commit;
