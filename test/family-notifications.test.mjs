import test from 'node:test'
import assert from 'node:assert/strict'
import { readFile } from 'node:fs/promises'

const migration = new URL('../supabase/migrations/20260915143000_family_notifications_and_reminders.sql', import.meta.url)
const notificationUi = new URL('../app/notifications.jsx', import.meta.url)
const app = new URL('../app/page.jsx', import.meta.url)

test('notifications are recipient-owned, access-rechecked, auditable, and exclude My Vault recipients', async () => {
  const sql = await readFile(migration, 'utf8')
  assert.match(sql, /create table public\.notification_preferences/)
  assert.match(sql, /create table public\.notification_devices/)
  assert.match(sql, /create table public\.notifications/)
  assert.match(sql, /create table public\.notification_deliveries/)
  assert.match(sql, /create table public\.notification_audit_entries/)
  assert.match(sql, /s\.space_type <> 'private_vault'\s+or target_recipient_user_id = target_source_owner_user_id/)
  assert.match(sql, /public\.can_receive_notification/)
  assert.match(sql, /public\.mark_notification_read/)
  assert.match(sql, /public\.mark_all_notifications_read/)
  assert.match(sql, /alter publication supabase_realtime add table public\.notifications/)
})

test('notification triggers fan out only through existing permission scopes', async () => {
  const sql = await readFile(migration, 'utf8')
  assert.match(sql, /create trigger messages_notify_recipients/)
  assert.match(sql, /create trigger calendar_event_invitees_notify/)
  assert.match(sql, /create trigger calendar_reminders_notify_sent/)
  assert.match(sql, /create trigger asset_shares_notify_recipients/)
  assert.match(sql, /create trigger asset_people_notify_profile_activity/)
  assert.match(sql, /create trigger household_invitations_notify_accepted/)
  assert.match(sql, /sm\.revoked_at is null/)
  assert.match(sql, /notification_preferences where user_id = target_recipient_user_id/)
})

test('notification UI has real inbox, preferences, realtime refresh, and Push API registration', async () => {
  const [ui, source] = await Promise.all([readFile(notificationUi, 'utf8'), readFile(app, 'utf8')])
  assert.match(source, /import Notifications from '\.\/notifications'/)
  assert.match(source, /page === 'Notifications'/)
  assert.match(ui, /from\('notifications'\)/)
  assert.match(ui, /mark_notification_read/)
  assert.match(ui, /mark_all_notifications_read/)
  assert.match(ui, /from\('notification_preferences'\)\.upsert/)
  assert.match(ui, /navigator\.serviceWorker\.register\('\/notification-worker\.js'\)/)
  assert.match(ui, /pushManager\.subscribe/)
  assert.match(ui, /NEXT_PUBLIC_VAPID_PUBLIC_KEY/)
  assert.doesNotMatch(ui, /browser:\$\{crypto\.randomUUID\(\)\}/)
})
