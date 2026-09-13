-- Backfill an application profile for authenticated accounts created before the
-- profile trigger was installed. This keeps household onboarding recoverable.

begin;

create or replace function public.create_household_with_default_spaces(household_name text)
returns table (
  household_id uuid,
  private_space_id uuid,
  family_space_id uuid
)
language plpgsql
security definer
set search_path = public
as $$
declare
  current_user_id uuid := auth.uid();
  clean_name text := btrim(household_name);
  created_household_id uuid;
  created_private_space_id uuid;
  created_family_space_id uuid;
  profile_name text := coalesce(
    nullif(btrim(auth.jwt() -> 'user_metadata' ->> 'full_name'), ''),
    nullif(btrim(auth.jwt() -> 'user_metadata' ->> 'name'), ''),
    nullif(split_part(auth.jwt() ->> 'email', '@', 1), ''),
    'Family member'
  );
begin
  if current_user_id is null then
    raise exception 'You must be signed in to create a household.';
  end if;

  if clean_name is null or char_length(clean_name) < 1 or char_length(clean_name) > 120 then
    raise exception 'Household name must be between 1 and 120 characters.';
  end if;

  insert into public.profiles (id, display_name)
  values (current_user_id, left(profile_name, 120))
  on conflict (id) do nothing;

  if exists (
    select 1 from public.household_members
    where user_id = current_user_id and revoked_at is null
  ) then
    raise exception 'You already belong to a household.';
  end if;

  insert into public.households (name)
  values (clean_name)
  returning id into created_household_id;

  insert into public.household_members (household_id, user_id, role)
  values (created_household_id, current_user_id, 'owner');

  insert into public.spaces (household_id, space_type, name)
  values (created_household_id, 'private_vault', 'My Vault')
  returning id into created_private_space_id;

  insert into public.spaces (household_id, space_type, name)
  values (created_household_id, 'family', 'Family Space')
  returning id into created_family_space_id;

  insert into public.space_memberships (space_id, user_id, role, granted_by_user_id)
  values
    (created_private_space_id, current_user_id, 'owner', current_user_id),
    (created_family_space_id, current_user_id, 'owner', current_user_id);

  insert into public.audit_events (household_id, actor_user_id, action, resource_type, resource_id, metadata)
  values
    (created_household_id, current_user_id, 'create', 'household', created_household_id, jsonb_build_object('name', clean_name)),
    (created_household_id, current_user_id, 'create', 'space', created_private_space_id, jsonb_build_object('space_type', 'private_vault')),
    (created_household_id, current_user_id, 'create', 'space', created_family_space_id, jsonb_build_object('space_type', 'family'));

  return query select created_household_id, created_private_space_id, created_family_space_id;
end;
$$;

revoke all on function public.create_household_with_default_spaces(text) from public;
grant execute on function public.create_household_with_default_spaces(text) to authenticated;

commit;
