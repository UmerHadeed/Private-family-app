-- Family notifications: user-owned preferences and browser-push metadata only.
-- Notifications always re-check the recipient's current access before they are exposed or delivered.

begin;

create type public.notification_delivery_status as enum ('pending', 'delivered', 'failed', 'skipped');

create table public.notification_preferences (
  user_id uuid not null references public.profiles(id) on delete cascade,
  notification_kind text not null check (notification_kind ~ '^[a-z][a-z0-9_]{0,63}$'),
  in_app_enabled boolean not null default true,
  browser_push_enabled boolean not null default false,
  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now(),
  primary key (user_id, notification_kind)
);

-- This stores a browser PushSubscription's public metadata only. Sending is deliberately out of scope.
create table public.notification_devices (
  id uuid primary key default gen_random_uuid(),
  user_id uuid not null references public.profiles(id) on delete cascade,
  transport text not null default 'browser_push' check (transport = 'browser_push'),
  push_endpoint text not null unique check (char_length(push_endpoint) between 1 and 4096),
  p256dh_key text not null check (char_length(p256dh_key) between 1 and 1024),
  auth_key text not null check (char_length(auth_key) between 1 and 1024),
  user_agent text check (user_agent is null or char_length(user_agent) <= 1024),
  created_at timestamptz not null default now(),
  last_seen_at timestamptz not null default now(),
  revoked_at timestamptz,
  revoked_by_user_id uuid references public.profiles(id) on delete set null
);

create table public.notifications (
  id uuid primary key default gen_random_uuid(),
  household_id uuid not null references public.households(id) on delete cascade,
  recipient_user_id uuid not null references public.profiles(id) on delete cascade,
  actor_user_id uuid references public.profiles(id) on delete set null,
  source_space_id uuid references public.spaces(id) on delete set null,
  source_owner_user_id uuid references public.profiles(id) on delete set null,
  notification_kind text not null check (notification_kind ~ '^[a-z][a-z0-9_]{0,63}$'),
  source_type text not null check (source_type ~ '^[a-z][a-z0-9_]{0,63}$'),
  source_id uuid,
  title text not null check (char_length(btrim(title)) between 1 and 240),
  body text not null default '' check (char_length(body) <= 1000),
  payload jsonb not null default '{}'::jsonb check (jsonb_typeof(payload) = 'object'),
  created_at timestamptz not null default now(),
  read_at timestamptz,
  archived_at timestamptz
);

create table public.notification_deliveries (
  id uuid primary key default gen_random_uuid(),
  notification_id uuid not null references public.notifications(id) on delete cascade,
  device_id uuid references public.notification_devices(id) on delete set null,
  transport text not null check (transport in ('in_app', 'browser_push')),
  status public.notification_delivery_status not null default 'pending',
  attempted_at timestamptz,
  delivered_at timestamptz,
  failure_code text check (failure_code is null or char_length(failure_code) <= 120),
  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now(),
  check ((status = 'delivered') = (delivered_at is not null)),
  check (not (status = 'delivered' and failure_code is not null))
);

-- Immutable, recipient-scoped audit evidence. It contains no notification body or push credential.
create table public.notification_audit_entries (
  id uuid primary key default gen_random_uuid(),
  notification_id uuid references public.notifications(id) on delete set null,
  household_id uuid not null references public.households(id) on delete cascade,
  recipient_user_id uuid not null references public.profiles(id) on delete cascade,
  actor_user_id uuid references public.profiles(id) on delete set null,
  event_type text not null check (event_type in ('created', 'read', 'archived', 'delivery_created', 'delivery_updated')),
  metadata jsonb not null default '{}'::jsonb check (jsonb_typeof(metadata) = 'object'),
  occurred_at timestamptz not null default now()
);

create index notification_preferences_user_idx on public.notification_preferences(user_id, notification_kind);
create index notification_devices_active_user_idx on public.notification_devices(user_id, last_seen_at desc) where revoked_at is null;
create index notifications_recipient_inbox_idx on public.notifications(recipient_user_id, created_at desc) where archived_at is null;
create index notifications_recipient_unread_idx on public.notifications(recipient_user_id, created_at desc) where read_at is null and archived_at is null;
create index notification_deliveries_notification_idx on public.notification_deliveries(notification_id, created_at desc);
create index notification_audit_entries_recipient_idx on public.notification_audit_entries(recipient_user_id, occurred_at desc);

-- This is intentionally evaluated at read/delivery time, rather than trusting membership at enqueue time.
-- A My Vault event may only remain visible to the vault item's owner; shared-space events require active membership.
create or replace function public.can_receive_notification(
  target_recipient_user_id uuid,
  target_household_id uuid,
  target_source_space_id uuid,
  target_source_owner_user_id uuid
)
returns boolean language sql stable security definer set search_path = public as $$
  select exists (
    select 1
    from public.household_members hm
    where hm.household_id = target_household_id
      and hm.user_id = target_recipient_user_id
      and hm.revoked_at is null
  )
  and (
    target_source_space_id is null
    or exists (
      select 1
      from public.spaces s
      join public.space_memberships sm
        on sm.space_id = s.id
       and sm.user_id = target_recipient_user_id
       and sm.revoked_at is null
      where s.id = target_source_space_id
        and s.household_id = target_household_id
        and (
          s.space_type <> 'private_vault'
          or target_recipient_user_id = target_source_owner_user_id
        )
    )
  );
$$;

create or replace function public.can_read_notification(target_notification_id uuid, target_recipient_user_id uuid)
returns boolean language sql stable security definer set search_path = public as $$
  select exists (
    select 1 from public.notifications n
    where n.id = target_notification_id
      and n.recipient_user_id = target_recipient_user_id
      and n.archived_at is null
      and public.can_receive_notification(n.recipient_user_id, n.household_id, n.source_space_id, n.source_owner_user_id)
  );
$$;

create or replace function public.record_notification_audit(
  target_notification_id uuid,
  target_household_id uuid,
  target_recipient_user_id uuid,
  target_actor_user_id uuid,
  target_event_type text,
  target_metadata jsonb default '{}'::jsonb
)
returns void language plpgsql security definer set search_path = public as $$
begin
  insert into public.notification_audit_entries (
    notification_id, household_id, recipient_user_id, actor_user_id, event_type, metadata
  ) values (
    target_notification_id, target_household_id, target_recipient_user_id, target_actor_user_id,
    target_event_type, coalesce(target_metadata, '{}'::jsonb)
  );
end;
$$;

-- Only trusted database triggers call this function. It still validates the recipient now,
-- so stale fan-out cannot create an inbox row after access has been revoked.
create or replace function public.enqueue_notification(
  target_recipient_user_id uuid,
  target_household_id uuid,
  target_source_space_id uuid,
  target_source_owner_user_id uuid,
  target_actor_user_id uuid,
  target_notification_kind text,
  target_source_type text,
  target_source_id uuid,
  target_title text,
  target_body text default '',
  target_payload jsonb default '{}'::jsonb
)
returns uuid language plpgsql security definer set search_path = public as $$
declare created_notification_id uuid;
begin
  if target_recipient_user_id is null
    or not public.can_receive_notification(target_recipient_user_id, target_household_id, target_source_space_id, target_source_owner_user_id) then
    return null;
  end if;

  if not coalesce((select in_app_enabled from public.notification_preferences where user_id = target_recipient_user_id and notification_kind = target_notification_kind), true) then
    return null;
  end if;

  insert into public.notifications (
    household_id, recipient_user_id, actor_user_id, source_space_id, source_owner_user_id,
    notification_kind, source_type, source_id, title, body, payload
  ) values (
    target_household_id, target_recipient_user_id, target_actor_user_id, target_source_space_id, target_source_owner_user_id,
    target_notification_kind, target_source_type, target_source_id, target_title, coalesce(target_body, ''), coalesce(target_payload, '{}'::jsonb)
  ) returning id into created_notification_id;

  perform public.record_notification_audit(
    created_notification_id, target_household_id, target_recipient_user_id, target_actor_user_id, 'created',
    jsonb_build_object('notification_kind', target_notification_kind, 'source_type', target_source_type)
  );
  return created_notification_id;
end;
$$;

create or replace function public.queue_browser_push_deliveries()
returns trigger language plpgsql security definer set search_path = public as $$
declare device_record public.notification_devices;
begin
  if not coalesce((select browser_push_enabled from public.notification_preferences where user_id = new.recipient_user_id and notification_kind = new.notification_kind), false) then
    return new;
  end if;
  for device_record in
    select * from public.notification_devices
    where user_id = new.recipient_user_id and revoked_at is null
  loop
    insert into public.notification_deliveries(notification_id, device_id, transport, status)
    values (new.id, device_record.id, 'browser_push', 'pending');
  end loop;
  return new;
end;
$$;

create trigger notifications_queue_browser_push_deliveries
after insert on public.notifications for each row execute procedure public.queue_browser_push_deliveries();

create or replace function public.audit_notification_delivery_write()
returns trigger language plpgsql security definer set search_path = public as $$
declare notification_record public.notifications;
begin
  select * into notification_record from public.notifications where id = coalesce(new.notification_id, old.notification_id);
  if notification_record.id is not null then
    perform public.record_notification_audit(
      notification_record.id, notification_record.household_id, notification_record.recipient_user_id, auth.uid(),
      case when tg_op = 'INSERT' then 'delivery_created' else 'delivery_updated' end,
      jsonb_build_object('transport', coalesce(new.transport, old.transport), 'status', coalesce(new.status, old.status))
    );
  end if;
  return coalesce(new, old);
end;
$$;

create trigger notification_deliveries_audit
after insert or update on public.notification_deliveries
for each row execute procedure public.audit_notification_delivery_write();

create or replace function public.mark_notification_read(target_notification_id uuid)
returns public.notifications language plpgsql security definer set search_path = public as $$
declare changed_notification public.notifications;
begin
  if auth.uid() is null or not public.can_read_notification(target_notification_id, auth.uid()) then
    raise exception 'This notification is not available to the signed-in recipient.';
  end if;

  update public.notifications
  set read_at = now()
  where id = target_notification_id
    and recipient_user_id = auth.uid()
    and read_at is null
  returning * into changed_notification;

  if changed_notification.id is not null then
    perform public.record_notification_audit(
      changed_notification.id, changed_notification.household_id, changed_notification.recipient_user_id,
      auth.uid(), 'read', '{}'::jsonb
    );
    return changed_notification;
  end if;

  select * into changed_notification
  from public.notifications
  where id = target_notification_id and recipient_user_id = auth.uid();
  return changed_notification;
end;
$$;

create or replace function public.mark_all_notifications_read()
returns integer language plpgsql security definer set search_path = public as $$
declare changed_count integer;
begin
  if auth.uid() is null then raise exception 'You must be signed in to update notifications.'; end if;

  with changed as (
    update public.notifications n
    set read_at = now()
    where n.recipient_user_id = auth.uid()
      and n.read_at is null
      and n.archived_at is null
      and public.can_receive_notification(n.recipient_user_id, n.household_id, n.source_space_id, n.source_owner_user_id)
    returning n.*
  ), audited as (
    insert into public.notification_audit_entries(notification_id, household_id, recipient_user_id, actor_user_id, event_type, metadata)
    select id, household_id, recipient_user_id, auth.uid(), 'read', '{}'::jsonb from changed
    returning 1
  )
  select count(*)::integer into changed_count from audited;
  return changed_count;
end;
$$;

-- Browser delivery records are created only when an authenticated recipient opts in. No push is sent here.
create or replace function public.create_browser_push_delivery(target_notification_id uuid, target_device_id uuid)
returns public.notification_deliveries language plpgsql security definer set search_path = public as $$
declare device_record public.notification_devices;
declare notification_record public.notifications;
declare created_delivery public.notification_deliveries;
begin
  if auth.uid() is null or not public.can_read_notification(target_notification_id, auth.uid()) then
    raise exception 'This notification is not available to the signed-in recipient.';
  end if;
  select * into device_record from public.notification_devices where id = target_device_id and user_id = auth.uid() and revoked_at is null;
  if device_record.id is null then raise exception 'This browser device is not active for the signed-in recipient.'; end if;
  if not coalesce((select browser_push_enabled from public.notification_preferences where user_id = auth.uid() and notification_kind = (select notification_kind from public.notifications where id = target_notification_id)), false) then
    raise exception 'Browser push is disabled for this notification type.';
  end if;

  insert into public.notification_deliveries(notification_id, device_id, transport, status, attempted_at)
  values (target_notification_id, target_device_id, 'browser_push', 'pending', now())
  returning * into created_delivery;
  return created_delivery;
end;
$$;

create or replace function public.notify_message_recipients()
returns trigger language plpgsql security definer set search_path = public as $$
declare conversation_record public.conversations;
declare recipient_user_id uuid;
begin
  if new.deleted_at is not null then return new; end if;
  select * into conversation_record from public.conversations where id = new.conversation_id;
  for recipient_user_id in
    select sm.user_id from public.space_memberships sm
    where sm.space_id = conversation_record.space_id and sm.revoked_at is null and sm.user_id <> new.sender_user_id
  loop
    perform public.enqueue_notification(
      recipient_user_id, conversation_record.household_id, conversation_record.space_id, new.sender_user_id,
      new.sender_user_id, 'message', 'message', new.id, 'New family message', '',
      jsonb_build_object('conversation_id', new.conversation_id, 'message_id', new.id)
    );
  end loop;
  return new;
end;
$$;

create trigger messages_notify_recipients
after insert on public.messages for each row execute procedure public.notify_message_recipients();

create or replace function public.notify_calendar_invitee_write()
returns trigger language plpgsql security definer set search_path = public as $$
declare event_record public.calendar_events;
declare calendar_record public.calendars;
begin
  select * into event_record from public.calendar_events where id = new.event_id;
  select * into calendar_record from public.calendars where id = event_record.calendar_id;
  if tg_op = 'INSERT' then
    perform public.enqueue_notification(
      new.user_id, calendar_record.household_id, calendar_record.space_id, event_record.created_by_user_id,
      new.invited_by_user_id, 'calendar_invitation', 'calendar_event_invitee', new.event_id,
      'Calendar invitation', event_record.title, jsonb_build_object('event_id', new.event_id)
    );
  elsif old.rsvp_status is distinct from new.rsvp_status and event_record.created_by_user_id <> new.user_id then
    perform public.enqueue_notification(
      event_record.created_by_user_id, calendar_record.household_id, calendar_record.space_id, event_record.created_by_user_id,
      new.user_id, 'calendar_rsvp', 'calendar_event_invitee', new.event_id,
      'Calendar RSVP updated', event_record.title, jsonb_build_object('event_id', new.event_id, 'rsvp_status', new.rsvp_status)
    );
  end if;
  return new;
end;
$$;

create trigger calendar_event_invitees_notify
after insert or update on public.calendar_event_invitees
for each row execute procedure public.notify_calendar_invitee_write();

-- A scheduler may transition a due reminder to sent. The trigger creates only its in-app inbox item.
create or replace function public.notify_sent_calendar_reminder()
returns trigger language plpgsql security definer set search_path = public as $$
declare event_record public.calendar_events;
declare calendar_record public.calendars;
begin
  if new.status <> 'sent' or old.status = 'sent' then return new; end if;
  select * into event_record from public.calendar_events where id = new.event_id;
  select * into calendar_record from public.calendars where id = event_record.calendar_id;
  if event_record.cancelled_at is null then
    perform public.enqueue_notification(
      new.user_id, calendar_record.household_id, calendar_record.space_id, event_record.created_by_user_id,
      event_record.created_by_user_id, 'calendar_reminder', 'calendar_reminder', new.id,
      'Calendar reminder', event_record.title, jsonb_build_object('event_id', new.event_id, 'minutes_before', new.minutes_before)
    );
  end if;
  return new;
end;
$$;

create trigger calendar_reminders_notify_sent
after update on public.calendar_reminders
for each row execute procedure public.notify_sent_calendar_reminder();

create or replace function public.notify_asset_share_recipients()
returns trigger language plpgsql security definer set search_path = public as $$
declare recipient_user_id uuid;
begin
  for recipient_user_id in
    select sm.user_id from public.space_memberships sm
    where sm.space_id = new.destination_space_id and sm.revoked_at is null and sm.user_id <> new.shared_by_user_id
  loop
    perform public.enqueue_notification(
      recipient_user_id, new.household_id, new.destination_space_id, new.shared_by_user_id, new.shared_by_user_id,
      'asset_share', 'asset_share', new.id, 'New shared item', '',
      jsonb_build_object('asset_share_id', new.id, 'asset_id', new.shared_asset_id)
    );
  end loop;
  return new;
end;
$$;

create trigger asset_shares_notify_recipients
after insert on public.asset_shares for each row execute procedure public.notify_asset_share_recipients();

create or replace function public.notify_asset_profile_tag_activity()
returns trigger language plpgsql security definer set search_path = public as $$
declare asset_record public.assets;
declare profile_record public.family_profiles;
declare recipient_user_id uuid;
begin
  select * into asset_record from public.assets where id = new.asset_id;
  select * into profile_record from public.family_profiles where id = new.profile_id;
  for recipient_user_id in
    select distinct user_id from (
      select profile_record.owner_user_id as user_id
      union all
      select pg.user_id from public.profile_guardians pg where pg.profile_id = profile_record.id and pg.revoked_at is null
    ) recipients
    where user_id is not null and user_id <> new.tagged_by_user_id
  loop
    perform public.enqueue_notification(
      recipient_user_id, asset_record.household_id, asset_record.space_id, asset_record.uploaded_by_user_id,
      new.tagged_by_user_id, 'asset_profile_tag', 'asset_people', new.asset_id,
      'Profile tag added', profile_record.display_name, jsonb_build_object('asset_id', new.asset_id, 'profile_id', new.profile_id)
    );
  end loop;
  return new;
end;
$$;

create trigger asset_people_notify_profile_activity
after insert on public.asset_people for each row execute procedure public.notify_asset_profile_tag_activity();

create or replace function public.notify_household_invitation_accepted()
returns trigger language plpgsql security definer set search_path = public as $$
declare family_space_id uuid;
begin
  if new.status <> 'accepted' or old.status = 'accepted' then return new; end if;
  select id into family_space_id from public.spaces where household_id = new.household_id and space_type = 'family' limit 1;
  perform public.enqueue_notification(
    new.invited_by_user_id, new.household_id, family_space_id, new.invited_by_user_id,
    new.accepted_by_user_id, 'household_invitation_accepted', 'household_invitation', new.id,
    'Household invitation accepted', '', jsonb_build_object('invitation_id', new.id)
  );
  return new;
end;
$$;

create trigger household_invitations_notify_accepted
after update on public.household_invitations
for each row execute procedure public.notify_household_invitation_accepted();

alter table public.notification_preferences enable row level security;
alter table public.notification_devices enable row level security;
alter table public.notifications enable row level security;
alter table public.notification_deliveries enable row level security;
alter table public.notification_audit_entries enable row level security;

create policy "notification preferences: user manages own" on public.notification_preferences
for all to authenticated using (user_id = auth.uid()) with check (user_id = auth.uid());
create policy "notification devices: user manages own" on public.notification_devices
for all to authenticated using (user_id = auth.uid()) with check (user_id = auth.uid());
create policy "notifications: recipient inbox read" on public.notifications
for select to authenticated using (
  recipient_user_id = auth.uid()
  and public.can_receive_notification(recipient_user_id, household_id, source_space_id, source_owner_user_id)
);
create policy "notification deliveries: recipient audit read" on public.notification_deliveries
for select to authenticated using (
  exists (
    select 1 from public.notifications n
    where n.id = notification_id
      and n.recipient_user_id = auth.uid()
      and public.can_receive_notification(n.recipient_user_id, n.household_id, n.source_space_id, n.source_owner_user_id)
  )
);
create policy "notification audit: recipient read" on public.notification_audit_entries
for select to authenticated using (recipient_user_id = auth.uid());

alter table public.notifications replica identity full;
alter publication supabase_realtime add table public.notifications;

revoke all on function public.can_receive_notification(uuid, uuid, uuid, uuid) from public;
revoke all on function public.can_read_notification(uuid, uuid) from public;
revoke all on function public.record_notification_audit(uuid, uuid, uuid, uuid, text, jsonb) from public;
revoke all on function public.enqueue_notification(uuid, uuid, uuid, uuid, uuid, text, text, uuid, text, text, jsonb) from public;
revoke all on function public.mark_notification_read(uuid) from public;
revoke all on function public.mark_all_notifications_read() from public;
revoke all on function public.create_browser_push_delivery(uuid, uuid) from public;
revoke all on function public.notify_message_recipients() from public;
revoke all on function public.notify_calendar_invitee_write() from public;
revoke all on function public.notify_sent_calendar_reminder() from public;
revoke all on function public.notify_asset_share_recipients() from public;
revoke all on function public.notify_asset_profile_tag_activity() from public;
revoke all on function public.notify_household_invitation_accepted() from public;
grant execute on function public.mark_notification_read(uuid) to authenticated;
grant execute on function public.mark_all_notifications_read() to authenticated;
grant execute on function public.create_browser_push_delivery(uuid, uuid) to authenticated;

grant select, insert, update, delete on public.notification_preferences, public.notification_devices to authenticated;
grant select on public.notifications, public.notification_deliveries, public.notification_audit_entries to authenticated;

commit;
