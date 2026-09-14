import test from 'node:test'
import assert from 'node:assert/strict'
import { readFile } from 'node:fs/promises'

const page = new URL('../app/page.jsx', import.meta.url)

test('capture module uploads only into an explicitly selected permitted space', async () => {
  const source = await readFile(page, 'utf8')

  assert.match(source, /storage\.from\('family-assets'\)\.upload/)
  assert.match(source, /\$\{context\.householdId\}\/\$\{spaceId\}\/\$\{id\}/)
  assert.match(source, /from\('assets'\)\.insert/)
  assert.match(source, /space_id: spaceId/)
  assert.match(source, /uploaded_by_user_id: context\.userId/)
  assert.match(source, /await supabase\.storage\.from\('family-assets'\)\.remove/)
  assert.match(source, /Private items are never shared by default/)
})
