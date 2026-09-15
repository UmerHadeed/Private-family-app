-- Privacy requests are durable records, not fabricated downloads or destructive jobs.
-- A separate, privileged worker may review/process pending requests. This migration never deletes storage objects.

begin;

create type public.privacy_request_status as enum ('pending', 'withdrawn', 'reviewed', 'completed', 'rejected');

create table public.privacy_export_requests (
  id uuid primary key default gen_random_uuid(),
  requester_user_id uuid not null references public.profiles(id) on delete cascade,
  household_id uuid not null references public.households(id) on delete cascade,
  status public.privacy_request_status not null default 'pending',
  requested_at timestamptz not null default now(),
  withdrawn_at timestamptz,
  withdrawn_by_user_id uuid references public.profiles(id) on delete set null,
  reviewed_at timestamptz,
  reviewed_by_user_id uuid references public.profiles(id) on delete set null,
  completed_at timestamptz,
  check ((status = 'withdrawn') = (withdrawn_at is not null)),
  check (withdrawn_by_user_id is null or withdrawn_by_user_id = requester_user_id)
);

-- This is an authorization snapshot, not an archive and not a storage copy.
-- A worker must still handle files deliberately and must not expose an archive URL until it exists.
create table public.privacy_export_request_assets (
  export_request_id uuid not null references public.privacy_export_requests(id) on delete cascade,
  asset_id uuid not null references public.assets(id) on delete restrict,
  storage_path text not null,
  filename text not null,
  mime_type text not null,
  byte_size bigint not null check (byte_size >= 0),
  primary key (export_request_id, asset_id)
);

create table public.privacy_deletion_requests (
  id uuid primary key default gen_random_uuid(),
  requester_user_id uuid not null references public.profiles(id) on delete cascade,
  household_id uuid not null references public.households(id) on delete cascade,
  asset_id uuid not null references public.assets(id) on delete restrict,
  status public.privacy_request_status not null default 'pending',
  requested_at timestamptz not null default now(),
  withdrawn_at timestamptz,
  withdrawn_by_user_id uuid references public.profiles(id) on delete set null,
  reviewed_at timestamptz,
  reviewed_by_user_id uuid references public.profiles(id) on delete set null,
  completed_at timestamptz,
  check ((status = 'withdrawn') = (withdrawn_at is not null)),
  check (withdrawn_by_user_id is null or withdrawn_by_user_id = requester_user_id)
);

create unique index privacy_export_requests_one_pending_per_household_idx
  on public.privacy_export_requests(requester_user_id, household_id)
  where status = 'pending';
create unique index privacy_deletion_requests_one_pending_per_asset_idx
  on public.privacy_deletion_requests(requester_user_id, asset_id)
  where status = 'pending';
create index privacy_export_requests_requester_idx on public.privacy_export_requests(requester_user_id, requested_at desc);
create index privacy_deletion_requests_requester_idx on public.privacy_deletion_requests(requester_user_id, requested_at desc);

alter table public.privacy_export_requests enable row level security;
alter table public.privacy_export_request_assets enable row level security;
alter table public.privacy_deletion_requests enable row level security;

create policy "privacy export requests: requester read"
  on public.privacy_export_requests for select to authenticated
  using (requester_user_id = auth.uid());
create policy "privacy export request assets: requester read"
  on public.privacy_export_request_assets for select to authenticated
  using (exists (
    select 1 from public.privacy_export_requests request
    where request.id = export_request_id and request.requester_user_id = auth.uid()
  ));
create policy "privacy deletion requests: requester read"
  on public.privacy_deletion_requests for select to authenticated
  using (requester_user_id = auth.uid());

create or replace function public.request_privacy_export(target_household_id uuid)
returns public.privacy_export_requests
language plpgsql security definer set search_path = public as $$
declare created_request public.privacy_export_requests;
begin
  if auth.uid() is null or not public.is_household_member(target_household_id) then
    raise exception 'You must be an active member of this household to request an export.';
  end if;

  insert into public.privacy_export_requests (requester_user_id, household_id)
  values (auth.uid(), target_household_id)
  returning * into created_request;

  -- Include only assets the requester can currently access through a space, or personally uploaded.
  -- This creates a reviewable manifest only; no archive or signed URL is produced here.
  insert into public.privacy_export_request_assets (
    export_request_id, asset_id, storage_path, filename, mime_type, byte_size
  )
  select created_request.id, asset.id, asset.storage_path, asset.filename, asset.mime_type, asset.byte_size
  from public.assets asset
  where asset.household_id = target_household_id
    and asset.deleted_at is null
    and (asset.uploaded_by_user_id = auth.uid() or public.is_space_member(asset.space_id));

  insert into public.audit_events (household_id, actor_user_id, action, resource_type, resource_id, metadata)
  values (
    target_household_id, auth.uid(), 'export', 'privacy_export_request', created_request.id,
    jsonb_build_object('asset_count', (select count(*) from public.privacy_export_request_assets where export_request_id = created_request.id))
  );
  return created_request;
end;
$$;

create or replace function public.request_privacy_asset_deletion(target_asset_id uuid)
returns public.privacy_deletion_requests
language plpgsql security definer set search_path = public as $$
declare target_asset public.assets;
declare created_request public.privacy_deletion_requests;
begin
  if auth.uid() is null then
    raise exception 'You must be signed in to request deletion.';
  end if;

  select * into target_asset
  from public.assets
  where id = target_asset_id and deleted_at is null
  for update;

  if not found then
    raise exception 'This item is no longer available.';
  end if;
  if target_asset.uploaded_by_user_id <> auth.uid() then
    raise exception 'You can request deletion only for an original item you uploaded.';
  end if;
  if not public.is_space_member(target_asset.space_id) then
    raise exception 'You no longer have access to this item.';
  end if;
  if exists (select 1 from public.asset_shares where shared_asset_id = target_asset.id) then
    raise exception 'Deletion requests are available only for original items, not shared copies.';
  end if;

  insert into public.privacy_deletion_requests (requester_user_id, household_id, asset_id)
  values (auth.uid(), target_asset.household_id, target_asset.id)
  returning * into created_request;

  insert into public.audit_events (household_id, actor_user_id, action, resource_type, resource_id, metadata)
  values (target_asset.household_id, auth.uid(), 'delete', 'privacy_deletion_request', created_request.id,
    jsonb_build_object('asset_id', target_asset.id, 'storage_path', target_asset.storage_path));
  return created_request;
end;
$$;

create or replace function public.withdraw_privacy_request(target_request_type text, target_request_id uuid)
returns void
language plpgsql security definer set search_path = public as $$
declare request_household_id uuid;
begin
  if auth.uid() is null then raise exception 'You must be signed in to withdraw a request.'; end if;

  if target_request_type = 'export' then
    update public.privacy_export_requests
    set status = 'withdrawn', withdrawn_at = now(), withdrawn_by_user_id = auth.uid()
    where id = target_request_id and requester_user_id = auth.uid() and status = 'pending'
    returning household_id into request_household_id;
  elsif target_request_type = 'deletion' then
    update public.privacy_deletion_requests
    set status = 'withdrawn', withdrawn_at = now(), withdrawn_by_user_id = auth.uid()
    where id = target_request_id and requester_user_id = auth.uid() and status = 'pending'
    returning household_id into request_household_id;
  else
    raise exception 'Unknown privacy request type.';
  end if;

  if request_household_id is null then
    raise exception 'Only your pending request can be withdrawn.';
  end if;

  insert into public.audit_events (household_id, actor_user_id, action, resource_type, resource_id, metadata)
  values (request_household_id, auth.uid(), 'revoke', 'privacy_request', target_request_id,
    jsonb_build_object('request_type', target_request_type));
end;
$$;

grant select on public.privacy_export_requests, public.privacy_export_request_assets, public.privacy_deletion_requests to authenticated;
grant execute on function public.request_privacy_export(uuid) to authenticated;
grant execute on function public.request_privacy_asset_deletion(uuid) to authenticated;
grant execute on function public.withdraw_privacy_request(text, uuid) to authenticated;

commit;
