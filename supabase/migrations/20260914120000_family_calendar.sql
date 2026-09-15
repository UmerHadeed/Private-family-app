-- Shared Family Calendar: membership-scoped events, invitations, RSVPs, recurrence and in-app reminder records.

begin;

create type public.calendar_event_kind as enum ('event', 'birthday', 'anniversary', 'reminder');
create type public.calendar_rsvp_status as enum ('pending', 'going', 'maybe', 'declined');
create type public.calendar_reminder_status as enum ('pending', 'dismissed', 'sent');

create table public.calendars (
  id uuid primary key default gen_random_uuid(),
  household_id uuid not null references public.households(id) on delete cascade,
  space_id uuid not null unique references public.spaces(id) on delete cascade,
  name text not null default 'Family Calendar' check (char_length(btrim(name)) between 1 and 120),
  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now()
);

create table public.calendar_events (
  id uuid primary key default gen_random_uuid(),
  calendar_id uuid not null references public.calendars(id) on delete cascade,
  created_by_user_id uuid not null references public.profiles(id) on delete restrict,
  title text not null check (char_length(btrim(title)) between 1 and 240),
  description text not null default '' check (char_length(description) <= 5000),
  location text not null default '' check (char_length(location) <= 500),
  event_kind public.calendar_event_kind not null default 'event',
  starts_at timestamptz not null,
  ends_at timestamptz not null,
  all_day boolean not null default false,
  timezone text not null default 'UTC' check (char_length(timezone) between 1 and 120),
  recurrence_frequency text check (recurrence_frequency is null or recurrence_frequency in ('daily', 'weekly', 'monthly', 'yearly')),
  recurrence_interval smallint not null default 1 check (recurrence_interval between 1 and 365),
  recurrence_until date,
  related_profile_id uuid references public.family_profiles(id) on delete set null,
  cancelled_at timestamptz,
  cancelled_by_user_id uuid references public.profiles(id) on delete set null,
  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now(),
  check (ends_at > starts_at),
  check ((recurrence_frequency is null and recurrence_until is null) or recurrence_frequency is not null)
);

create table public.calendar_event_invitees (
  event_id uuid not null references public.calendar_events(id) on delete cascade,
  user_id uuid not null references public.profiles(id) on delete cascade,
  invited_by_user_id uuid not null references public.profiles(id) on delete restrict,
  rsvp_status public.calendar_rsvp_status not null default 'pending',
  responded_at timestamptz,
  created_at timestamptz not null default now(),
  primary key (event_id, user_id)
);

create table public.calendar_reminders (
  id uuid primary key default gen_random_uuid(),
  event_id uuid not null references public.calendar_events(id) on delete cascade,
  user_id uuid not null references public.profiles(id) on delete cascade,
  minutes_before integer not null check (minutes_before in (0, 10, 30, 60, 1440, 10080)),
  status public.calendar_reminder_status not null default 'pending',
  dismissed_at timestamptz,
  created_at timestamptz not null default now(),
  unique (event_id, user_id, minutes_before)
);

create index calendar_events_calendar_starts_idx on public.calendar_events(calendar_id, starts_at) where cancelled_at is null;
create index calendar_event_invitees_user_idx on public.calendar_event_invitees(user_id, event_id);
create index calendar_reminders_user_status_idx on public.calendar_reminders(user_id, status);

create or replace function public.calendar_space_id(target_calendar_id uuid)
returns uuid language sql stable security definer set search_path = public as $$
  select space_id from public.calendars where id = target_calendar_id;
$$;

create or replace function public.is_calendar_member(target_calendar_id uuid)
returns boolean language sql stable security definer set search_path = public as $$
  select public.is_space_member(public.calendar_space_id(target_calendar_id));
$$;

create or replace function public.create_family_calendar()
returns trigger language plpgsql security definer set search_path = public as $$
begin
  if new.space_type = 'family' then
    insert into public.calendars(household_id, space_id)
    values (new.household_id, new.id)
    on conflict (space_id) do nothing;
  end if;
  return new;
end;
$$;

create trigger spaces_create_family_calendar
after insert on public.spaces
for each row execute procedure public.create_family_calendar();

insert into public.calendars(household_id, space_id)
select household_id, id from public.spaces where space_type = 'family'
on conflict (space_id) do nothing;

create or replace function public.validate_calendar_event_write()
returns trigger language plpgsql security definer set search_path = public as $$
declare calendar_household uuid;
begin
  select household_id into calendar_household from public.calendars where id = new.calendar_id;
  if calendar_household is null or not public.is_calendar_member(new.calendar_id) then
    raise exception 'Events belong only to an accessible Family Calendar.';
  end if;
  if tg_op = 'INSERT' then
    if new.created_by_user_id <> auth.uid() then raise exception 'Events must be created by the signed-in member.'; end if;
  else
    if old.created_by_user_id <> auth.uid() then raise exception 'Only the event creator can change or cancel it.'; end if;
    if old.calendar_id <> new.calendar_id or old.created_by_user_id <> new.created_by_user_id or old.created_at <> new.created_at then
      raise exception 'Event ownership and calendar cannot be changed.';
    end if;
    if old.cancelled_at is not null then raise exception 'Cancelled events cannot be changed.'; end if;
    if new.cancelled_at is not null then new.cancelled_by_user_id := auth.uid(); end if;
  end if;
  if new.related_profile_id is not null and not exists (select 1 from public.family_profiles where id = new.related_profile_id and household_id = calendar_household) then
    raise exception 'A profile date must belong to this household.';
  end if;
  new.updated_at := now();
  return new;
end;
$$;

create trigger calendar_events_guard_write
before insert or update on public.calendar_events
for each row execute procedure public.validate_calendar_event_write();

create or replace function public.validate_calendar_event_invitee_write()
returns trigger language plpgsql security definer set search_path = public as $$
declare event_calendar uuid;
begin
  select calendar_id into event_calendar from public.calendar_events where id = new.event_id and cancelled_at is null;
  if event_calendar is null or not public.is_calendar_member(event_calendar) then raise exception 'The event is not available to this calendar member.'; end if;
  if tg_op = 'INSERT' then
    if new.invited_by_user_id <> auth.uid() or not exists (select 1 from public.calendar_events where id = new.event_id and created_by_user_id = auth.uid()) then
      raise exception 'Only the event creator can invite family members.';
    end if;
    if not exists (select 1 from public.space_memberships sm where sm.space_id = public.calendar_space_id(event_calendar) and sm.user_id = new.user_id and sm.revoked_at is null) then raise exception 'Invitees must be Family Space members.'; end if;
  else
    if old.event_id <> new.event_id or old.user_id <> new.user_id or old.invited_by_user_id <> new.invited_by_user_id or old.created_at <> new.created_at then
      raise exception 'Invitee identity cannot be changed.';
    end if;
    if old.user_id <> auth.uid() then raise exception 'Family members can only update their own RSVP.'; end if;
    if new.rsvp_status <> old.rsvp_status then new.responded_at := now(); end if;
  end if;
  return new;
end;
$$;

create trigger calendar_event_invitees_guard_write
before insert or update on public.calendar_event_invitees
for each row execute procedure public.validate_calendar_event_invitee_write();

create or replace function public.validate_calendar_reminder_write()
returns trigger language plpgsql security definer set search_path = public as $$
declare event_calendar uuid;
begin
  select calendar_id into event_calendar from public.calendar_events where id = new.event_id and cancelled_at is null;
  if event_calendar is null or not public.is_calendar_member(event_calendar) or new.user_id <> auth.uid() then
    raise exception 'Reminders can only be managed by the signed-in calendar member.';
  end if;
  if tg_op = 'UPDATE' and (old.event_id <> new.event_id or old.user_id <> new.user_id or old.minutes_before <> new.minutes_before) then
    raise exception 'Reminder identity cannot be changed.';
  end if;
  if new.status = 'dismissed' and old.status <> 'dismissed' then new.dismissed_at := now(); end if;
  return new;
end;
$$;

create trigger calendar_reminders_guard_write
before insert or update on public.calendar_reminders
for each row execute procedure public.validate_calendar_reminder_write();

create or replace function public.audit_calendar_event_write()
returns trigger language plpgsql security definer set search_path = public as $$
declare household uuid;
begin
  select household_id into household from public.calendars where id = coalesce(new.calendar_id, old.calendar_id);
  insert into public.audit_events(household_id, actor_user_id, action, resource_type, resource_id, metadata)
  values (household, auth.uid(), case when tg_op = 'INSERT' then 'create' when new.cancelled_at is not null and old.cancelled_at is null then 'delete' else 'update' end, 'calendar_events', coalesce(new.id, old.id), jsonb_build_object('operation', tg_op));
  return coalesce(new, old);
end;
$$;

create or replace function public.audit_calendar_invitee_write()
returns trigger language plpgsql security definer set search_path = public as $$
declare household uuid;
begin
  select c.household_id into household from public.calendar_events e join public.calendars c on c.id = e.calendar_id where e.id = coalesce(new.event_id, old.event_id);
  insert into public.audit_events(household_id, actor_user_id, action, resource_type, resource_id, metadata)
  values (household, auth.uid(), case when tg_op = 'INSERT' then 'share' else 'update' end, 'calendar_event_invitees', null, jsonb_build_object('operation', tg_op, 'event_id', coalesce(new.event_id, old.event_id), 'user_id', coalesce(new.user_id, old.user_id)));
  return coalesce(new, old);
end;
$$;

create trigger calendar_events_audit after insert or update on public.calendar_events for each row execute procedure public.audit_calendar_event_write();
create trigger calendar_event_invitees_audit after insert or update on public.calendar_event_invitees for each row execute procedure public.audit_calendar_invitee_write();

alter table public.calendars enable row level security;
alter table public.calendar_events enable row level security;
alter table public.calendar_event_invitees enable row level security;
alter table public.calendar_reminders enable row level security;

create policy "calendars: Family Space members read" on public.calendars for select to authenticated using (public.is_space_member(space_id));
create policy "calendar events: members read" on public.calendar_events for select to authenticated using (public.is_calendar_member(calendar_id));
create policy "calendar events: members create" on public.calendar_events for insert to authenticated with check (created_by_user_id = auth.uid() and public.is_calendar_member(calendar_id));
create policy "calendar events: creator updates" on public.calendar_events for update to authenticated using (created_by_user_id = auth.uid() and public.is_calendar_member(calendar_id)) with check (created_by_user_id = auth.uid() and public.is_calendar_member(calendar_id));
create policy "calendar invitees: members read" on public.calendar_event_invitees for select to authenticated using (exists (select 1 from public.calendar_events e where e.id = event_id and public.is_calendar_member(e.calendar_id)));
create policy "calendar invitees: event creator invites" on public.calendar_event_invitees for insert to authenticated with check (exists (select 1 from public.calendar_events e where e.id = event_id and e.created_by_user_id = auth.uid() and public.is_calendar_member(e.calendar_id)));
create policy "calendar invitees: invitee rsvps" on public.calendar_event_invitees for update to authenticated using (user_id = auth.uid()) with check (user_id = auth.uid());
create policy "calendar reminders: member manages own" on public.calendar_reminders for all to authenticated using (user_id = auth.uid() and exists (select 1 from public.calendar_events e where e.id = event_id and public.is_calendar_member(e.calendar_id))) with check (user_id = auth.uid() and exists (select 1 from public.calendar_events e where e.id = event_id and public.is_calendar_member(e.calendar_id)));

alter table public.calendar_events replica identity full;
alter table public.calendar_event_invitees replica identity full;
alter publication supabase_realtime add table public.calendar_events;
alter publication supabase_realtime add table public.calendar_event_invitees;

grant select, insert, update on public.calendars, public.calendar_events, public.calendar_event_invitees, public.calendar_reminders to authenticated;

commit;
