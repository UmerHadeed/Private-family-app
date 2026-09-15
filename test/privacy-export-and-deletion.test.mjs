import test from 'node:test'
import assert from 'node:assert/strict'
import { readFile } from 'node:fs/promises'

const migration = new URL('../supabase/migrations/20260915151000_privacy_export_and_deletion.sql', import.meta.url)
const privacyUi = new URL('../app/privacy.jsx', import.meta.url)
const app = new URL('../app/page.jsx', import.meta.url)

test('privacy requests snapshot only currently permitted export assets and retain a durable audit trail', async () => {
  const sql = await readFile(migration, 'utf8')
  assert.match(sql, /create table public\.privacy_export_requests/)
  assert.match(sql, /create table public\.privacy_export_request_assets/)
  assert.match(sql, /create table public\.privacy_deletion_requests/)
  assert.match(sql, /create or replace function public\.request_privacy_export/)
  assert.match(sql, /asset\.uploaded_by_user_id = auth\.uid\(\) or public\.is_space_member\(asset\.space_id\)/)
  assert.match(sql, /This creates a reviewable manifest only; no archive or signed URL is produced here\./)
  assert.match(sql, /'export', 'privacy_export_request'/)
  assert.match(sql, /privacy export requests: requester read/)
  assert.match(sql, /privacy export request assets: requester read/)
})

test('privacy deletion is a reviewed request for a user-owned original and never deletes storage', async () => {
  const sql = await readFile(migration, 'utf8')
  assert.match(sql, /create or replace function public\.request_privacy_asset_deletion/)
  assert.match(sql, /target_asset\.uploaded_by_user_id <> auth\.uid\(\)/)
  assert.match(sql, /exists \(select 1 from public\.asset_shares where shared_asset_id = target_asset\.id\)/)
  assert.match(sql, /'delete', 'privacy_deletion_request'/)
  assert.match(sql, /create or replace function public\.withdraw_privacy_request/)
  assert.match(sql, /status = 'withdrawn'/)
  assert.doesNotMatch(sql, /storage\.objects|storage\.from|delete from storage/i)
})

test('privacy UI records only requests, lists them, permits withdrawal, and is navigable', async () => {
  const [ui, source] = await Promise.all([readFile(privacyUi, 'utf8'), readFile(app, 'utf8')])
  assert.match(source, /import Privacy from '\.\/privacy'/)
  assert.match(source, /\['Privacy', '♙'\]/)
  assert.match(source, /page === 'Privacy'/)
  assert.match(ui, /rpc\('request_privacy_export'/)
  assert.match(ui, /rpc\('request_privacy_asset_deletion'/)
  assert.match(ui, /rpc\('withdraw_privacy_request'/)
  assert.match(ui, /No archive has been created yet/)
  assert.match(ui, /never automatically deletes database records or storage objects/)
})
