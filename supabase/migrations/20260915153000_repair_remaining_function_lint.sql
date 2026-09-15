-- Final legacy ambiguity repairs. Keep the original RPC signatures for existing clients.
begin;

create or replace function public.update_family_profile_guardians(profile_id uuid, guardian_user_ids uuid[])
returns void language plpgsql security definer set search_path = public as $$
#variable_conflict use_column
declare target public.family_profiles; profile_space_id uuid; guardian_id uuid;
begin
  select * into target from public.family_profiles fp where fp.id = $1 for update;
  if not found or not public.is_household_owner(target.household_id) then raise exception 'Only the household owner can manage guardians.'; end if;
  if not auth.uid() = any(guardian_user_ids) then guardian_user_ids := array_append(guardian_user_ids, auth.uid()); end if;
  foreach guardian_id in array guardian_user_ids loop
    if not exists (select 1 from public.household_members hm where hm.household_id=target.household_id and hm.user_id=guardian_id and hm.revoked_at is null) then raise exception 'Every guardian must be a current household member.'; end if;
  end loop;
  select s.id into profile_space_id from public.spaces s where s.profile_id=target.id and s.space_type='profile';
  update public.profile_guardians pg set revoked_at=now() where pg.profile_id=target.id and pg.user_id<>all(guardian_user_ids) and pg.revoked_at is null;
  update public.space_memberships sm set revoked_at=now() where sm.space_id=profile_space_id and sm.user_id<>all(guardian_user_ids) and sm.revoked_at is null;
  foreach guardian_id in array guardian_user_ids loop
    insert into public.profile_guardians(profile_id,user_id,granted_by_user_id) values(target.id,guardian_id,auth.uid()) on conflict(profile_id,user_id) do update set revoked_at=null,granted_by_user_id=excluded.granted_by_user_id,granted_at=now();
    insert into public.space_memberships(space_id,user_id,role,granted_by_user_id) values(profile_space_id,guardian_id,case when guardian_id=auth.uid() then 'owner'::public.space_role else 'editor'::public.space_role end,auth.uid()) on conflict(space_id,user_id) do update set revoked_at=null,role=excluded.role,granted_by_user_id=excluded.granted_by_user_id,granted_at=now();
  end loop;
  insert into public.audit_events(household_id,actor_user_id,action,resource_type,resource_id,metadata) values(target.household_id,auth.uid(),'update','profile_guardians',target.id,jsonb_build_object('guardian_count',cardinality(guardian_user_ids)));
end;
$$;

create or replace function public.share_asset_to_space(source_asset_id uuid, destination_space_id uuid, shared_storage_path text)
returns public.asset_shares language plpgsql security definer set search_path=public as $$
declare source_asset public.assets; destination public.spaces; copied_asset public.assets; created_share public.asset_shares;
begin
  select * into source_asset from public.assets a where a.id=$1 and a.deleted_at is null for update;
  if not found then raise exception 'The original item is no longer available.'; end if;
  if source_asset.uploaded_by_user_id<>auth.uid() then raise exception 'Only the person who saved this item can share it.'; end if;
  if not public.is_space_member(source_asset.space_id) then raise exception 'You no longer have access to the original item.'; end if;
  select * into destination from public.spaces s where s.id=$2 and s.household_id=source_asset.household_id;
  if not found or destination.space_type='private_vault' then raise exception 'Choose a shared Family Space destination.'; end if;
  if not public.is_space_editor(destination.id) then raise exception 'You need contributor access to that shared space.'; end if;
  if $3 !~ ('^' || source_asset.household_id::text || '/' || destination.id::text || '/.+') then raise exception 'The shared file must be stored in the selected destination space.'; end if;
  if exists(select 1 from public.asset_shares ash where ash.source_asset_id=source_asset.id and ash.destination_space_id=destination.id and ash.revoked_at is null) then raise exception 'This item is already shared with that space.'; end if;
  insert into public.assets(household_id,space_id,uploaded_by_user_id,asset_type,storage_path,content_sha256,media_created_at,filename,mime_type,byte_size) values(source_asset.household_id,destination.id,auth.uid(),source_asset.asset_type,$3,source_asset.content_sha256,source_asset.media_created_at,source_asset.filename,source_asset.mime_type,source_asset.byte_size) returning * into copied_asset;
  insert into public.asset_shares(household_id,source_asset_id,shared_asset_id,destination_space_id,shared_by_user_id,shared_storage_path) values(source_asset.household_id,source_asset.id,copied_asset.id,destination.id,auth.uid(),$3) returning * into created_share;
  insert into public.audit_events(household_id,actor_user_id,action,resource_type,resource_id,metadata) values(source_asset.household_id,auth.uid(),'share','asset',source_asset.id,jsonb_build_object('shared_asset_id',copied_asset.id,'destination_space_id',destination.id));
  return created_share;
end;
$$;

commit;
