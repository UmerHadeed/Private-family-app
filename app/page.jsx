'use client'

import { useCallback, useEffect, useMemo, useRef, useState } from 'react'
import { getSupabaseBrowserClient } from '../lib/supabase/client'
import './page.css'

const NAV = [
  ['Today', '⌂'], ['Family Space', '♧'], ['My Vault', '⌑'], ['People', '◌'], ['Timeline', '↗'], ['Library', '▧'], ['Agent Studio', '✧']
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
  const supabase = getSupabaseBrowserClient()
  const [page, setPage] = useState('Today'), [query, setQuery] = useState(''), [messages, setMessages] = useState(INITIAL_MESSAGES), [memories, setMemories] = useState([]), [spaces, setSpaces] = useState([]), [context, setContext] = useState(null), [notice, setNotice] = useState(''), [captureOpen, setCaptureOpen] = useState(false), [loading, setLoading] = useState(true)
  const flash = text => { setNotice(text); window.setTimeout(() => setNotice(''), 3500) }
  const loadContent = useCallback(async () => {
    if (!supabase) return
    setLoading(true)
    const { data: { user } } = await supabase.auth.getUser()
    if (!user) return setLoading(false)
    const [{ data: memberships, error: membershipError }, { data: accessibleSpaces, error: spacesError }] = await Promise.all([
      supabase.from('household_members').select('household_id').eq('user_id', user.id).is('revoked_at', null).limit(1),
      supabase.from('spaces').select('id,name,space_type').order('created_at')
    ])
    if (membershipError || spacesError || !memberships?.[0]) { setLoading(false); return setNotice('We could not load your private content. Please refresh and try again.') }
    const { data: assets, error: assetsError } = await supabase.from('assets').select('id,space_id,asset_type,filename,mime_type,byte_size,created_at').is('deleted_at', null).order('created_at', { ascending: false })
    if (assetsError) { setLoading(false); return setNotice('We could not load your saved items. Please refresh and try again.') }
    const spaceById = new Map((accessibleSpaces || []).map(space => [space.id, space]))
    setContext({ userId: user.id, householdId: memberships[0].household_id })
    setSpaces(accessibleSpaces || [])
    setMemories((assets || []).map(asset => {
      const space = spaceById.get(asset.space_id)
      return { id: asset.id, title: asset.filename, type: asset.asset_type === 'audio' ? 'Voice note' : asset.asset_type[0].toUpperCase() + asset.asset_type.slice(1), person: space?.name || 'Private space', date: new Intl.DateTimeFormat(undefined, { month: 'short', day: 'numeric', year: 'numeric' }).format(new Date(asset.created_at)), scope: space?.space_type === 'private_vault' ? 'Private' : 'Family', caption: `${asset.mime_type} · ${Math.max(1, Math.ceil(asset.byte_size / 1024))} KB`, voice: asset.asset_type === 'audio' }
    }))
    setLoading(false)
  }, [supabase])
  useEffect(() => { const timer = window.setTimeout(() => { void loadContent() }, 0); return () => window.clearTimeout(timer) }, [loadContent])
  const filtered = useMemo(() => memories.filter(memory => Object.values(memory).join(' ').toLowerCase().includes(query.toLowerCase())), [memories, query])
  const addVoiceMemory = () => flash('Voice-note publishing to Family Space is the next module. Your browser recording stays private until then.')
  const openCapture = () => setCaptureOpen(true)
  const saved = async () => { await loadContent(); setCaptureOpen(false); setPage('Library'); flash('Saved to the selected private space.') }
  return <div className="app-shell"><Sidebar page={page} setPage={setPage} /><main className="main"><header className="topbar"><span className="preview-dot">PRIVATE FAMILY OS</span><label className="search"><span>⌕</span><input aria-label="Search memories" value={query} onChange={e => setQuery(e.target.value)} placeholder="Search memories" /></label></header><div className="content">{notice && <div className="notice" role="status">{notice}</div>}{page === 'Today' && <Home setPage={setPage} memories={memories} onCapture={openCapture} loading={loading} />}{page === 'Family Space' && <Family messages={messages} setMessages={setMessages} onVoiceSaved={addVoiceMemory} flash={flash} />}{page === 'My Vault' && <Vault memories={filtered.filter(memory => memory.scope === 'Private')} onCapture={openCapture} loading={loading} />}{page === 'People' && <People flash={flash} />}{page === 'Timeline' && <Timeline memories={filtered} onCapture={openCapture} loading={loading} />}{page === 'Library' && <Library memories={filtered} query={query} onCapture={openCapture} loading={loading} />}{page === 'Agent Studio' && <AgentStudio flash={flash} />}</div></main>{captureOpen && <CaptureModal supabase={supabase} context={context} spaces={spaces} close={() => setCaptureOpen(false)} onSaved={saved} />}{<nav className="mobile-nav" aria-label="Primary navigation">{NAV.map(([name, icon]) => <button key={name} className={page === name ? 'active' : ''} onClick={() => setPage(name)}><span>{icon}</span>{name}</button>)}</nav>}</div>
}
function Sidebar({ page, setPage }) { return <aside className="sidebar"><div className="brand"><b>♡ private</b><small>A little closer, every day.</small></div><nav>{NAV.map(([name, icon]) => <button key={name} className={page === name ? 'active' : ''} onClick={() => setPage(name)}><span>{icon}</span>{name}</button>)}</nav><div className="sidebar-footer"><span>♙ Private by design</span><div><Avatar initials="UH" /><p><b>Umer Hadeed</b><small>Illustrative household</small></p></div></div></aside> }
function Heading({ eyebrow, title, children, action }) { return <header className="heading"><div><p className="kicker">{eyebrow}</p><h1>{title}</h1>{children && <p className="sub">{children}</p>}</div>{action}</header> }
function Home({ setPage, memories, onCapture, loading }) { return <><PageHeading eyebrow="YOUR PRIVATE FAMILY SPACE" title="Home" text="Your family, memories and AI. All in one place." action="＋ Add memory" onAction={onCapture} /><section className="area-tiles">{[['Memories','Library','▧','Photos, notes & timeline'],['Family','Family Space','♧','People & shared space'],['My Vault','My Vault','⌑','Personal & private']].map(([name,page,icon,text])=><button key={name} onClick={()=>setPage(page)}><i>{icon}</i><span><b>{name}</b><small>{text}</small></span><em>›</em></button>)}</section><div className="home-workspace"><section className="panel ai-home"><PanelTitle icon="✧" title="Family AI" text="Your assistant, with access you control." link="Open ›" onClick={()=>setPage('Agent Studio')}/><form className="ask-box" onSubmit={e=>{e.preventDefault();setPage('Agent Studio')}}><input placeholder="Ask about a memory or family moment…"/><button className="primary" aria-label="Open Family AI">›</button></form><div className="suggestions"><button>Find a memory</button><button>Organise memories</button></div><div className="panel-foot"><span>⌑ Family collection only</span><button className="link" onClick={()=>setPage('Agent Studio')}>Manage access</button></div><div className="builder-link"><button className="link" onClick={()=>setPage('Agent Studio')}>＋ Create agent</button><span>Instructions · photos · files · Drive</span></div><p className="fine">Preview · AI isn’t connected yet.</p></section><section className="panel recent-panel"><PanelTitle title="Recent memories" link="View all ›" onClick={()=>setPage('Library')}/><div className="recent-list">{memories.filter(x=>x.scope==='Family').slice(0,3).map(memory=><CompactMemory key={memory.id} memory={memory}/>)}</div></section></div><section className="panel family-strip"><div><h3>Your family</h3><p className="fine">Illustrative profiles</p></div><div className="family-avatars">{PEOPLE.map(person=><button key={person.name} onClick={()=>setPage('People')}><Avatar initials={person.initials} tone={person.tone}/><span>{person.name.split(' ')[0]}</span></button>)}</div><button className="link" onClick={()=>setPage('People')}>Family ›</button></section></> }
function PageHeading({ eyebrow, title, text, action, onAction }) { return <header className="page-heading"><div><p className="kicker">{eyebrow}</p><h1>{title}</h1><p className="sub">{text}</p></div>{action&&<button className="primary" onClick={onAction}>{action}</button>}</header> }
function PanelTitle({ icon, title, text, link, onClick }) { return <div className="panel-title"><div>{icon&&<i>{icon}</i>}<span><h2>{title}</h2>{text&&<p>{text}</p>}</span></div>{link&&<button className="link" onClick={onClick}>{link}</button>}</div> }
function CompactMemory({memory}) { return <button className="compact-memory"><span className="mini-art">{memory.voice?'〰':memory.type==='Photo'?'▧':'▤'}</span><span><b>{memory.title}</b><small>{memory.type} · {memory.person} · {memory.scope}</small></span><em>›</em></button> }
function People({ flash }) { return <><PageHeading eyebrow="YOUR HOUSEHOLD" title="People" text="Profiles, family context and explicit access — all in one place." action="＋ Add person"/><section className="profile-grid-new">{PEOPLE.map(person=><article className="panel family-profile" key={person.name}><Avatar initials={person.initials} tone={person.tone}/><h2>{person.name}</h2><p>{person.role} · Illustrative profile</p><div><span>Family context</span><b>Source-linked memories</b></div><div><span>Private access</span><b>{person.role==='You'?'My Vault':person.role==='Partner'?'Own private vault':'Parent managed'}</b></div><button className="link" onClick={()=>flash(`Access management for ${person.name} needs the connected permission module.`)}>View memories ›</button></article>)}</section></> }
function Timeline({ memories, onCapture, loading }) { return <><PageHeading eyebrow="YOUR FAMILY STORY" title="Timeline" text="Big milestones. Small moments. Everything worth keeping." action="＋ Add memory" onAction={onCapture}/><CollectionToolbar/>{loading?<LoadingContent/>:<section className="timeline-new">{memories.map(memory=><article key={memory.id}><time>{memory.date}</time><i/><div><p className="kicker">{memory.type} · {memory.scope}</p><h2>{memory.title}</h2><p>{memory.caption}</p><small>{memory.person}</small></div></article>)}</section>}</> }
function CollectionToolbar(){return <div className="collection-toolbar"><div><button className="active">Browse</button><button>Timeline</button></div><select aria-label="Filter content"><option>All types</option><option>Photo</option><option>Voice note</option><option>Document</option></select></div>}
function Library({ memories, query, onCapture, loading }) { return <><PageHeading eyebrow="MEMORIES · FAMILY COLLECTION" title="Your family story." text={query?`Showing results for “${query}”.`:'Big milestones. Small moments. Everything worth keeping.'} action="＋ Add memory" onAction={onCapture}/><CollectionToolbar/>{loading?<LoadingContent/>:memories.length?<section className="memory-grid-new">{memories.map(memory=><MemoryCard key={memory.id} memory={memory}/>)}</section>:<EmptyCollection title="No memories found" text="Your approved family items will appear here." onCapture={onCapture}/>}</> }
function EmptyCollection({title,text,onCapture}){return <div className="empty"><h2>{title}</h2><p>{text}</p><button className="primary" onClick={onCapture}>＋ Add your first item</button></div>}
function LoadingContent(){return <div className="empty"><h2>Loading your private content…</h2><p>Only items in spaces you can access are shown.</p></div>}
function MemoryCard({memory}){return <article className="memory-card-new"><div className={`card-art ${memory.voice?'voice':''}`}>{memory.voice?'〰〰〰':memory.type==='Photo'?'▧':'▤'}</div><div><h2>{memory.title}</h2><p>{memory.person} · {memory.date}</p><small>{memory.caption}</small></div></article>}
function AgentStudio({ flash }) { const [tab,setTab]=useState('Instructions'),[question,setQuestion]=useState(''); return <><PageHeading eyebrow="BUILD YOUR FAMILY AI" title="Agent builder" text="Instructions, knowledge and permissions." action="Save draft"/><div className="agent-switch"><button>Chat</button><button className="active">Agent builder</button><button className="link">⌑ Access</button></div><div className="agent-tabs">{['Instructions','Sources & access','Review'].map(item=><button className={tab===item?'active':''} key={item} onClick={()=>setTab(item)}>{item}</button>)}</div><div className="builder-layout"><section className="panel builder-main">{tab==='Instructions'?<><h2>Teach your agent how to help</h2><p>System instructions guide behaviour. They do not fine-tune or train a model.</p><label>Agent name<input defaultValue="Family archive assistant"/></label><label>Purpose<input defaultValue="Organise approved family records"/></label><label>System prompt / instructions<textarea defaultValue="Use only approved sources. Cite original files. Ask before sharing."/></label><div className="helper"><b>Useful instructions include</b><span>Use only approved sources. Link answers to originals. Ask when uncertain. Never share private content or act without approval.</span></div><button className="primary builder-next" onClick={()=>setTab('Sources & access')}>Choose sources ›</button></>:<><h2>{tab}</h2><p>Choose only the sources this draft genuinely needs. My Vault is excluded by default.</p><div className="source-options">{['Photos','Documents','Files','Google Drive','Family collection','My Vault'].map(source=><label key={source}><input type="checkbox" defaultChecked={source==='Family collection'}/><span><b>{source}</b><small>{source==='My Vault'?'Private — not selected by default':'Preview source selection'}</small></span></label>)}</div><button className="primary builder-next" onClick={()=>flash('This agent draft remains local until a backend is connected.')}>Save draft ›</button></>}</section><aside className="builder-side"><section className="panel"><h2>Your agent drafts</h2><p>Save and reopen drafts. Reset on refresh.</p><button className="link">＋ Create another agent</button></section><section className="panel"><h2>Private by default</h2><p>No sources are preselected. Credentials do not belong in the system prompt.</p></section></aside></div></> }
function Vault({ memories, onCapture, loading }) { return <><PageHeading eyebrow="MY VAULT · ONLY YOU" title="Just for you." text="Your own space. Nothing shared unless you choose." action="＋ Add memory" onAction={onCapture}/><CollectionToolbar/>{loading?<LoadingContent/>:memories.length?<section className="memory-grid-new">{memories.map(memory=><MemoryCard key={memory.id} memory={memory}/>)}</section>:<EmptyCollection title="Your vault is clear" text="Private items you add will stay here unless you deliberately share them." onCapture={onCapture}/>}</> }
function CaptureModal({ supabase, context, spaces, close, onSaved }) {
  const [file, setFile] = useState(null), [spaceId, setSpaceId] = useState(() => spaces.find(space => space.space_type === 'private_vault')?.id || ''), [busy, setBusy] = useState(false), [error, setError] = useState('')
  const allowed = ['image/', 'video/', 'audio/', 'application/pdf', 'text/plain']
  const typeFor = file => file.type.startsWith('image/') ? 'photo' : file.type.startsWith('video/') ? 'video' : file.type.startsWith('audio/') ? 'audio' : file.type === 'text/plain' ? 'note' : 'document'
  const submit = async event => {
    event.preventDefault(); setError('')
    if (!context || !file || !spaceId || busy) return setError('Choose a file and the exact space where it belongs.')
    if (file.size > 52428800) return setError('Choose a file smaller than 50 MB.')
    if (!allowed.some(prefix => file.type === prefix || file.type.startsWith(prefix))) return setError('Choose a photo, video, audio file, PDF or plain-text note.')
    setBusy(true)
    const id = crypto.randomUUID(), safeName = file.name.replace(/[^a-zA-Z0-9._-]/g, '_').slice(0, 180) || 'untitled'
    const storagePath = `${context.householdId}/${spaceId}/${id}/${safeName}`
    const { error: uploadError } = await supabase.storage.from('family-assets').upload(storagePath, file, { contentType: file.type || 'application/octet-stream', upsert: false })
    if (uploadError) { setBusy(false); return setError(uploadError.message) }
    const { error: metadataError } = await supabase.from('assets').insert({ id, household_id: context.householdId, space_id: spaceId, uploaded_by_user_id: context.userId, asset_type: typeFor(file), storage_path: storagePath, filename: file.name.slice(0, 512), mime_type: file.type || 'application/octet-stream', byte_size: file.size })
    if (metadataError) { await supabase.storage.from('family-assets').remove([storagePath]); setBusy(false); return setError(metadataError.message) }
    setBusy(false); onSaved()
  }
  return <div className="modal-backdrop" onMouseDown={event => event.target === event.currentTarget && close()}><section className="capture-modal" role="dialog" aria-modal="true" aria-labelledby="capture-title"><header><div><p className="kicker">SAVE SOMETHING REAL</p><h2 id="capture-title">Add to your private family space</h2><p>Pick the exact space first. Private items are never shared by default.</p></div><button className="modal-close" type="button" onClick={close} aria-label="Close">×</button></header><form onSubmit={submit}><label>File<input type="file" accept="image/*,video/*,audio/*,application/pdf,text/plain" onChange={event => setFile(event.target.files?.[0] || null)} required/></label>{file&&<p className="file-summary">{file.name} · {Math.max(1, Math.ceil(file.size / 1024))} KB</p>}<label>Save to<select value={spaceId} onChange={event => setSpaceId(event.target.value)} required><option value="" disabled>Choose a space</option>{spaces.map(space => <option key={space.id} value={space.id}>{space.name}{space.space_type === 'private_vault' ? ' · private' : ' · shared'}</option>)}</select></label><div className="capture-safety"><b>Before saving</b><span>This uploads an original file to the encrypted, non-public Family Assets bucket. Access follows the space selected above.</span></div>{error&&<p className="capture-error" role="alert">{error}</p>}<footer><button className="secondary" type="button" onClick={close} disabled={busy}>Cancel</button><button className="primary" disabled={busy}>{busy?'Saving securely…':'Save item'}</button></footer></form></section></div>}

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
