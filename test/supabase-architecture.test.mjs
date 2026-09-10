import test from 'node:test'
import assert from 'node:assert/strict'
import { readFile } from 'node:fs/promises'

const migration = new URL('../supabase/migrations/20260910110000_initial_schema.sql', import.meta.url)

test('Supabase migration keeps family assets private and membership-scoped', async () => {
  const sql = await readFile(migration, 'utf8')
  assert.match(sql, /references auth\.users\(id\)/)
  assert.match(sql, /auth\.uid\(\)/)
  assert.match(sql, /create policy "assets: space member read"/)
  assert.match(sql, /create policy "family assets: members read"/)
  assert.match(sql, /values \('family-assets', 'family-assets', false/)
  assert.match(sql, /public\.is_space_member\(nullif\(split_part\(target_path, '\/', 2\)/)
})
