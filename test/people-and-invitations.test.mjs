import test from 'node:test'
import assert from 'node:assert/strict'
import { readFile } from 'node:fs/promises'

const migration = new URL('../supabase/migrations/20260915100000_people_and_invitations.sql', import.meta.url)
const people = new URL('../app/people.jsx', import.meta.url)
const gate = new URL('../app/page.jsx', import.meta.url)
const route = new URL('../app/api/household-invitations/route.js', import.meta.url)

test('People and invitations use explicit pending, accepted and revoked records', async () => {
  const sql = await readFile(migration, 'utf8')
  assert.match(sql, /create table public\.household_invitations/)
  assert.match(sql, /household_invitation_status as enum \('pending', 'accepted', 'revoked', 'expired'\)/)
  assert.match(sql, /family_space_role public\.space_role/)
  assert.match(sql, /create unique index household_invitations_one_pending_email_idx/)
  assert.match(sql, /expires_at timestamptz not null default \(now\(\) \+ interval '14 days'\)/)
})

test('Accepting an invitation grants only the selected Family Space role, not My Vault', async () => {
  const sql = await readFile(migration, 'utf8')
  assert.match(sql, /create or replace function public\.accept_household_invitation/)
  assert.match(sql, /invited_email = lower\(coalesce\(auth\.jwt\(\) ->> 'email', ''\)\)/)
  assert.match(sql, /space_type = 'family'/)
  assert.match(sql, /on conflict \(space_id, user_id\) do update set role = excluded\.role/)
  assert.match(sql, /s\.space_type <> 'private_vault'/)
  assert.match(sql, /Only the household owner can remove members/)
})

test('People UI makes access explicit, supports revocation, and preserves private-vault separation', async () => {
  const source = await readFile(people, 'utf8')
  assert.match(source, /from\('household_invitations'\)/)
  assert.match(source, /create_household_invitation/)
  assert.match(source, /revoke_household_invitation/)
  assert.match(source, /revoke_household_member/)
  assert.match(source, /My Vault is never included/)
  assert.match(source, /Can contribute/)
  assert.match(source, /Can view/)
})

test('The account gate presents pending invitations and email delivery is server-side only', async () => {
  const [page, endpoint] = await Promise.all([readFile(gate, 'utf8'), readFile(route, 'utf8')])
  assert.match(page, /list_my_pending_household_invitations/)
  assert.match(page, /accept_household_invitation/)
  assert.match(endpoint, /SUPABASE_SERVICE_ROLE_KEY/)
  assert.match(endpoint, /auth\.admin\.inviteUserByEmail/)
  assert.match(endpoint, /Authorization/)
  assert.doesNotMatch(endpoint, /NEXT_PUBLIC_SUPABASE_SERVICE_ROLE_KEY/)
})
