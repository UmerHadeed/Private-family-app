import test from 'node:test'
import assert from 'node:assert/strict'
import { readFile } from 'node:fs/promises'

const migration = new URL('../supabase/migrations/20260910130000_household_onboarding.sql', import.meta.url)

test('household onboarding creates only explicit owner access and default spaces', async () => {
  const sql = await readFile(migration, 'utf8')

  assert.match(sql, /security definer/)
  assert.match(sql, /current_user_id uuid := auth\.uid\(\)/)
  assert.match(sql, /You must be signed in to create a household/)
  assert.match(sql, /You already belong to a household/)
  assert.match(sql, /'private_vault', 'My Vault'/)
  assert.match(sql, /'family', 'Family Space'/)
  assert.match(sql, /created_private_space_id, current_user_id, 'owner'/)
  assert.match(sql, /created_family_space_id, current_user_id, 'owner'/)
  assert.match(sql, /grant execute on function public\.create_household_with_default_spaces\(text\) to authenticated/)
  assert.doesNotMatch(sql, /adult_member/)
})

const repairMigration = new URL('../supabase/migrations/20260913143000_repair_missing_profiles_on_household_create.sql', import.meta.url)

test('household onboarding repairs a missing profile for a signed-in legacy account', async () => {
  const sql = await readFile(repairMigration, 'utf8')

  assert.match(sql, /insert into public\.profiles \(id, display_name\)/)
  assert.match(sql, /values \(current_user_id, left\(profile_name, 120\)\)/)
  assert.match(sql, /on conflict \(id\) do nothing/)
  assert.doesNotMatch(sql, /profile is still being prepared/)
})
