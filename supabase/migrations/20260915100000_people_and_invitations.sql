-- Explicit household invitations and Family Space access. Invitations never grant My Vault access.

begin;

create type public.household_invitation_status as enum ('pending', 'accepted', 'revoked', 'expired');

create table public.household_invitations (
  id uuid primary key default gen_random_uuid(),
  household_id uuid not null references public.households(id) on delete cascade,
  invited_email text not null check (invited_email = lower(btrim(invited_email)) and invited_email ~ '^[^@[:space:]]+@[^@[:space:]]+\.[^@[:space:]]+$'),
  invited_by_user_id uuid not null references public.profiles(id) on delete restrict,
  household_role public.household_role not null default 'adult_member' check (household_role in ('adult_member', 'viewer')),
  family_space_role public.space_role not null default 'editor' check (family_space_role in ('editor', 'viewer')),
  status public.household_invitation_status not null default 'pending',
  expires_at timestamptz not null default (now() + interval '14 days'),
  accepted_at timestamptz,
  accepted_by_user_id uuid references public.profiles(id) on delete set null,
  revoked_at timestamptz,
  revoked_by_user_id uuid references public.profiles(id) on delete set null,
  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now(),
  check ((status = 'accepted') = (accepted_at is not null)),
  check ((status = 'revoked') = (revoked_at is not null))
);

create unique index household_invitations_one_pending_email_idx
  on public.household_invitations(household_id, invited_email) where status = 'pending';
create index household_invitations_email_status_idx
  on public.household_invitations(invited_email, status, expires_at);

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

create or replace function public.create_household_invitation(
  invite_email text,
  invited_household_role public.household_role default 'adult_member',
  invited_family_space_role public.space_role default 'editor'
)
returns public.household_invitations
language plpgsql security definer set search_path = public as $$
declare
  current_user uuid := auth.uid();
  target_household uuid;
  clean_email text := lower(btrim(invite_email));
  invitation public.household_invitations;
begin
  if current_user is null then raise exception 'You must be signed in to invite someone.'; end if;
  if clean_email !~ '^[^@[:space:]]+@[^@[:space:]]+\.[^@[:space:]]+$' then raise exception 'Enter a valid email address.'; end if;
  if invited_household_role not in ('adult_member', 'viewer') or invited_family_space_role not in ('editor', 'viewer') then raise exception 'Choose a valid shared-space access level.'; end if;

  select household_id into target_household from public.household_members
    where user_id = current_user and role = 'owner' and revoked_at is null limit 1;
  if target_household is null then raise exception 'Only the household owner can invite people.'; end if;
  if clean_email = lower(coalesce(auth.jwt() ->> 'email', '')) then raise exception 'You are already in this household.'; end if;
  if exists (
    select 1 from auth.users u join public.household_members hm on hm.user_id = u.id
    where lower(u.email) = clean_email and hm.household_id = target_household and hm.revoked_at is null
  ) then raise exception 'This email already has access to your household.'; end if;

  update public.household_invitations
    set status = 'expired', updated_at = now()
    where household_id = target_household and invited_email = clean_email and status = 'pending';

  insert into public.household_invitations (household_id, invited_email, invited_by_user_id, household_role, family_space_role)
  values (target_household, clean_email, current_user, invited_household_role, invited_family_space_role)
  returning * into invitation;

  insert into public.audit_events(household_id, actor_user_id, action, resource_type, resource_id, metadata)
  values (target_household, current_user, 'share', 'household_invitation', invitation.id,
    jsonb_build_object('invited_email', clean_email, 'family_space_role', invited_family_space_role, 'household_role', invited_household_role));
  return invitation;
end;
$$;

create or replace function public.list_my_pending_household_invitations()
returns table (
  id uuid, household_id uuid, household_name text, invited_email text,
  household_role public.household_role, family_space_role public.space_role, expires_at timestamptz
)
language sql stable security definer set search_path = public as $$
  select i.id, i.household_id, h.name, i.invited_email, i.household_role, i.family_space_role, i.expires_at
  from public.household_invitations i
  join public.households h on h.id = i.household_id
  where i.status = 'pending'
    and i.expires_at > now()
    and i.invited_email = lower(coalesce(auth.jwt() ->> 'email', ''));
$$;

create or replace function public.accept_household_invitation(invitation_id uuid)
returns uuid language plpgsql security definer set search_path = public as $$
declare
  current_user uuid := auth.uid();
  invitation public.household_invitations;
  family_space uuid;
begin
  if current_user is null then raise exception 'You must be signed in to accept an invitation.'; end if;
  select * into invitation from public.household_invitations
    where id = invitation_id and status = 'pending' and expires_at > now()
      and invited_email = lower(coalesce(auth.jwt() ->> 'email', ''))
    for update;
  if invitation.id is null then raise exception 'This invitation is no longer available for this account.'; end if;
  if exists (select 1 from public.household_members where user_id = current_user and revoked_at is null and household_id <> invitation.household_id) then
    raise exception 'This account already belongs to another household.';
  end if;
  select id into family_space from public.spaces where household_id = invitation.household_id and space_type = 'family' limit 1;
  if family_space is null then raise exception 'The Family Space is unavailable. Ask the owner to try again.'; end if;

  insert into public.household_members(household_id, user_id, role, revoked_at)
  values (invitation.household_id, current_user, invitation.household_role, null)
  on conflict (household_id, user_id) do update set role = excluded.role, revoked_at = null, joined_at = now();
  insert into public.space_memberships(space_id, user_id, role, granted_by_user_id, revoked_at)
  values (family_space, current_user, invitation.family_space_role, invitation.invited_by_user_id, null)
  on conflict (space_id, user_id) do update set role = excluded.role, granted_by_user_id = excluded.granted_by_user_id, granted_at = now(), revoked_at = null;
  update public.household_invitations set status = 'accepted', accepted_at = now(), accepted_by_user_id = current_user, updated_at = now() where id = invitation.id;
  insert into public.audit_events(household_id, actor_user_id, action, resource_type, resource_id, metadata)
  values (invitation.household_id, current_user, 'share', 'household_invitation', invitation.id,
    jsonb_build_object('accepted', true, 'family_space_role', invitation.family_space_role));
  return invitation.household_id;
end;
$$;

create or replace function public.revoke_household_invitation(invitation_id uuid)
returns void language plpgsql security definer set search_path = public as $$
declare invitation public.household_invitations;
begin
  select * into invitation from public.household_invitations where id = invitation_id for update;
  if invitation.id is null or not public.is_household_owner(invitation.household_id) then raise exception 'Only the household owner can revoke this invitation.'; end if;
  if invitation.status <> 'pending' then raise exception 'Only pending invitations can be revoked.'; end if;
  update public.household_invitations set status = 'revoked', revoked_at = now(), revoked_by_user_id = auth.uid(), updated_at = now() where id = invitation.id;
  insert into public.audit_events(household_id, actor_user_id, action, resource_type, resource_id, metadata)
  values (invitation.household_id, auth.uid(), 'revoke', 'household_invitation', invitation.id, jsonb_build_object('invited_email', invitation.invited_email));
end;
$$;

create or replace function public.revoke_household_member(member_user_id uuid)
returns void language plpgsql security definer set search_path = public as $$
declare target_household uuid; target_role public.household_role;
begin
  select household_id into target_household from public.household_members where user_id = auth.uid() and role = 'owner' and revoked_at is null limit 1;
  if target_household is null then raise exception 'Only the household owner can remove members.'; end if;
  select role into target_role from public.household_members where household_id = target_household and user_id = member_user_id and revoked_at is null;
  if target_role is null then raise exception 'This person is not an active household member.'; end if;
  if target_role = 'owner' then raise exception 'The household owner cannot be removed.'; end if;
  update public.household_members set revoked_at = now() where household_id = target_household and user_id = member_user_id;
  update public.space_memberships sm set revoked_at = now()
    where sm.user_id = member_user_id and revoked_at is null and exists (select 1 from public.spaces s where s.id = sm.space_id and s.household_id = target_household and s.space_type <> 'private_vault');
  insert into public.audit_events(household_id, actor_user_id, action, resource_type, resource_id, metadata)
  values (target_household, auth.uid(), 'revoke', 'household_member', member_user_id, jsonb_build_object('all_shared_space_access_revoked', true));
end;
$$;

alter table public.household_invitations enable row level security;
create policy "household invitations: owner reads" on public.household_invitations for select to authenticated using (public.is_household_owner(household_id));
create policy "household invitations: invited email reads" on public.household_invitations for select to authenticated using (status = 'pending' and expires_at > now() and invited_email = lower(coalesce(auth.jwt() ->> 'email', '')));

revoke all on function public.create_household_invitation(text, public.household_role, public.space_role) from public;
revoke all on function public.list_my_pending_household_invitations() from public;
revoke all on function public.accept_household_invitation(uuid) from public;
revoke all on function public.revoke_household_invitation(uuid) from public;
revoke all on function public.revoke_household_member(uuid) from public;
grant execute on function public.create_household_invitation(text, public.household_role, public.space_role) to authenticated;
grant execute on function public.list_my_pending_household_invitations() to authenticated;
grant execute on function public.accept_household_invitation(uuid) to authenticated;
grant execute on function public.revoke_household_invitation(uuid) to authenticated;
grant execute on function public.revoke_household_member(uuid) to authenticated;

commit;
