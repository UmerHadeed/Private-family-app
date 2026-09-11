'use client'

import { useEffect, useMemo, useRef, useState } from 'react'
import { getSupabaseBrowserClient } from '../lib/supabase/client'
import './page.css'

const NAV = [
  ['Home', '⌂'], ['Family AI', '✧'], ['Memories', '▧'], ['Family', '♧'], ['My Vault', '⌑']
]
const PEOPLE = [
  { name: 'Umer Hadeed', initials: 'UH', tone: 'blue', role: 'You' },
  { name: 'Sara', initials: 'SA', tone: 'orange', role: 'Partner' },
  { name: 'Aileen', initials: 'AI', tone: 'pink', role: 'Child profile' },
  { name: 'Hasn', initials: 'HA', tone: 'gold', role: 'Child profile' }
]
const SEED_MEMORIES = [
  { id: 1, title: 'Aileen’s beach voice note', type: 'Voice note', person: 'Aileen', date: '8 Jun 2022', scope: 'Family', caption: 'A quiet moment from Aileen’s first beach day.', voice: true },
  { id: 2, title: 'School open morning', type: 'Document', person: 'Aileen · Hasn', date: 'Today', scope: 'Family', caption: 'Details shared in the family conversation.' },
  { id: 3, title: 'Birthday cake inspiration', type: 'Photo', person: 'Aileen', date: '4 Jun', scope: 'Family', caption: 'Cake ideas saved for Aileen’s birthday.' },
  { id: 4, title: 'Home insurance renewal', type: 'Document', person: 'You', date: '28 May', scope: 'Private', caption: 'A private renewal document.' }
]
const INITIAL_MESSAGES = [
  { id: 1, from: 'Sara', initials: 'SA', tone: 'orange', time: '9:12 AM', body: 'School has confirmed the open morning for next Friday.' },
  { id: 2, from: 'You', initials: 'UH', tone: 'blue', time: '9:15 AM', body: 'Great. I have added it to the family calendar.' },
  { id: 3, from: 'Family AI', initials: 'AI', tone: 'ai', time: '9:16 AM', ai: true, body: 'I can help organise approved shared memories. Private vaults and unapproved sources stay out.' }
]

function Avatar({ initials, tone = 'blue' }) { return <span className={`avatar ${tone}`}>{initials}</span> }
function IconButton({ children, label, ...props }) { return <button type="button" aria-label={label} title={label} {...props}>{children}</button> }

export default function App() { return <AuthGate><FamilyApp /></AuthGate> }

function AuthGate({ children }) {
  const supabase = getSupabaseBrowserClient()
  const [state, setState] = useState(() => ({ loading: Boolean(supabase), user: null, configured: Boolean(supabase) }))
  const [mode, setMode] = useState('signin'), [email, setEmail] = useState(''), [password, setPassword] = useState(''), [message, setMessage] = useState(''), [busy, setBusy] = useState(false)
  useEffect(() => {
    if (!supabase) return
    supabase.auth.getUser().then(({ data: { user } }) => setState({ loading: false, user, configured: true }))
    const { data: { subscription } } = supabase.auth.onAuthStateChange((_event, session) => setState({ loading: false, user: session?.user ?? null, configured: true }))
    return () => subscription.unsubscribe()
  }, [supabase])
  const submit = async event => {
    event.preventDefault(); if (!supabase || busy) return
    setBusy(true); setMessage('')
    const credentials = { email: email.trim(), password }
    const result = mode === 'signin' ? await supabase.auth.signInWithPassword(credentials) : await supabase.auth.signUp({ ...credentials, options: { emailRedirectTo: `${window.location.origin}/auth/callback` } })
    setBusy(false)
    if (result.error) return setMessage(result.error.message)
    setMessage(mode === 'signup' && !result.data.session ? 'Check your email to confirm your account, then sign in.' : 'Signed in successfully.')
  }
  const signInGoogle = async () => {
    if (!supabase || busy) return
    setBusy(true); setMessage('')
    const { error } = await supabase.auth.signInWithOAuth({ provider: 'google', options: { redirectTo: `${window.location.origin}/auth/callback` } })
    if (error) { setMessage(error.message); setBusy(false) }
  }
  if (state.loading) return <AuthShell><p>Checking your secure session…</p></AuthShell>
  if (!state.configured) return <AuthShell><p className="kicker">PRIVATE FAMILY OS</p><h1>Connect Supabase to continue.</h1><p>Add the public Supabase URL and publishable key to <code>.env.local</code>.</p></AuthShell>
  if (!state.user) return <AuthShell><p className="kicker">PRIVATE FAMILY OS</p><h1>{mode === 'signin' ? 'Welcome back.' : 'Create your private account.'}</h1><p>Sign in to access only the household spaces explicitly shared with you.</p><form className="auth-form" onSubmit={submit}><label>Email<input type="email" autoComplete="email" value={email} onChange={e => setEmail(e.target.value)} required /></label><label>Password<input type="password" autoComplete={mode === 'signin' ? 'current-password' : 'new-password'} minLength="8" value={password} onChange={e => setPassword(e.target.value)} required /></label><button className="primary" disabled={busy}>{busy ? 'Please wait…' : mode === 'signin' ? 'Sign in' : 'Create account'}</button></form>{message && <p className="auth-message" role="status">{message}</p>}<div className="auth-divider">or</div><button className="secondary full" disabled={busy} onClick={signInGoogle}>Continue with Google</button><button className="text-button" disabled={busy} onClick={() => { setMode(mode === 'signin' ? 'signup' : 'signin'); setMessage('') }}>{mode === 'signin' ? 'New here? Create an account' : 'Already have an account? Sign in'}</button></AuthShell>
  return <HouseholdGate supabase={supabase}>{children}</HouseholdGate>
}
function AuthShell({ children }) { return <main className="auth-screen"><section className="auth-card"><span className="auth-logo">♡</span>{children}</section></main> }
function HouseholdGate({ supabase, children }) {
  const [state, setState] = useState('checking'), [name, setName] = useState(''), [message, setMessage] = useState(''), [busy, setBusy] = useState(false)
  useEffect(() => { let live = true; supabase.from('household_members').select('household_id').is('revoked_at', null).limit(1).then(({ data, error }) => { if (!live) return; if (error) { setMessage('We could not check your household access. Please try again.'); setState('error') } else setState(data?.length ? 'ready' : 'onboarding') }); return () => { live = false } }, [supabase])
  const create = async event => { event.preventDefault(); const householdName = name.trim(); if (!householdName || busy) return; setBusy(true); setMessage(''); const { error } = await supabase.rpc('create_household_with_default_spaces', { household_name: householdName }); setBusy(false); if (error) return setMessage(error.message); setState('ready') }
  if (state === 'checking') return <AuthShell><p>Checking your household access…</p></AuthShell>
  if (state === 'ready') return children
  return <AuthShell><p className="kicker">YOUR HOUSEHOLD</p><h1>Start your private family space.</h1><p>Create the household you control. Your private vault remains separate from Family.</p><form className="auth-form" onSubmit={create}><label>Household name<input autoFocus maxLength="120" value={name} onChange={e => setName(e.target.value)} required /></label><button className="primary" disabled={busy}>{busy ? 'Creating your spaces…' : 'Create my household'}</button></form>{message && <p className="auth-message" role="alert">{message}</p>}<button className="text-button" onClick={() => supabase.auth.signOut()}>Use a different account</button></AuthShell>
}

function FamilyApp() {
  const [page, setPage] = useState('Home'), [query, setQuery] = useState(''), [messages, setMessages] = useState(INITIAL_MESSAGES), [memories, setMemories] = useState(SEED_MEMORIES), [notice, setNotice] = useState('')
  const flash = text => { setNotice(text); window.setTimeout(() => setNotice(''), 3500) }
  const filtered = useMemo(() => memories.filter(memory => Object.values(memory).join(' ').toLowerCase().includes(query.toLowerCase())), [memories, query])
  const addVoiceMemory = ({ url, duration }) => setMemories(items => [{ id: Date.now(), title: 'Voice note from Family chat', type: 'Voice note', person: 'You', date: 'Now', scope: 'Family', caption: `A ${duration} voice note recorded in this browser session.`, voice: true, url }, ...items])
  return <div className="app-shell"><Sidebar page={page} setPage={setPage} /><main className="main"><header className="topbar"><span className="preview-dot">Design preview · local content</span><label className="search"><span>⌕</span><input aria-label="Search memories" value={query} onChange={e => setQuery(e.target.value)} placeholder="Search memories" /></label></header><div className="content">{notice && <div className="notice" role="status">{notice}</div>}{page === 'Home' && <Home setPage={setPage} memories={memories} />}{page === 'Family AI' && <FamilyAI flash={flash} />}{page === 'Memories' && <Memories memories={filtered} query={query} />}{page === 'Family' && <Family messages={messages} setMessages={setMessages} onVoiceSaved={addVoiceMemory} flash={flash} />}{page === 'My Vault' && <Vault memories={filtered.filter(memory => memory.scope === 'Private')} />}</div></main><nav className="mobile-nav">{NAV.map(([name, icon]) => <button key={name} className={page === name ? 'active' : ''} onClick={() => setPage(name)}><span>{icon}</span>{name}</button>)}</nav></div>
}
function Sidebar({ page, setPage }) { return <aside className="sidebar"><div className="brand"><b>♡ private</b><small>A little closer, every day.</small></div><nav>{NAV.map(([name, icon]) => <button key={name} className={page === name ? 'active' : ''} onClick={() => setPage(name)}><span>{icon}</span>{name}</button>)}</nav><div className="sidebar-footer"><span>♙ Private by design</span><div><Avatar initials="UH" /><p><b>Umer Hadeed</b><small>Illustrative household</small></p></div></div></aside> }
function Heading({ eyebrow, title, children, action }) { return <header className="heading"><div><p className="kicker">{eyebrow}</p><h1>{title}</h1>{children && <p className="sub">{children}</p>}</div>{action}</header> }
function Home({ setPage, memories }) { return <><Heading eyebrow="YOUR FAMILY, TOGETHER" title="Good morning.">A quiet place for the moments you want to keep.</Heading><section className="quick-grid"><button onClick={() => setPage('Family')}><b>♧ Family</b><small>Talk, share and save moments together.</small></button><button onClick={() => setPage('Family AI')}><b>✧ Ask Family AI</b><small>Help using only approved family sources.</small></button><button onClick={() => setPage('Memories')}><b>＋ Add a memory</b><small>Keep a photo, note, file or voice note.</small></button></section><section className="section-head"><div><p className="kicker">RECENTLY KEPT</p><h2>Your family story</h2></div><button className="link" onClick={() => setPage('Memories')}>See all →</button></section><MemoryList memories={memories.slice(0, 3)} /></> }
function FamilyAI({ flash }) { const [question, setQuestion] = useState(''); return <><Heading eyebrow="FAMILY AI" title="Ask about what you’ve shared.">Family AI only works with sources you approve. My Vault stays out unless you explicitly include it.</Heading><section className="ai-panel"><div><p className="kicker">FAMILY AI · LOCAL PREVIEW</p><h2>How can I help?</h2><p>Ask about approved memories, documents or plans. This preview does not call a model or send your data.</p></div><form onSubmit={e => { e.preventDefault(); if (question.trim()) { flash('Your question remains local in this preview. No model was contacted.'); setQuestion('') } }}><textarea value={question} onChange={e => setQuestion(e.target.value)} placeholder="Ask about your approved family memories…" /><button className="primary">Ask Family AI →</button></form></section></> }
function Memories({ memories, query }) { return <><Heading eyebrow="YOUR FAMILY STORY" title="Memories">{query ? `Showing results for “${query}”.` : 'Approved family memories, with the context that makes them meaningful.'}</Heading>{memories.length ? <MemoryList memories={memories} /> : <div className="empty"><h2>No matching memories</h2><p>Try a different search term. Your query stays available above.</p></div>}</> }
function Vault({ memories }) { return <><Heading eyebrow="PRIVATE TO YOU" title="My Vault">Your personal collection stays private unless you deliberately share an item.</Heading>{memories.length ? <MemoryList memories={memories} privateView /> : <div className="empty"><h2>Your vault is clear</h2><p>Private items will appear here once they are connected to your account.</p></div>}</> }
function MemoryList({ memories, privateView = false }) { return <section className="memory-list">{memories.map(memory => <article className="memory-row" key={memory.id}><div className={`memory-icon ${memory.type.toLowerCase().replace(' ', '-')}`}>{memory.voice ? '〰' : memory.type === 'Photo' ? '▧' : '▤'}</div><div><p className="kicker">{memory.type} · {privateView ? 'PRIVATE' : memory.scope.toUpperCase()}</p><h2>{memory.title}</h2><p>{memory.caption}</p><small>{memory.person} · {memory.date}</small>{memory.url && <audio controls src={memory.url}>Your browser cannot play this recording.</audio>}</div></article>)}</section> }

function Family({ messages, setMessages, onVoiceSaved, flash }) { return <><Heading eyebrow="YOUR FAMILY, TOGETHER" title="Family">People and AI, in one shared conversation.</Heading><div className="family-tabs"><button className="active">Chat</button><button onClick={() => flash('People management needs its connected access module.')}>People</button></div><section className="conversation-card"><header className="conversation-head"><div><h2>Family conversation</h2><p>Illustrative household · messages are visible to this shared space</p></div><span>Preview only</span></header><div className="participants"><button>♧ Family members</button><button>✧ Family AI</button><button onClick={() => flash('Adding members needs the connected invitation module.')}>＋ Agent</button></div><p className="scope-note">♙ Agents respond only when mentioned. Chat membership does not grant access to photos, files, Drive or private vaults.</p><div className="message-log" aria-label="Family conversation">{messages.map(message => <Message key={message.id} message={message} />)}</div><ChatComposer setMessages={setMessages} onVoiceSaved={onVoiceSaved} flash={flash} /></section></> }
function Message({ message }) { return <article className={message.ai ? 'message ai-message' : 'message'}><Avatar initials={message.initials} tone={message.tone} /><div><p><b>{message.from}</b>{message.ai && <em>AI AGENT</em>} <small>{message.time}</small></p>{message.body && <span>{message.body}</span>}{message.audioUrl && <audio controls src={message.audioUrl}>Your browser cannot play this recording.</audio>}{message.ai && <small className="source-label">Example scope: approved Family collection</small>}</div></article> }
function ChatComposer({ setMessages, onVoiceSaved, flash }) {
  const [text, setText] = useState(''), [recording, setRecording] = useState(false), [elapsed, setElapsed] = useState(0), [audio, setAudio] = useState(null), [error, setError] = useState('')
  const recorderRef = useRef(null), streamRef = useRef(null), chunksRef = useRef([]), startedRef = useRef(0), timerRef = useRef(null), urlsRef = useRef([])
  useEffect(() => () => { window.clearInterval(timerRef.current); streamRef.current?.getTracks().forEach(track => track.stop()); urlsRef.current.forEach(url => URL.revokeObjectURL(url)) }, [])
  const stopTracks = () => { streamRef.current?.getTracks().forEach(track => track.stop()); streamRef.current = null }
  const startRecording = async () => {
    setError('')
    if (!navigator.mediaDevices?.getUserMedia || !window.MediaRecorder) return setError('Voice recording is not supported in this browser.')
    try {
      const stream = await navigator.mediaDevices.getUserMedia({ audio: true }); streamRef.current = stream; chunksRef.current = []
      const recorder = new MediaRecorder(stream); recorderRef.current = recorder; startedRef.current = Date.now()
      recorder.ondataavailable = event => { if (event.data.size) chunksRef.current.push(event.data) }
      recorder.onstop = () => { const blob = new Blob(chunksRef.current, { type: recorder.mimeType || 'audio/webm' }); const url = URL.createObjectURL(blob); urlsRef.current.push(url); const seconds = Math.max(1, Math.round((Date.now() - startedRef.current) / 1000)); setAudio({ url, blob, seconds }); setRecording(false); window.clearInterval(timerRef.current); stopTracks() }
      recorder.start(); setElapsed(0); setRecording(true); timerRef.current = window.setInterval(() => setElapsed(Math.floor((Date.now() - startedRef.current) / 1000)), 250)
    } catch { setError('Microphone access was not granted. You can still send a text message.') }
  }
  const stopRecording = () => recorderRef.current?.state === 'recording' && recorderRef.current.stop()
  const discard = () => { if (recording) stopRecording(); if (audio?.url) URL.revokeObjectURL(audio.url); setAudio(null); setElapsed(0) }
  const send = event => { event.preventDefault(); if (!text.trim() && !audio) return; const time = 'Now'; const body = text.trim(); setMessages(items => [...items, { id: Date.now(), from: 'You', initials: 'UH', tone: 'blue', time, body, audioUrl: audio?.url }]); if (audio) onVoiceSaved({ url: audio.url, duration: `${audio.seconds}s` }); setText(''); setAudio(null); setElapsed(0); flash(audio ? 'Voice note added to this local conversation preview.' : 'Message added to this local conversation preview.') }
  const duration = `${String(Math.floor(elapsed / 60)).padStart(1, '0')}:${String(elapsed % 60).padStart(2, '0')}`
  return <form className="chat-composer" onSubmit={send}><div className="composer-top"><label>Reply to <select aria-label="Message recipient"><option>Everyone</option><option>Family AI</option></select></label><span>Local preview only</span></div>{audio && <div className="voice-preview"><span>● Voice note · {audio.seconds}s</span><audio controls src={audio.url}>Your browser cannot play this recording.</audio><IconButton label="Discard voice note" className="discard" onClick={discard}>×</IconButton></div>}<textarea value={text} onChange={e => setText(e.target.value)} maxLength="3000" placeholder={recording ? `Recording ${duration}…` : 'Message your family or ask an agent…'} aria-label="Message your family" disabled={recording} /><div className="composer-actions"><div>{recording ? <button type="button" className="recording" onClick={stopRecording}>■ Stop · {duration}</button> : <button type="button" className="attach" onClick={startRecording}>◉ Record voice</button>}<button type="button" className="attach" onClick={() => flash('Attachment upload needs the connected storage module.')}>＋ Attach</button></div><button className="primary" disabled={!text.trim() && !audio}>Add message →</button></div>{error && <p className="composer-error" role="alert">{error}</p>}</form>
}
