-- Family Space messaging, replies, edits, soft deletion, attachment publication and realtime.
-- Every operation remains scoped to an explicitly shared space.

begin;

create table public.conversations (
  id uuid primary key default gen_random_uuid(),
  household_id uuid not null references public.households(id) on delete cascade,
  space_id uuid not null unique references public.spaces(id) on delete cascade,
  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now()
);

create table public.messages (
  id uuid primary key default gen_random_uuid(),
  conversation_id uuid not null references public.conversations(id) on delete cascade,
  sender_user_id uuid not null references public.profiles(id) on delete restrict,
  sender_display_name text not null check (char_length(sender_display_name) between 1 and 120),
  body text check (body is null or char_length(body) <= 10000),
  reply_to_message_id uuid references public.messages(id) on delete set null,
  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now(),
  edited_at timestamptz,
  deleted_at timestamptz,
  deleted_by_user_id uuid references public.profiles(id) on delete set null,
  check (deleted_at is null or (body is null and deleted_by_user_id is not null))
);

create table public.message_attachments (
  id uuid primary key default gen_random_uuid(),
  message_id uuid not null references public.messages(id) on delete cascade,
  uploaded_by_user_id uuid not null references public.profiles(id) on delete restrict,
  storage_path text not null unique check (storage_path ~ '^[0-9a-f-]+/[0-9a-f-]+/.+'),
  filename text not null check (char_length(filename) between 1 and 512),
  mime_type text not null check (char_length(mime_type) between 1 and 255),
  byte_size bigint not null check (byte_size >= 0 and byte_size <= 5368709120),
  kind text not null check (kind in ('image', 'video', 'audio', 'document', 'file')),
  duration_seconds integer check (duration_seconds is null or duration_seconds between 0 and 86400),
  created_at timestamptz not null default now()
);

create index messages_conversation_created_idx on public.messages(conversation_id, created_at desc);
create index message_attachments_message_idx on public.message_attachments(message_id, created_at);

create or replace function public.conversation_space_id(target_conversation_id uuid)
returns uuid language sql stable security definer set search_path = public as $$
  select space_id from public.conversations where id = target_conversation_id;
$$;

create or replace function public.is_conversation_member(target_conversation_id uuid)
returns boolean language sql stable security definer set search_path = public as $$
  select public.is_space_member(public.conversation_space_id(target_conversation_id));
$$;

create or replace function public.is_conversation_editor(target_conversation_id uuid)
returns boolean language sql stable security definer set search_path = public as $$
  select public.is_space_editor(public.conversation_space_id(target_conversation_id));
$$;

create or replace function public.create_family_conversation()
returns trigger language plpgsql security definer set search_path = public as $$
begin
  if new.space_type = 'family' then
    insert into public.conversations (household_id, space_id)
    values (new.household_id, new.id)
    on conflict (space_id) do nothing;
  end if;
  return new;
end;
$$;

create trigger spaces_create_family_conversation
after insert on public.spaces
for each row execute procedure public.create_family_conversation();

insert into public.conversations (household_id, space_id)
select household_id, id from public.spaces where space_type = 'family'
on conflict (space_id) do nothing;

create or replace function public.prepare_message_write()
returns trigger language plpgsql security definer set search_path = public as $$
declare
  live_name text;
begin
  if tg_op = 'INSERT' then
    if new.sender_user_id <> auth.uid() then
      raise exception 'Messages must be sent as the signed-in user.';
    end if;
    select display_name into live_name from public.profiles where id = auth.uid();
    new.sender_display_name := coalesce(live_name, 'Family member');
    new.updated_at := now();
    return new;
  end if;

  if old.sender_user_id <> auth.uid() then
    raise exception 'Only the sender can change this message.';
  end if;
  if old.conversation_id <> new.conversation_id
    or old.sender_user_id <> new.sender_user_id
    or old.sender_display_name <> new.sender_display_name
    or old.reply_to_message_id is distinct from new.reply_to_message_id
    or old.created_at <> new.created_at then
    raise exception 'Message ownership and conversation cannot be changed.';
  end if;
  if old.deleted_at is not null then
    raise exception 'Deleted messages cannot be changed.';
  end if;
  if new.deleted_at is not null then
    new.body := null;
    new.deleted_by_user_id := auth.uid();
  elsif new.deleted_by_user_id is not null then
    raise exception 'A visible message cannot have a deletion author.';
  elsif old.body is distinct from new.body then
    new.edited_at := now();
  end if;
  new.updated_at := now();
  return new;
end;
$$;

create trigger messages_guard_write
before insert or update on public.messages
for each row execute procedure public.prepare_message_write();

create or replace function public.validate_message_attachment()
returns trigger language plpgsql security definer set search_path = public as $$
declare
  message_sender uuid;
begin
  select sender_user_id into message_sender from public.messages where id = new.message_id;
  if message_sender is null or message_sender <> auth.uid() or new.uploaded_by_user_id <> auth.uid() then
    raise exception 'Attachments can only be published by the sending user.';
  end if;
  return new;
end;
$$;

create trigger message_attachments_validate
before insert on public.message_attachments
for each row execute procedure public.validate_message_attachment();

alter table public.conversations enable row level security;
alter table public.messages enable row level security;
alter table public.message_attachments enable row level security;

create policy "conversations: family members read" on public.conversations
for select to authenticated using (public.is_space_member(space_id));
create policy "messages: conversation members read" on public.messages
for select to authenticated using (public.is_conversation_member(conversation_id));
create policy "messages: conversation editors send" on public.messages
for insert to authenticated with check (
  sender_user_id = auth.uid() and public.is_conversation_editor(conversation_id)
);
create policy "messages: sender edits or deletes" on public.messages
for update to authenticated using (
  sender_user_id = auth.uid() and public.is_conversation_editor(conversation_id)
) with check (
  sender_user_id = auth.uid() and public.is_conversation_editor(conversation_id)
);
create policy "message attachments: conversation members read" on public.message_attachments
for select to authenticated using (
  exists (select 1 from public.messages m where m.id = message_id and public.is_conversation_member(m.conversation_id))
);
create policy "message attachments: sender publishes" on public.message_attachments
for insert to authenticated with check (
  uploaded_by_user_id = auth.uid()
  and exists (select 1 from public.messages m where m.id = message_id and m.sender_user_id = auth.uid() and public.is_conversation_editor(m.conversation_id))
);

-- Existing bucket stays private. This increases only the per-file limit.
update storage.buckets set file_size_limit = 5368709120 where id = 'family-assets';

alter table public.messages replica identity full;
alter table public.message_attachments replica identity full;
alter publication supabase_realtime add table public.messages;
alter publication supabase_realtime add table public.message_attachments;

grant select, insert, update on public.conversations, public.messages, public.message_attachments to authenticated;

commit;
