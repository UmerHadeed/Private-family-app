import test from 'node:test'
import assert from 'node:assert/strict'
import { readFile } from 'node:fs/promises'

const migration = new URL('../supabase/migrations/20260915123000_family_profiles_and_milestones.sql', import.meta.url)
const profiles = new URL('../app/family-profiles.jsx', import.meta.url)

test('family profiles have owner-controlled guardian access, distinct profile spaces, and optional profile-linked birthdays', async () => {
  const sql = await readFile(migration, 'utf8')
  assert.match(sql, /create_family_profile_with_milestone/)
  assert.match(sql, /Only the household owner can create a family profile/)
  assert.match(sql, /kind not in \('child', 'dependent'\)/)
  assert.match(sql, /insert into public\.spaces\(household_id, profile_id, space_type, name\)/)
  assert.match(sql, /'profile'/)
  assert.match(sql, /insert into public\.profile_guardians/)
  assert.match(sql, /insert into public\.space_memberships/)
  assert.match(sql, /publish_birthday and profile_birth_date is not null/)
  assert.match(sql, /related_profile_id\)/)
  assert.match(sql, /update_family_profile_guardians/)
  assert.match(sql, /update_family_profile_details/)
  assert.match(sql, /create policy "family profiles: household member read"/)
})

test('profile UI makes non-account status, guardian control, private-space separation, and milestone publication explicit', async () => {
  const source = await readFile(profiles, 'utf8')
  assert.match(source, /from\('family_profiles'\)/)
  assert.match(source, /rpc\('create_family_profile_with_milestone'/)
  assert.match(source, /rpc\('update_family_profile_guardians'/)
  assert.match(source, /rpc\('update_family_profile_details'/)
  assert.match(source, /does not have an account/)
  assert.match(source, /do not inherit Family Space or My Vault access/)
  assert.match(source, /Publish birthday to the shared Family Calendar/)
})
