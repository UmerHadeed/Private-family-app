import test from 'node:test'
import assert from 'node:assert/strict'
import { readFile } from 'node:fs/promises'

const migration = new URL('../supabase/migrations/20260915150000_searchable_curated_memories.sql', import.meta.url)
const component = new URL('../app/curated-memories.jsx', import.meta.url)
const page = new URL('../app/page.jsx', import.meta.url)

test('curated memories are space-scoped, creator-owned, archived, audited, and realtime-enabled', async () => {
  const sql = await readFile(migration, 'utf8')
  assert.match(sql, /create table public\.curated_memories/)
  assert.match(sql, /space_id uuid not null references public\.spaces/)
  assert.match(sql, /created_by_user_id uuid not null references public\.profiles/)
  assert.match(sql, /archived_at timestamptz/)
  assert.match(sql, /Only an editor of the memory space can create or update this curated memory/)
  assert.match(sql, /curated memories: space members read/)
  assert.match(sql, /curated memories: creators create/)
  assert.match(sql, /curated memories: creators update/)
  assert.match(sql, /created_by_user_id = auth\.uid\(\) and public\.is_space_editor\(space_id\)/)
  assert.match(sql, /insert into public\.audit_events/)
  assert.match(sql, /alter publication supabase_realtime add table public\.curated_memories/)
})

test('linked assets remain non-deleted, accessible, and descriptive profile tags remain outside the memory model', async () => {
  const sql = await readFile(migration, 'utf8')
  assert.match(sql, /create table public\.curated_memory_assets/)
  assert.match(sql, /active, non-deleted assets/)
  assert.match(sql, /only link an accessible asset from the same household/)
  assert.match(sql, /public\.is_space_member\(asset_record\.space_id\)/)
  assert.match(sql, /curated memory assets: permitted members read/)
  assert.doesNotMatch(sql, /family_profiles.*grant|grant.*family_profiles/i)
})

test('database search uses durable user-authored title/summary and linked filenames with space access checks', async () => {
  const sql = await readFile(migration, 'utf8')
  assert.match(sql, /search_document tsvector generated always as/)
  assert.match(sql, /to_tsvector\('simple', coalesce\(title, ''\)\)/)
  assert.match(sql, /to_tsvector\('simple', coalesce\(summary, ''\)\)/)
  assert.match(sql, /create or replace function public\.search_curated_memories/)
  assert.match(sql, /websearch_to_tsquery\('simple', coalesce\(search_query, ''\)\)/)
  assert.match(sql, /to_tsvector\('simple', a\.filename\)/)
  assert.match(sql, /public\.is_space_member\(m\.space_id\)/)
  assert.match(sql, /public\.is_space_member\(a\.space_id\)/)
  assert.doesNotMatch(sql, /ai_generated|ai_summary|openai/i)
})

test('Library uses durable curated-memory search and an editor that can link and archive owned memories', async () => {
  const [componentSource, pageSource] = await Promise.all([readFile(component, 'utf8'), readFile(page, 'utf8')])
  assert.match(pageSource, /import CuratedMemories from '\.\/curated-memories'/)
  assert.match(pageSource, /<CuratedMemories/)
  assert.match(componentSource, /rpc\('search_curated_memories'/)
  assert.match(componentSource, /from\('curated_memories'\)\.insert/)
  assert.match(componentSource, /from\('curated_memories'\)\.update/)
  assert.match(componentSource, /from\('curated_memory_assets'\)\.insert/)
  assert.match(componentSource, /archived_at: new Date\(\)\.toISOString\(\)/)
  assert.match(componentSource, /postgres_changes/)
  assert.match(componentSource, /Titles and summaries are written by you/)
  assert.match(componentSource, /Linking does not share an original item or change its access/)
})
