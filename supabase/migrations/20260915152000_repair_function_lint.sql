-- Repair legacy PL/pgSQL parameter/column ambiguity identified by linked schema lint.
begin;

create or replace function public.create_household_invitation(
  invite_email text,
  invited_household_role public.household_role default 'adult_member',
  invited_family_space_role public.space_role default 'editor'
)
returns public.household_invitations
language plpgsql security definer set search_path = public as $$
declare
  actor_user_id uuid := auth.uid();
  target_household_id uuid;
  clean_email text := lower(btrim(invite_email));
  created_invitation public.household_invitations;
begin
  if actor_user_id is null then raise exception 'You must be signed in to invite someone.'; end if;
  if clean_email !~ '^[^@[:space:]]+@[^@[:space:]]+\.[^@[:space:]]+$' then raise exception 'Enter a valid email address.'; end if;
  if invited_household_role not in ('adult_member', 'viewer') or invited_family_space_role not in ('editor', 'viewer') then raise exception 'Choose a valid shared-space access level.'; end if;
  select hm.household_id into target_household_id from public.household_members hm where hm.user_id = actor_user_id and hm.role = 'owner' and hm.revoked_at is null limit 1;
  if target_household_id is null then raise exception 'Only the household owner can invite people.'; end if;
  if clean_email = lower(coalesce(auth.jwt() ->> 'email', '')) then raise exception 'You are already in this household.'; end if;
  if exists (select 1 from auth.users u join public.household_members hm on hm.user_id = u.id where lower(u.email) = clean_email and hm.household_id = target_household_id and hm.revoked_at is null) then raise exception 'This email already has access to your household.'; end if;
  update public.household_invitations i set status = 'expired', updated_at = now() where i.household_id = target_household_id and i.invited_email = clean_email and i.status = 'pending';
  insert into public.household_invitations(household_id, invited_email, invited_by_user_id, household_role, family_space_role) values(target_household_id, clean_email, actor_user_id, invited_household_role, invited_family_space_role) returning * into created_invitation;
  insert into public.audit_events(household_id, actor_user_id, action, resource_type, resource_id, metadata) values(target_household_id, actor_user_id, 'share', 'household_invitation', created_invitation.id, jsonb_build_object('invited_email', clean_email, 'family_space_role', invited_family_space_role, 'household_role', invited_household_role));
  return created_invitation;
end;
$$;

create or replace function public.accept_household_invitation(invitation_id uuid)
returns uuid language plpgsql security definer set search_path = public as $$
declare actor_user_id uuid := auth.uid(); invitation public.household_invitations; family_space_id uuid;
begin
  if actor_user_id is null then raise exception 'You must be signed in to accept an invitation.'; end if;
  select * into invitation from public.household_invitations i where i.id = invitation_id and i.status = 'pending' and i.expires_at > now() and i.invited_email = lower(coalesce(auth.jwt() ->> 'email', '')) for update;
  if invitation.id is null then raise exception 'This invitation is no longer available for this account.'; end if;
  if exists (select 1 from public.household_members hm where hm.user_id = actor_user_id and hm.revoked_at is null and hm.household_id <> invitation.household_id) then raise exception 'This account already belongs to another household.'; end if;
  select s.id into family_space_id from public.spaces s where s.household_id = invitation.household_id and s.space_type = 'family' limit 1;
  if family_space_id is null then raise exception 'The Family Space is unavailable. Ask the owner to try again.'; end if;
  insert into public.household_members(household_id, user_id, role, revoked_at) values(invitation.household_id, actor_user_id, invitation.household_role, null) on conflict(household_id, user_id) do update set role = excluded.role, revoked_at = null, joined_at = now();
  insert into public.space_memberships(space_id, user_id, role, granted_by_user_id, revoked_at) values(family_space_id, actor_user_id, invitation.family_space_role, invitation.invited_by_user_id, null) on conflict(space_id, user_id) do update set role = excluded.role, granted_by_user_id = excluded.granted_by_user_id, granted_at = now(), revoked_at = null;
  update public.household_invitations i set status = 'accepted', accepted_at = now(), accepted_by_user_id = actor_user_id, updated_at = now() where i.id = invitation.id;
  insert into public.audit_events(household_id, actor_user_id, action, resource_type, resource_id, metadata) values(invitation.household_id, actor_user_id, 'share', 'household_invitation', invitation.id, jsonb_build_object('accepted', true, 'family_space_role', invitation.family_space_role));
  return invitation.household_id;
end;
$$;

create or replace function public.update_family_profile_guardians(profile_id uuid, guardian_user_ids uuid[])
returns void language plpgsql security definer set search_path = public as $$
declare target public.family_profiles; profile_space_id uuid; guardian_id uuid;
begin
  select * into target from public.family_profiles fp where fp.id = profile_id for update;
  if not found or not public.is_household_owner(target.household_id) then raise exception 'Only the household owner can manage guardians.'; end if;
  if not auth.uid() = any(guardian_user_ids) then guardian_user_ids := array_append(guardian_user_ids, auth.uid()); end if;
  foreach guardian_id in array guardian_user_ids loop
    if not exists (select 1 from public.household_members hm where hm.household_id = target.household_id and hm.user_id = guardian_id and hm.revoked_at is null) then raise exception 'Every guardian must be a current household member.'; end if;
  end loop;
  select s.id into profile_space_id from public.spaces s where s.profile_id = target.id and s.space_type = 'profile';
  update public.profile_guardians pg set revoked_at = now() where pg.profile_id = target.id and pg.user_id <> all(guardian_user_ids) and pg.revoked_at is null;
  update public.space_memberships sm set revoked_at = now() where sm.space_id = profile_space_id and sm.user_id <> all(guardian_user_ids) and sm.revoked_at is null;
  foreach guardian_id in array guardian_user_ids loop
    insert into public.profile_guardians(profile_id,user_id,granted_by_user_id) values(target.id,guardian_id,auth.uid()) on conflict(profile_id,user_id) do update set revoked_at=null, granted_by_user_id=excluded.granted_by_user_id, granted_at=now();
    insert into public.space_memberships(space_id,user_id,role,granted_by_user_id) values(profile_space_id,guardian_id,case when guardian_id=auth.uid() then 'owner'::public.space_role else 'editor'::public.space_role end,auth.uid()) on conflict(space_id,user_id) do update set revoked_at=null, role=excluded.role, granted_by_user_id=excluded.granted_by_user_id, granted_at=now();
  end loop;
  insert into public.audit_events(household_id,actor_user_id,action,resource_type,resource_id,metadata) values(target.household_id,auth.uid(),'update','profile_guardians',target.id,jsonb_build_object('guardian_count',cardinality(guardian_user_ids)));
end;
$$;

create or replace function public.update_family_profile_details(profile_id uuid, profile_name text, profile_birth_date date)
returns public.family_profiles language plpgsql security definer set search_path = public as $$
declare target public.family_profiles;
begin
  select * into target from public.family_profiles fp where fp.id = profile_id for update;
  if not found or not public.is_household_owner(target.household_id) then raise exception 'Only the household owner can update a family profile.'; end if;
  if char_length(btrim(profile_name)) not between 1 and 120 then raise exception 'Give the profile a name between 1 and 120 characters.'; end if;
  if profile_birth_date is not null and profile_birth_date > current_date then raise exception 'A birth date cannot be in the future.'; end if;
  update public.family_profiles fp set display_name=btrim(profile_name), birth_date=profile_birth_date, updated_at=now() where fp.id=target.id returning * into target;
  update public.spaces s set name=target.display_name || '''s profile space', updated_at=now() where s.profile_id=target.id and s.space_type='profile';
  insert into public.audit_events(household_id,actor_user_id,action,resource_type,resource_id,metadata) values(target.household_id,auth.uid(),'update','family_profile',target.id,'{}'::jsonb);
  return target;
end;
$$;

create or replace function public.create_browser_push_delivery(target_notification_id uuid, target_device_id uuid)
returns public.notification_deliveries language plpgsql security definer set search_path = public as $$
declare device_record public.notification_devices; created_delivery public.notification_deliveries;
begin
  if auth.uid() is null or not public.can_read_notification(target_notification_id, auth.uid()) then raise exception 'This notification is not available to the signed-in recipient.'; end if;
  select * into device_record from public.notification_devices d where d.id=target_device_id and d.user_id=auth.uid() and d.revoked_at is null;
  if device_record.id is null then raise exception 'This browser device is not active for the signed-in recipient.'; end if;
  if not coalesce((select np.browser_push_enabled from public.notification_preferences np where np.user_id=auth.uid() and np.notification_kind=(select n.notification_kind from public.notifications n where n.id=target_notification_id)),false) then raise exception 'Browser push is disabled for this notification type.'; end if;
  insert into public.notification_deliveries(notification_id,device_id,transport,status,attempted_at) values(target_notification_id,target_device_id,'browser_push','pending',now()) returning * into created_delivery;
  return created_delivery;
end;
$$;

commit;
