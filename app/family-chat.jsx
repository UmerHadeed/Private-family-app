'use client'
/* eslint-disable @next/next/no-img-element */

import { useCallback, useEffect, useMemo, useRef, useState } from 'react'
import { Upload } from 'tus-js-client'

const EMOJIS = ['😀', '😂', '❤️', '👍', '👎', '🎉', '🙏', '😍', '🥰', '😢', '🔥', '✅', '👀', '👏', '🤍', '💬']
const MAX_BYTES = 5 * 1024 * 1024 * 1024
const TUS_THRESHOLD = 6 * 1024 * 1024

function initials(name = 'Family member') {
  return name.split(/\s+/).filter(Boolean).slice(0, 2).map(part => part[0]).join('').toUpperCase() || 'FM'
}
function formatTime(value) {
  return new Intl.DateTimeFormat(undefined, { hour: 'numeric', minute: '2-digit' }).format(new Date(value))
}
function formatBytes(bytes) {
  if (bytes < 1024 * 1024) return `${Math.max(1, Math.ceil(bytes / 1024))} KB`
  if (bytes < 1024 * 1024 * 1024) return `${(bytes / 1024 / 1024).toFixed(1)} MB`
  return `${(bytes / 1024 / 1024 / 1024).toFixed(2)} GB`
}
function attachmentKind(file) {
  if (file.type.startsWith('image/')) return 'image'
  if (file.type.startsWith('video/')) return 'video'
  if (file.type.startsWith('audio/')) return 'audio'
  if (/pdf|word|excel|powerpoint|text|rtf|openxml|opendocument/.test(file.type)) return 'document'
  return 'file'
}
function safeFilename(name) {
  return (name || 'attachment').replace(/[^a-zA-Z0-9._-]/g, '_').slice(0, 180) || 'attachment'
}

export default function FamilyChat({ supabase, context, spaces, flash }) {
  const familySpace = useMemo(() => spaces.find(space => space.space_type === 'family'), [spaces])
  const [conversation, setConversation] = useState(null)
  const [messages, setMessages] = useState([])
  const [loading, setLoading] = useState(true)
  const [error, setError] = useState('')
  const [replyTarget, setReplyTarget] = useState(null)
  const endRef = useRef(null)

  const load = useCallback(async () => {
    if (!supabase || !familySpace) { setLoading(false); return }
    setError('')
    const { data: conversationRow, error: conversationError } = await supabase.from('conversations').select('id,space_id').eq('space_id', familySpace.id).maybeSingle()
    if (conversationError) { setError(conversationError.message); setLoading(false); return }
    if (!conversationRow) { setError('Family conversation is being prepared. Refresh in a moment.'); setLoading(false); return }
    const { data: messageRows, error: messagesError } = await supabase.from('messages').select('*').eq('conversation_id', conversationRow.id).order('created_at', { ascending: false }).limit(100)
    if (messagesError) { setError(messagesError.message); setLoading(false); return }
    const ordered = [...(messageRows || [])].reverse()
    const ids = ordered.map(message => message.id)
    const { data: attachmentRows, error: attachmentError } = ids.length
      ? await supabase.from('message_attachments').select('*').in('message_id', ids).order('created_at')
      : { data: [], error: null }
    if (attachmentError) { setError(attachmentError.message); setLoading(false); return }
    const attachments = await Promise.all((attachmentRows || []).map(async attachment => {
      const { data } = await supabase.storage.from('family-assets').createSignedUrl(attachment.storage_path, 3600)
      return { ...attachment, url: data?.signedUrl || null }
    }))
    const attachmentMap = new Map()
    attachments.forEach(attachment => attachmentMap.set(attachment.message_id, [...(attachmentMap.get(attachment.message_id) || []), attachment]))
    setConversation(conversationRow)
    setMessages(ordered.map(message => ({ ...message, attachments: attachmentMap.get(message.id) || [] })))
    setLoading(false)
  }, [familySpace, supabase])

  useEffect(() => { const timer = window.setTimeout(() => { void load() }, 0); return () => window.clearTimeout(timer) }, [load])
  useEffect(() => {
    if (!supabase || !conversation?.id) return undefined
    const channel = supabase.channel(`family-space-${conversation.id}`)
      .on('postgres_changes', { event: '*', schema: 'public', table: 'messages', filter: `conversation_id=eq.${conversation.id}` }, () => void load())
      .on('postgres_changes', { event: '*', schema: 'public', table: 'message_attachments' }, () => void load())
      .subscribe()
    return () => { supabase.removeChannel(channel) }
  }, [conversation?.id, load, supabase])
  useEffect(() => { endRef.current?.scrollIntoView({ block: 'end' }) }, [messages.length])

  if (!familySpace) return <section className="family-live-card empty"><h2>Family Space is unavailable</h2><p>Your account has no shared Family Space membership yet.</p></section>
  return <><header className="heading"><div><p className="kicker">YOUR FAMILY, TOGETHER</p><h1>Family</h1><p className="sub">A private, live conversation for everyone in your Family Space.</p></div></header><section className="family-live-card"><header className="conversation-head"><div><h2>Family conversation</h2><p>Messages and attachments are visible only to Family Space members.</p></div><span className="live-state"><i /> Live</span></header><p className="scope-note">Your My Vault remains separate. Sharing a file here publishes it only to this shared Family Space.</p>{error && <div className="chat-error" role="alert">{error}<button type="button" onClick={() => void load()}>Try again</button></div>}<div className="message-log live" aria-live="polite" aria-label="Family conversation">{loading ? <p className="chat-loading">Loading your private conversation…</p> : messages.length ? messages.map(message => <ChatMessage key={message.id} message={message} replyMessage={messages.find(candidate => candidate.id === message.reply_to_message_id)} currentUserId={context?.userId} onRefresh={load} supabase={supabase} onReply={setReplyTarget} />) : <div className="chat-empty"><h3>Start the family conversation</h3><p>Send a message, a voice note or an attachment. Only Family Space members can see it.</p></div>}<div ref={endRef} /></div><Composer supabase={supabase} context={context} familySpace={familySpace} conversation={conversation} messages={messages} replyTo={replyTarget} setReplyTo={setReplyTarget} onPublished={load} flash={flash} /></section></>
}

function ChatMessage({ message, replyMessage, currentUserId, onRefresh, supabase, onReply }) {
  const [menuOpen, setMenuOpen] = useState(false)
  const [editing, setEditing] = useState(false)
  const [draft, setDraft] = useState(message.body || '')
  const [busy, setBusy] = useState(false)
  const author = message.sender_user_id === currentUserId
  const reply = replyMessage || (message.reply_to_message_id ? { id: message.reply_to_message_id, sender_display_name: 'Earlier message', body: 'Message no longer in this view' } : null)
  const saveEdit = async () => {
    const body = draft.trim()
    if (!body || body === message.body || busy) { setEditing(false); return }
    setBusy(true)
    const { error } = await supabase.from('messages').update({ body }).eq('id', message.id)
    setBusy(false)
    if (error) window.alert(error.message); else { setEditing(false); void onRefresh() }
  }
  const deleteMessage = async () => {
    if (!window.confirm('Delete this message for everyone in Family Space? This cannot be undone.')) return
    setBusy(true)
    const { error } = await supabase.from('messages').update({ deleted_at: new Date().toISOString() }).eq('id', message.id)
    setBusy(false)
    setMenuOpen(false)
    if (error) window.alert(error.message); else void onRefresh()
  }
  return <article className={`chat-message ${author ? 'mine' : ''} ${message.deleted_at ? 'deleted' : ''}`} id={`message-${message.id}`}><span className="chat-avatar">{initials(message.sender_display_name)}</span><div className="message-bubble"><header><b>{author ? 'You' : message.sender_display_name}</b><time>{formatTime(message.created_at)}</time>{message.edited_at && !message.deleted_at ? <small>Edited</small> : null}<div className="message-menu"><button type="button" aria-label="Message actions" onClick={() => setMenuOpen(open => !open)}>⋮</button>{menuOpen && <div><button type="button" onClick={() => { onReply(message); setMenuOpen(false) }}>Reply</button>{author && !message.deleted_at && <button type="button" onClick={() => { setEditing(true); setMenuOpen(false) }}>Edit</button>}{author && !message.deleted_at && <button type="button" className="danger" disabled={busy} onClick={deleteMessage}>Delete</button>}</div>}</div></header>{reply && <button type="button" className="reply-stub" onClick={() => document.getElementById(`message-${reply.id}`)?.scrollIntoView({ behavior: 'smooth', block: 'center' })}><b>{reply.sender_display_name}</b><span>{reply.deleted_at ? 'This message was deleted.' : reply.body || (reply.attachments?.length ? 'Attachment' : 'Message')}</span></button>}{message.deleted_at ? <p className="deleted-copy">This message was deleted.</p> : editing ? <div className="edit-box"><textarea aria-label="Edit message" value={draft} onChange={event => setDraft(event.target.value)} maxLength="10000"/><div><button type="button" onClick={() => setEditing(false)}>Cancel</button><button type="button" className="primary" disabled={busy || !draft.trim()} onClick={saveEdit}>Save</button></div></div> : <>{message.body && <p className="message-copy">{message.body}</p>}<AttachmentList attachments={message.attachments} /></>}</div></article>
}

function AttachmentList({ attachments }) {
  if (!attachments?.length) return null
  return <div className="attachment-list">{attachments.map(attachment => <article className="chat-attachment" key={attachment.id}>{attachment.kind === 'image' && attachment.url ? <img src={attachment.url} alt={attachment.filename} /> : attachment.kind === 'audio' && attachment.url ? <audio controls src={attachment.url}>Your browser cannot play this audio.</audio> : attachment.kind === 'video' && attachment.url ? <video controls src={attachment.url} preload="metadata" /> : <span className="file-glyph">{attachment.kind === 'document' ? 'DOC' : 'FILE'}</span>}<div><b>{attachment.filename}</b><small>{formatBytes(attachment.byte_size)} · {attachment.kind}</small>{attachment.url && <a href={attachment.url} target="_blank" rel="noreferrer">Open attachment</a>}</div></article>)}</div>
}

function Composer({ supabase, context, familySpace, conversation, replyTo, setReplyTo, onPublished, flash }) {
  const [text, setText] = useState('')
  const [files, setFiles] = useState([])
  const [emojiOpen, setEmojiOpen] = useState(false)
  const [recording, setRecording] = useState(false)
  const [recorded, setRecorded] = useState(null)
  const [elapsed, setElapsed] = useState(0)
  const [busy, setBusy] = useState(false)
  const [progress, setProgress] = useState(null)
  const [error, setError] = useState('')
  const fileRef = useRef(null)
  const recorderRef = useRef(null)
  const streamRef = useRef(null)
  const chunksRef = useRef([])
  const timerRef = useRef(null)
  const startedRef = useRef(0)
  const recordedUrlRef = useRef(null)

  useEffect(() => () => { window.clearInterval(timerRef.current); streamRef.current?.getTracks().forEach(track => track.stop()); if (recordedUrlRef.current) URL.revokeObjectURL(recordedUrlRef.current) }, [])
  const stopTracks = () => { streamRef.current?.getTracks().forEach(track => track.stop()); streamRef.current = null }
  const addFiles = incoming => {
    const next = [...files, ...Array.from(incoming || [])]
    const tooLarge = next.find(file => file.size > MAX_BYTES)
    if (tooLarge) { setError(`${tooLarge.name} is larger than the 5 GB Family Space limit.`); return }
    setFiles(next); setError('')
  }
  const startRecording = async () => {
    setError('')
    if (!navigator.mediaDevices?.getUserMedia || !window.MediaRecorder) { setError('Voice recording is not supported in this browser. You can attach an audio file instead.'); return }
    try {
      const stream = await navigator.mediaDevices.getUserMedia({ audio: true })
      streamRef.current = stream; chunksRef.current = []; startedRef.current = Date.now()
      const recorder = new MediaRecorder(stream)
      recorderRef.current = recorder
      recorder.ondataavailable = event => { if (event.data.size) chunksRef.current.push(event.data) }
      recorder.onstop = () => {
        const mimeType = recorder.mimeType || 'audio/webm'
        const blob = new Blob(chunksRef.current, { type: mimeType })
        if (recordedUrlRef.current) URL.revokeObjectURL(recordedUrlRef.current)
        const url = URL.createObjectURL(blob); recordedUrlRef.current = url
        setRecorded({ file: new File([blob], `voice-note-${Date.now()}.webm`, { type: mimeType }), url, seconds: Math.max(1, Math.round((Date.now() - startedRef.current) / 1000)) })
        setRecording(false); window.clearInterval(timerRef.current); stopTracks()
      }
      recorder.start(); setElapsed(0); setRecording(true)
      timerRef.current = window.setInterval(() => setElapsed(Math.floor((Date.now() - startedRef.current) / 1000)), 250)
    } catch { setError('Microphone permission was not granted. You can still send text or an attachment.') }
  }
  const stopRecording = () => { if (recorderRef.current?.state === 'recording') recorderRef.current.stop() }
  const discardRecording = () => { if (recording) stopRecording(); if (recordedUrlRef.current) URL.revokeObjectURL(recordedUrlRef.current); recordedUrlRef.current = null; setRecorded(null); setElapsed(0) }
  const upload = async (file, messageId) => {
    const objectName = `${context.householdId}/${familySpace.id}/${messageId}/${crypto.randomUUID()}-${safeFilename(file.name)}`
    const publish = async () => {
      const { error } = await supabase.from('message_attachments').insert({ message_id: messageId, uploaded_by_user_id: context.userId, storage_path: objectName, filename: file.name.slice(0, 512), mime_type: file.type || 'application/octet-stream', byte_size: file.size, kind: attachmentKind(file), duration_seconds: recorded?.file === file ? recorded.seconds : null })
      if (error) { await supabase.storage.from('family-assets').remove([objectName]); throw error }
    }
    if (file.size <= TUS_THRESHOLD) {
      const { error } = await supabase.storage.from('family-assets').upload(objectName, file, { contentType: file.type || 'application/octet-stream', upsert: false })
      if (error) throw error
      await publish(); return
    }
    const { data: { session } } = await supabase.auth.getSession()
    if (!session) throw new Error('Your session has expired. Sign in again before uploading.')
    const projectUrl = new URL(process.env.NEXT_PUBLIC_SUPABASE_URL)
    const endpoint = `https://${projectUrl.hostname.replace('.supabase.co', '.storage.supabase.co')}/storage/v1/upload/resumable`
    await new Promise((resolve, reject) => {
      const resumable = new Upload(file, { endpoint, retryDelays: [0, 3000, 5000, 10000, 20000], headers: { authorization: `Bearer ${session.access_token}`, 'x-upsert': 'false' }, uploadDataDuringCreation: true, removeFingerprintOnSuccess: true, chunkSize: TUS_THRESHOLD, metadata: { bucketName: 'family-assets', objectName, contentType: file.type || 'application/octet-stream' }, onError: reject, onProgress: (uploaded, total) => setProgress({ name: file.name, uploaded, total }), onSuccess: resolve })
      resumable.findPreviousUploads().then(previous => { if (previous.length) resumable.resumeFromPreviousUpload(previous[0]); resumable.start() }).catch(reject)
    })
    await publish()
  }
  const send = async event => {
    event.preventDefault(); setError('')
    const allFiles = recorded ? [...files, recorded.file] : files
    const body = text.trim()
    if ((!body && !allFiles.length) || !conversation || !context || busy) return
    setBusy(true)
    const { data: message, error: messageError } = await supabase.from('messages').insert({ conversation_id: conversation.id, sender_user_id: context.userId, body: body || null, reply_to_message_id: replyTo?.id || null }).select().single()
    if (messageError) { setBusy(false); setError(messageError.message); return }
    try {
      for (const file of allFiles) await upload(file, message.id)
      setText(''); setFiles([]); discardRecording(); setReplyTo(null); setProgress(null); await onPublished(); flash?.(allFiles.length ? 'Message and attachment published to Family Space.' : 'Message sent to Family Space.')
    } catch (uploadError) { setError(`Message sent, but an attachment could not be published: ${uploadError.message || 'Upload failed.'} Retry by attaching that file again.`) }
    setBusy(false)
  }
  const duration = `0:${String(elapsed % 60).padStart(2, '0')}`
  return <form className="live-composer" onSubmit={send}>{replyTo && <div className="replying"><span>Replying to <b>{replyTo.sender_display_name}</b></span><button type="button" onClick={() => setReplyTo(null)} aria-label="Cancel reply">×</button></div>}<div className="composer-entry"><button className="emoji-button" type="button" aria-label="Choose emoji" onClick={() => setEmojiOpen(open => !open)}>☺</button>{emojiOpen && <div className="emoji-picker" role="dialog" aria-label="Emoji picker">{EMOJIS.map(emoji => <button type="button" key={emoji} onClick={() => { setText(value => `${value}${emoji}`); setEmojiOpen(false) }}>{emoji}</button>)}</div>}<textarea value={text} onChange={event => setText(event.target.value)} maxLength="10000" disabled={recording || busy} placeholder={recording ? `Recording ${duration}…` : 'Message your family'} aria-label="Message your family"/><input ref={fileRef} hidden type="file" multiple onChange={event => { addFiles(event.target.files); event.target.value = '' }} />{recording ? <button type="button" className="recording-button" onClick={stopRecording}>Stop {duration}</button> : <button type="button" className="voice-button" aria-label="Record voice note" onClick={startRecording}>Mic</button>}</div>{recorded && <div className="recorded-note"><span>Voice note · {recorded.seconds}s</span><audio controls src={recorded.url}>Your browser cannot play this recording.</audio><button type="button" onClick={discardRecording}>Discard</button></div>}{files.length ? <div className="queued-files">{files.map((file, index) => <span key={`${file.name}-${index}`}>{file.name} · {formatBytes(file.size)}<button type="button" aria-label={`Remove ${file.name}`} onClick={() => setFiles(items => items.filter((_, fileIndex) => fileIndex !== index))}>×</button></span>)}</div> : null}{progress && <div className="upload-progress" role="status">Uploading {progress.name}: {Math.round((progress.uploaded / progress.total) * 100)}%</div>}<footer><button type="button" className="attach-file" disabled={busy || recording} onClick={() => fileRef.current?.click()}>Attach</button><span>Files up to 5 GB. Large uploads resume if interrupted.</span><button className="primary" disabled={busy || recording || (!text.trim() && !files.length && !recorded)}>{busy ? 'Publishing…' : 'Send'}</button></footer>{error && <p className="composer-error" role="alert">{error}</p>}</form>
}
