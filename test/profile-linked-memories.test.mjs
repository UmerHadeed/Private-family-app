import test from 'node:test'
import assert from 'node:assert/strict'
import { readFile } from 'node:fs/promises'

const migration = new URL('../supabase/migrations/20260915133000_profile_linked_memories.sql', import.meta.url)
const page = new URL('../app/page.jsx', import.meta.url)
const detail = new URL('../app/asset-detail.jsx', import.meta.url)
const profiles = new URL('../app/family-profiles.jsx', import.meta.url)

test('profile tags are separate from item access, household-scoped, audited, and copied to controlled shared copies', async () => {
  const sql = await readFile(migration, 'utf8')
  assert.match(sql, /create table public\.asset_people/)
  assert.match(sql, /Only an editor of the item space can change profile tags/)
  assert.match(sql, /profile tag must belong to the same household as the item/)
  assert.match(sql, /create policy "asset people: item members read"/)
  assert.match(sql, /create policy "asset people: item editors tag"/)
  assert.match(sql, /create policy "asset people: item editors remove tag"/)
  assert.match(sql, /asset_shares_copy_profile_tags/)
  assert.match(sql, /insert into public\.audit_events/)
  assert.match(sql, /asset_profile_tag/)
})

test('item detail and collections expose profile tagging and permitted profile filters', async () => {
  const [pageSource, detailSource, profileSource] = await Promise.all([readFile(page, 'utf8'), readFile(detail, 'utf8'), readFile(profiles, 'utf8')])
  assert.match(detailSource, /from\('asset_people'\)/)
  assert.match(detailSource, /Add profile tag/)
  assert.match(detailSource, /Tags describe the item. They never change who can access it/)
  assert.match(pageSource, /from\('asset_people'\)/)
  assert.match(pageSource, /Filter by person/)
  assert.match(pageSource, /profileFilter/)
  assert.match(profileSource, /View permitted memories/)
})
