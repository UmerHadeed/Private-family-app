import test from 'node:test'
import assert from 'node:assert/strict'
import { readFile } from 'node:fs/promises'

const migration = new URL('../supabase/migrations/20260914100000_family_space_messaging.sql', import.meta.url)
const mimeMigration = new URL('../supabase/migrations/20260914101500_family_space_attachment_mime_types.sql', import.meta.url)
const chat = new URL('../app/family-chat.jsx', import.meta.url)

test('Family Space messages are membership-scoped and realtime-ready', async () => {
  const sql = await readFile(migration, 'utf8')
  assert.match(sql, /create table public\.conversations/)
  assert.match(sql, /create table public\.messages/)
  assert.match(sql, /reply_to_message_id uuid references public\.messages/)
  assert.match(sql, /deleted_at timestamptz/)
  assert.match(sql, /create policy "messages: conversation members read"/)
  assert.match(sql, /sender_user_id = auth\.uid\(\)/)
  assert.match(sql, /alter publication supabase_realtime add table public\.messages/)
  assert.match(sql, /file_size_limit = 5368709120/)
})

test('Family Space permits private message attachments and ordinary file MIME types', async () => {
  const [sql, mimeSql] = await Promise.all([readFile(migration, 'utf8'), readFile(mimeMigration, 'utf8')])
  assert.match(sql, /create table public\.message_attachments/)
  assert.match(sql, /byte_size <= 5368709120/)
  assert.match(sql, /Attachments can only be published by the sending user/)
  assert.match(mimeSql, /allowed_mime_types = null/)
})

test('Family chat uses persisted realtime messaging, resumable uploads, voice recording and emoji input', async () => {
  const source = await readFile(chat, 'utf8')
  assert.match(source, /from\('messages'\)\.insert/)
  assert.match(source, /postgres_changes/)
  assert.match(source, /new Upload\(file/)
  assert.match(source, /chunkSize: TUS_THRESHOLD/)
  assert.match(source, /navigator\.mediaDevices\.getUserMedia/)
  assert.match(source, /MediaRecorder/)
  assert.match(source, /EMOJIS/)
  assert.match(source, /reply_to_message_id/)
  assert.match(source, /deleted_at/)
})
