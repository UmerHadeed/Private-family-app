'use client'

import { useCallback, useEffect, useMemo, useState } from 'react'
import { getSupabaseBrowserClient } from '../lib/supabase/client'
import FamilyChat from './family-chat'
import AgentStudio from './agent-studio'
import FamilyCalendar from './family-calendar'
import People from './people'
import AssetDetail from './asset-detail'
import './page.css'

const NAV = [
  ['Today', '⌂'], ['Family Space', '♧'], ['Calendar', '□'], ['My Vault', '⌑'], ['People', '◌'], ['Timeline', '↗'], ['Library', '▧'], ['Agent Studio', '✧']
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
function Avatar({ initials, tone = 'blue' }) { return <span className={`avatar ${tone}`}>{initials}</span> }

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
  const [state, setState] = useState('checking'), [name, setName] = useState(''), [message, setMessage] = useState(''), [busy, setBusy] = useState(false), [invitations, setInvitations] = useState([])
  const checkAccess = useCallback(async () => {
    const [{ data: memberships, error: membershipError }, { data: pending, error: pendingError }] = await Promise.all([
      supabase.from('household_members').select('household_id').is('revoked_at', null).limit(1),
      supabase.rpc('list_my_pending_household_invitations')
    ])
    if (membershipError || pendingError) { setMessage('We could not check your household access. Please try again.'); setState('error'); return }
    if (memberships?.length) { setState('ready'); return }
    setInvitations(pending || []); setState((pending || []).length ? 'invited' : 'onboarding')
  }, [supabase])
  useEffect(() => { const timer = window.setTimeout(() => { void checkAccess() }, 0); return () => window.clearTimeout(timer) }, [checkAccess])
  const create = async event => { event.preventDefault(); const householdName = name.trim(); if (!householdName || busy) return; setBusy(true); setMessage(''); const { error } = await supabase.rpc('create_household_with_default_spaces', { household_name: householdName }); setBusy(false); if (error) return setMessage(error.message); setState('ready') }
  const accept = async invitation => { if (busy) return; setBusy(true); setMessage(''); const { error } = await supabase.rpc('accept_household_invitation', { invitation_id: invitation.id }); setBusy(false); if (error) return setMessage(error.message); setState('ready') }
  if (state === 'checking') return <AuthShell><p>Checking your household access…</p></AuthShell>
  if (state === 'ready') return children
  if (state === 'invited') return <AuthShell><p className="kicker">HOUSEHOLD INVITATION</p><h1>Join your Family Space.</h1><p>You are signing in with the invited email. Review the shared access before joining.</p>{invitations.map(invitation => <section className="invitation-card" key={invitation.id}><b>{invitation.household_name}</b><span>Family Space and Calendar · {invitation.family_space_role === 'editor' ? 'Can contribute' : 'Can view'}</span><small>My Vault and private spaces are not shared.</small><button className="primary" disabled={busy} onClick={() => void accept(invitation)}>{busy ? 'Joining…' : 'Accept invitation'}</button></section>)}{message && <p className="auth-message" role="alert">{message}</p>}<button className="text-button" onClick={() => supabase.auth.signOut()}>Use a different account</button></AuthShell>
  return <AuthShell><p className="kicker">YOUR HOUSEHOLD</p><h1>Start your private family space.</h1><p>Create the household you control. Your private vault remains separate from Family.</p><form className="auth-form" onSubmit={create}><label>Household name<input autoFocus maxLength="120" value={name} onChange={e => setName(e.target.value)} required /></label><button className="primary" disabled={busy}>{busy ? 'Creating your spaces…' : 'Create my household'}</button></form>{message && <p className="auth-message" role="alert">{message}</p>}{state === 'error' && <button className="secondary full" onClick={() => void checkAccess()} disabled={busy}>Try again</button>}<button className="text-button" onClick={() => supabase.auth.signOut()}>Use a different account</button></AuthShell>
}

function FamilyApp() {
  const supabase = getSupabaseBrowserClient()
  const [page, setPage] = useState('Today'), [query, setQuery] = useState(''), [memories, setMemories] = useState([]), [spaces, setSpaces] = useState([]), [context, setContext] = useState(null), [notice, setNotice] = useState(''), [captureOpen, setCaptureOpen] = useState(false), [selectedAsset, setSelectedAsset] = useState(null), [loading, setLoading] = useState(true)
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
    const { data: assets, error: assetsError } = await supabase.from('assets').select('id,space_id,uploaded_by_user_id,asset_type,storage_path,filename,mime_type,byte_size,created_at').is('deleted_at', null).order('created_at', { ascending: false })
    if (assetsError) { setLoading(false); return setNotice('We could not load your saved items. Please refresh and try again.') }
    const spaceById = new Map((accessibleSpaces || []).map(space => [space.id, space]))
    setContext({ userId: user.id, householdId: memberships[0].household_id })
    setSpaces(accessibleSpaces || [])
    setMemories((assets || []).map(asset => {
      const space = spaceById.get(asset.space_id)
      return { id: asset.id, title: asset.filename, type: asset.asset_type === 'audio' ? 'Voice note' : asset.asset_type[0].toUpperCase() + asset.asset_type.slice(1), person: space?.name || 'Private space', date: new Intl.DateTimeFormat(undefined, { month: 'short', day: 'numeric', year: 'numeric' }).format(new Date(asset.created_at)), scope: space?.space_type === 'private_vault' ? 'Private' : 'Family', caption: `${asset.mime_type} · ${Math.max(1, Math.ceil(asset.byte_size / 1024))} KB`, voice: asset.asset_type === 'audio', spaceType: space?.space_type, spaceName: space?.name, uploadedBy: asset.uploaded_by_user_id, storagePath: asset.storage_path, mimeType: asset.mime_type, byteSize: asset.byte_size }
    }))
    setLoading(false)
  }, [supabase])
  useEffect(() => { const timer = window.setTimeout(() => { void loadContent() }, 0); return () => window.clearTimeout(timer) }, [loadContent])
  const filtered = useMemo(() => memories.filter(memory => Object.values(memory).join(' ').toLowerCase().includes(query.toLowerCase())), [memories, query])
  const openCapture = () => setCaptureOpen(true)
  const saved = async () => { await loadContent(); setCaptureOpen(false); setPage('Library'); flash('Saved to the selected private space.') }
  return <div className="app-shell"><Sidebar page={page} setPage={setPage} /><main className="main"><header className="topbar"><span className="preview-dot">PRIVATE FAMILY OS</span><label className="search"><span>⌕</span><input aria-label="Search memories" value={query} onChange={e => setQuery(e.target.value)} placeholder="Search memories" /></label></header><div className="content">{notice && <div className="notice" role="status">{notice}</div>}{page === 'Today' && <Home setPage={setPage} memories={memories} onCapture={openCapture} onOpen={setSelectedAsset} loading={loading} />}{page === 'Family Space' && <FamilyChat supabase={supabase} context={context} spaces={spaces} flash={flash} />}{page === 'Calendar' && <FamilyCalendar supabase={supabase} context={context} spaces={spaces} flash={flash} />}{page === 'My Vault' && <Vault memories={filtered.filter(memory => memory.scope === 'Private')} onCapture={openCapture} onOpen={setSelectedAsset} loading={loading} />}{page === 'People' && <People supabase={supabase} context={context} spaces={spaces} flash={flash} />}{page === 'Timeline' && <Timeline memories={filtered} onCapture={openCapture} onOpen={setSelectedAsset} loading={loading} />}{page === 'Library' && <Library memories={filtered} query={query} onCapture={openCapture} onOpen={setSelectedAsset} loading={loading} />}{page === 'Agent Studio' && <AgentStudio supabase={supabase} context={context} spaces={spaces} flash={flash} />}</div></main>{captureOpen && <CaptureModal supabase={supabase} context={context} spaces={spaces} close={() => setCaptureOpen(false)} onSaved={saved} />}{selectedAsset && <AssetDetail asset={selectedAsset} supabase={supabase} context={context} spaces={spaces} close={() => setSelectedAsset(null)} onChanged={loadContent} flash={flash} />}{<nav className="mobile-nav" aria-label="Primary navigation">{NAV.map(([name, icon]) => <button key={name} className={page === name ? 'active' : ''} onClick={() => setPage(name)}><span>{icon}</span>{name}</button>)}</nav>}</div>
}
function Sidebar({ page, setPage }) { return <aside className="sidebar"><div className="brand"><b>♡ private</b><small>A little closer, every day.</small></div><nav>{NAV.map(([name, icon]) => <button key={name} className={page === name ? 'active' : ''} onClick={() => setPage(name)}><span>{icon}</span>{name}</button>)}</nav><div className="sidebar-footer"><span>♙ Private by design</span><div><Avatar initials="UH" /><p><b>Umer Hadeed</b><small>Illustrative household</small></p></div></div></aside> }
function Heading({ eyebrow, title, children, action }) { return <header className="heading"><div><p className="kicker">{eyebrow}</p><h1>{title}</h1>{children && <p className="sub">{children}</p>}</div>{action}</header> }
function Home({ setPage, memories, onCapture, loading }) { return <><PageHeading eyebrow="YOUR PRIVATE FAMILY SPACE" title="Home" text="Your family, memories and AI. All in one place." action="＋ Add memory" onAction={onCapture} /><section className="area-tiles">{[['Memories','Library','▧','Photos, notes & timeline'],['Family','Family Space','♧','People & shared space'],['My Vault','My Vault','⌑','Personal & private']].map(([name,page,icon,text])=><button key={name} onClick={()=>setPage(page)}><i>{icon}</i><span><b>{name}</b><small>{text}</small></span><em>›</em></button>)}</section><div className="home-workspace"><section className="panel ai-home"><PanelTitle icon="✧" title="Family AI" text="Your assistant, with access you control." link="Open ›" onClick={()=>setPage('Agent Studio')}/><form className="ask-box" onSubmit={e=>{e.preventDefault();setPage('Agent Studio')}}><input placeholder="Ask about a memory or family moment…"/><button className="primary" aria-label="Open Family AI">›</button></form><div className="suggestions"><button>Find a memory</button><button>Organise memories</button></div><div className="panel-foot"><span>⌑ Family collection only</span><button className="link" onClick={()=>setPage('Agent Studio')}>Manage access</button></div><div className="builder-link"><button className="link" onClick={()=>setPage('Agent Studio')}>＋ Create agent</button><span>Instructions · photos · files · Drive</span></div><p className="fine">Preview · AI isn’t connected yet.</p></section><section className="panel recent-panel"><PanelTitle title="Recent memories" link="View all ›" onClick={()=>setPage('Library')}/><div className="recent-list">{memories.filter(x=>x.scope==='Family').slice(0,3).map(memory=><CompactMemory key={memory.id} memory={memory}/>)}</div></section></div><section className="panel family-strip"><div><h3>Your family</h3><p className="fine">Illustrative profiles</p></div><div className="family-avatars">{PEOPLE.map(person=><button key={person.name} onClick={()=>setPage('People')}><Avatar initials={person.initials} tone={person.tone}/><span>{person.name.split(' ')[0]}</span></button>)}</div><button className="link" onClick={()=>setPage('People')}>Family ›</button></section></> }
function PageHeading({ eyebrow, title, text, action, onAction }) { return <header className="page-heading"><div><p className="kicker">{eyebrow}</p><h1>{title}</h1><p className="sub">{text}</p></div>{action&&<button className="primary" onClick={onAction}>{action}</button>}</header> }
function PanelTitle({ icon, title, text, link, onClick }) { return <div className="panel-title"><div>{icon&&<i>{icon}</i>}<span><h2>{title}</h2>{text&&<p>{text}</p>}</span></div>{link&&<button className="link" onClick={onClick}>{link}</button>}</div> }
function CompactMemory({memory, onOpen}) { return <button className="compact-memory" onClick={() => onOpen?.(memory)}><span className="mini-art">{memory.voice?'〰':memory.type==='Photo'?'▧':'▤'}</span><span><b>{memory.title}</b><small>{memory.type} · {memory.person} · {memory.scope}</small></span><em>›</em></button> }
function Timeline({ memories, onCapture, onOpen, loading }) { return <><PageHeading eyebrow="YOUR FAMILY STORY" title="Timeline" text="Big milestones. Small moments. Everything worth keeping." action="＋ Add memory" onAction={onCapture}/><CollectionToolbar/>{loading?<LoadingContent/>:<section className="timeline-new">{memories.map(memory=><article key={memory.id} onClick={() => onOpen(memory)}><time>{memory.date}</time><i/><div><p className="kicker">{memory.type} · {memory.scope}</p><h2>{memory.title}</h2><p>{memory.caption}</p><small>{memory.person}</small></div></article>)}</section>}</> }
function CollectionToolbar(){return <div className="collection-toolbar"><div><button className="active">Browse</button><button>Timeline</button></div><select aria-label="Filter content"><option>All types</option><option>Photo</option><option>Voice note</option><option>Document</option></select></div>}
function Library({ memories, query, onCapture, onOpen, loading }) { return <><PageHeading eyebrow="MEMORIES · FAMILY COLLECTION" title="Your family story." text={query?`Showing results for “${query}”.`:'Big milestones. Small moments. Everything worth keeping.'} action="＋ Add memory" onAction={onCapture}/><CollectionToolbar/>{loading?<LoadingContent/>:memories.length?<section className="memory-grid-new">{memories.map(memory=><MemoryCard key={memory.id} memory={memory} onOpen={onOpen}/>)}</section>:<EmptyCollection title="No memories found" text="Your approved family items will appear here." onCapture={onCapture}/>}</> }
function EmptyCollection({title,text,onCapture}){return <div className="empty"><h2>{title}</h2><p>{text}</p><button className="primary" onClick={onCapture}>＋ Add your first item</button></div>}
function LoadingContent(){return <div className="empty"><h2>Loading your private content…</h2><p>Only items in spaces you can access are shown.</p></div>}
function MemoryCard({memory, onOpen}){return <button className="memory-card-new" onClick={() => onOpen(memory)}><div className={`card-art ${memory.voice?'voice':''}`}>{memory.voice?'〰〰〰':memory.type==='Photo'?'▧':'▤'}</div><div><h2>{memory.title}</h2><p>{memory.person} · {memory.date}</p><small>{memory.caption}</small></div></button>}
function Vault({ memories, onCapture, onOpen, loading }) { return <><PageHeading eyebrow="MY VAULT · ONLY YOU" title="Just for you." text="Your own space. Nothing shared unless you choose." action="＋ Add memory" onAction={onCapture}/><CollectionToolbar/>{loading?<LoadingContent/>:memories.length?<section className="memory-grid-new">{memories.map(memory=><MemoryCard key={memory.id} memory={memory} onOpen={onOpen}/>)}</section>:<EmptyCollection title="Your vault is clear" text="Private items you add will stay here unless you deliberately share them." onCapture={onCapture}/>}</> }
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
