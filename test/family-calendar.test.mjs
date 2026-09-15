import test from 'node:test'
import assert from 'node:assert/strict'
import { readFile } from 'node:fs/promises'

const migration = new URL('../supabase/migrations/20260914120000_family_calendar.sql', import.meta.url)
const profileMigration = new URL('../supabase/migrations/20260914121500_calendar_invitee_profiles.sql', import.meta.url)
const calendar = new URL('../app/family-calendar.jsx', import.meta.url)

test('Family Calendar is explicitly Family Space scoped with event, invite and reminder records', async () => {
  const sql = await readFile(migration, 'utf8')
  assert.match(sql, /create table public\.calendars/)
  assert.match(sql, /space_id uuid not null unique references public\.spaces/)
  assert.match(sql, /create table public\.calendar_events/)
  assert.match(sql, /create table public\.calendar_event_invitees/)
  assert.match(sql, /create table public\.calendar_reminders/)
  assert.match(sql, /calendar_rsvp_status as enum \('pending', 'going', 'maybe', 'declined'\)/)
  assert.match(sql, /recurrence_frequency text check/)
  assert.match(sql, /minutes_before in \(0, 10, 30, 60, 1440, 10080\)/)
})

test('Family Calendar protects event ownership, RSVP identity and membership', async () => {
  const sql = await readFile(migration, 'utf8')
  assert.match(sql, /Only the event creator can change or cancel it/)
  assert.match(sql, /Only the event creator can invite family members/)
  assert.match(sql, /Family members can only update their own RSVP/)
  assert.match(sql, /sm\.user_id = new\.user_id/)
  assert.match(sql, /create policy "calendar events: members read"/)
  assert.match(sql, /create policy "calendar events: creator updates"/)
  assert.match(sql, /create policy "calendar invitees: invitee rsvps"/)
  assert.match(sql, /alter publication supabase_realtime add table public\.calendar_events/)
})

test('Family Calendar only adds display-name access for active household peers', async () => {
  const sql = await readFile(profileMigration, 'utf8')
  assert.match(sql, /profiles: household member read/)
  assert.match(sql, /mine\.user_id = auth\.uid\(\)/)
  assert.match(sql, /peer\.user_id = profiles\.id/)
  assert.match(sql, /peer\.revoked_at is null/)
})

test('Family Calendar UI persists event creation, invitees, RSVP, reminders and recurrence', async () => {
  const source = await readFile(calendar, 'utf8')
  assert.match(source, /from\('calendar_events'\)\.insert/)
  assert.match(source, /from\('calendar_event_invitees'\)\.insert/)
  assert.match(source, /from\('calendar_reminders'\)\.insert/)
  assert.match(source, /rsvp_status: status/)
  assert.match(source, /recurrence_frequency/)
  assert.match(source, /expandEvents/)
  assert.match(source, /Push and external calendar notifications are not connected yet/)
  assert.doesNotMatch(source, /local preview/i)
})
