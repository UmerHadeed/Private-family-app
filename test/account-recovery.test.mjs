import test from 'node:test'
import assert from 'node:assert/strict'
import { readFile } from 'node:fs/promises'

const app = new URL('../app/page.jsx', import.meta.url)
const reset = new URL('../app/reset-password/page.jsx', import.meta.url)

test('account recovery sends a non-enumerating reset link and requires an authenticated recovery session to update a password', async () => {
  const [source, resetSource] = await Promise.all([readFile(app, 'utf8'), readFile(reset, 'utf8')])
  assert.match(source, /resetPasswordForEmail/)
  assert.match(source, /next=\/reset-password/)
  assert.match(source, /If this email has an account/)
  assert.match(resetSource, /supabase\.auth\.getUser/)
  assert.match(resetSource, /supabase\.auth\.updateUser\(\{ password \}\)/)
  assert.match(resetSource, /password\.length < 8/)
  assert.match(resetSource, /password !== confirm/)
})
