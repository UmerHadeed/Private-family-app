import test from 'node:test'
import assert from 'node:assert/strict'
import { readFile } from 'node:fs/promises'

const migration = new URL('../supabase/migrations/20260914110000_family_ai_control_plane.sql', import.meta.url)
const studio = new URL('../app/agent-studio.jsx', import.meta.url)

test('Family AI control plane uses explicit owner-scoped agent and source grants', async () => {
  const sql = await readFile(migration, 'utf8')
  assert.match(sql, /create table public\.agents/)
  assert.match(sql, /create table public\.agent_scope_grants/)
  assert.match(sql, /create table public\.agent_consents/)
  assert.match(sql, /create table public\.agent_runs/)
  assert.match(sql, /create type public\.agent_scope_capability as enum \('read', 'suggest'\)/)
  assert.match(sql, /not public\.is_space_editor\(new\.space_id\)/)
  assert.match(sql, /agent_household_id <> source_household_id/)
  assert.match(sql, /create policy "agents: creator manages"/)
  assert.match(sql, /create policy "agent scope grants: owner manages"/)
  assert.match(sql, /create policy "agent runs: owner reads"/)
})

test('Family AI source revocation and audit trail are durable', async () => {
  const sql = await readFile(migration, 'utf8')
  assert.match(sql, /revoked_at timestamptz/)
  assert.match(sql, /Revoked source grants cannot be changed/)
  assert.match(sql, /audit_agent_scope_grant_write/)
  assert.match(sql, /audit_agent_consent_write/)
  assert.match(sql, /Browser clients do not receive insert\/update rights for runs/)
  assert.match(sql, /create unique index agent_scope_grants_one_active_idx/)
})

test('Family AI UI persists grants and does not pretend an AI provider is connected', async () => {
  const source = await readFile(studio, 'utf8')
  assert.match(source, /from\('agents'\)\.insert/)
  assert.match(source, /from\('agent_scope_grants'\)\.insert/)
  assert.match(source, /from\('agent_consents'\)\.insert/)
  assert.match(source, /revoked_at: new Date\(\)\.toISOString\(\)/)
  assert.match(source, /Grant at least one source before activating this agent/)
  assert.match(source, /Provider not connected/)
  assert.match(source, /No family content is sent anywhere from this screen/)
})
