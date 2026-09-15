import test from 'node:test'
import assert from 'node:assert/strict'
import { readFile } from 'node:fs/promises'

const migration = new URL('../supabase/migrations/20260915113000_asset_detail_and_controlled_sharing.sql', import.meta.url)
const detail = new URL('../app/asset-detail.jsx', import.meta.url)

test('controlled sharing copies only an owner asset to an explicit non-private space and records audit events', async () => {
  const sql = await readFile(migration, 'utf8')
  assert.match(sql, /create table public\.asset_shares/)
  assert.match(sql, /source_asset_id uuid not null references public\.assets/)
  assert.match(sql, /shared_asset_id uuid not null unique references public\.assets/)
  assert.match(sql, /destination\.space_type = 'private_vault'/)
  assert.match(sql, /source_asset\.uploaded_by_user_id <> auth\.uid\(\)/)
  assert.match(sql, /public\.is_space_editor\(destination_space_id\)/)
  assert.match(sql, /insert into public\.assets/)
  assert.match(sql, /'share', 'asset'/)
  assert.match(sql, /update public\.assets\s+set deleted_at = now\(\)/)
  assert.match(sql, /'revoke', 'asset_share'/)
})

test('asset detail makes audience review, private download, rename, and reversible unsharing explicit', async () => {
  const source = await readFile(detail, 'utf8')
  assert.match(source, /createSignedUrl/)
  assert.match(source, /from\('assets'\)\.update\(\{ filename/)
  assert.match(source, /storage\.from\('family-assets'\)\.download/)
  assert.match(source, /storage\.from\('family-assets'\)\.upload/)
  assert.match(source, /rpc\('share_asset_to_space'/)
  assert.match(source, /rpc\('revoke_asset_share'/)
  assert.match(source, /The original remains in My Vault/)
  assert.match(source, /Review who can access it/)
})
