begin;

create table public.asset_shares (
  id uuid primary key default gen_random_uuid(),
  household_id uuid not null references public.households(id) on delete cascade,
  source_asset_id uuid not null references public.assets(id) on delete restrict,
  shared_asset_id uuid not null unique references public.assets(id) on delete restrict,
  destination_space_id uuid not null references public.spaces(id) on delete restrict,
  shared_by_user_id uuid not null references public.profiles(id) on delete restrict,
  shared_storage_path text not null unique check (shared_storage_path ~ '^[0-9a-f-]+/[0-9a-f-]+/.+'),
  created_at timestamptz not null default now(),
  revoked_at timestamptz,
  revoked_by_user_id uuid references public.profiles(id) on delete set null,
  check (source_asset_id <> shared_asset_id)
);

create unique index asset_shares_active_source_destination_idx
  on public.asset_shares(source_asset_id, destination_space_id)
  where revoked_at is null;

alter table public.asset_shares enable row level security;

create policy "asset shares: source owner or destination member read"
  on public.asset_shares for select to authenticated
  using (
    public.is_space_member(destination_space_id)
    or exists (
      select 1 from public.assets source_asset
      where source_asset.id = source_asset_id
        and source_asset.uploaded_by_user_id = auth.uid()
        and public.is_space_member(source_asset.space_id)
    )
  );

-- Tighten metadata edits to the uploader. Sharing has its own validated RPC below.
drop policy "assets: space editor update" on public.assets;
create policy "assets: uploader update"
  on public.assets for update to authenticated
  using (uploaded_by_user_id = auth.uid() and public.is_space_editor(space_id))
  with check (uploaded_by_user_id = auth.uid() and public.is_space_editor(space_id));

create or replace function public.share_asset_to_space(
  source_asset_id uuid,
  destination_space_id uuid,
  shared_storage_path text
)
returns public.asset_shares
language plpgsql
security definer
set search_path = public
as $$
declare
  source_asset public.assets;
  destination public.spaces;
  copied_asset public.assets;
  created_share public.asset_shares;
begin
  select * into source_asset
  from public.assets
  where id = source_asset_id and deleted_at is null
  for update;

  if not found then
    raise exception 'The original item is no longer available.';
  end if;

  if source_asset.uploaded_by_user_id <> auth.uid() then
    raise exception 'Only the person who saved this item can share it.';
  end if;

  if not public.is_space_member(source_asset.space_id) then
    raise exception 'You no longer have access to the original item.';
  end if;

  select * into destination
  from public.spaces
  where id = destination_space_id
    and household_id = source_asset.household_id;

  if not found or destination.space_type = 'private_vault' then
    raise exception 'Choose a shared Family Space destination.';
  end if;

  if not public.is_space_editor(destination_space_id) then
    raise exception 'You need contributor access to that shared space.';
  end if;

  if shared_storage_path !~ ('^' || source_asset.household_id::text || '/' || destination_space_id::text || '/.+') then
    raise exception 'The shared file must be stored in the selected destination space.';
  end if;

  if exists (
    select 1 from public.asset_shares
    where source_asset_id = source_asset.id
      and destination_space_id = destination_space_id
      and revoked_at is null
  ) then
    raise exception 'This item is already shared with that space.';
  end if;

  insert into public.assets (
    household_id, space_id, uploaded_by_user_id, asset_type, storage_path,
    content_sha256, media_created_at, filename, mime_type, byte_size
  ) values (
    source_asset.household_id, destination_space_id, auth.uid(), source_asset.asset_type,
    shared_storage_path, source_asset.content_sha256, source_asset.media_created_at,
    source_asset.filename, source_asset.mime_type, source_asset.byte_size
  ) returning * into copied_asset;

  insert into public.asset_shares (
    household_id, source_asset_id, shared_asset_id, destination_space_id,
    shared_by_user_id, shared_storage_path
  ) values (
    source_asset.household_id, source_asset.id, copied_asset.id, destination_space_id,
    auth.uid(), shared_storage_path
  ) returning * into created_share;

  insert into public.audit_events (household_id, actor_user_id, action, resource_type, resource_id, metadata)
  values (
    source_asset.household_id, auth.uid(), 'share', 'asset', source_asset.id,
    jsonb_build_object('shared_asset_id', copied_asset.id, 'destination_space_id', destination_space_id)
  );

  return created_share;
end;
$$;

create or replace function public.revoke_asset_share(asset_share_id uuid)
returns void
language plpgsql
security definer
set search_path = public
as $$
declare
  share_record public.asset_shares;
begin
  select * into share_record
  from public.asset_shares
  where id = asset_share_id and revoked_at is null
  for update;

  if not found then
    raise exception 'This shared copy has already been removed.';
  end if;

  if share_record.shared_by_user_id <> auth.uid() then
    raise exception 'Only the person who shared this item can remove the shared copy.';
  end if;

  update public.asset_shares
  set revoked_at = now(), revoked_by_user_id = auth.uid()
  where id = share_record.id;

  update public.assets
  set deleted_at = now()
  where id = share_record.shared_asset_id and deleted_at is null;

  insert into public.audit_events (household_id, actor_user_id, action, resource_type, resource_id, metadata)
  values (
    share_record.household_id, auth.uid(), 'revoke', 'asset_share', share_record.id,
    jsonb_build_object('source_asset_id', share_record.source_asset_id, 'shared_asset_id', share_record.shared_asset_id)
  );
end;
$$;

grant select on public.asset_shares to authenticated;
grant execute on function public.share_asset_to_space(uuid, uuid, text) to authenticated;
grant execute on function public.revoke_asset_share(uuid) to authenticated;

commit;
