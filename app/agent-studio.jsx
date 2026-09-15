'use client'

import { useCallback, useEffect, useMemo, useState } from 'react'

const STATUS_LABELS = { draft: 'Draft', active: 'Active', paused: 'Paused', archived: 'Archived' }

function sourceLabel(space) { return space.space_type === 'private_vault' ? `${space.name} · private` : `${space.name} · shared` }

export default function AgentStudio({ supabase, context, spaces, flash }) {
  const [agents, setAgents] = useState([])
  const [grants, setGrants] = useState([])
  const [selectedId, setSelectedId] = useState(null)
  const [loading, setLoading] = useState(true)
  const [error, setError] = useState('')
  const [creating, setCreating] = useState(false)

  const load = useCallback(async () => {
    if (!supabase || !context) return
    setLoading(true); setError('')
    const { data: agentRows, error: agentError } = await supabase.from('agents').select('*').neq('status', 'archived').order('created_at', { ascending: false })
    if (agentError) { setError(agentError.message); setLoading(false); return }
    const ids = (agentRows || []).map(agent => agent.id)
    const { data: grantRows, error: grantError } = ids.length ? await supabase.from('agent_scope_grants').select('*').in('agent_id', ids).is('revoked_at', null).order('granted_at') : { data: [], error: null }
    if (grantError) { setError(grantError.message); setLoading(false); return }
    setAgents(agentRows || []); setGrants(grantRows || []); setSelectedId(current => current && (agentRows || []).some(agent => agent.id === current) ? current : agentRows?.[0]?.id || null); setLoading(false)
  }, [context, supabase])
  useEffect(() => { const timer = window.setTimeout(() => void load(), 0); return () => window.clearTimeout(timer) }, [load])

  const selected = agents.find(agent => agent.id === selectedId) || null
  const selectedGrants = grants.filter(grant => grant.agent_id === selectedId)
  const create = async () => {
    if (creating || !context) return
    setCreating(true); setError('')
    const { data, error: createError } = await supabase.from('agents').insert({ household_id: context.householdId, created_by_user_id: context.userId, name: 'Family archive assistant', purpose: 'Organise approved family records', instructions: 'Use only approved sources. Cite the original files. Ask before sharing.', status: 'draft' }).select().single()
    setCreating(false)
    if (createError) { setError(createError.message); return }
    setAgents(items => [data, ...items]); setSelectedId(data.id); flash?.('Family AI draft created. It has no source access until you grant it.')
  }

  return <><header className="page-heading"><div><p className="kicker">FAMILY AI CONTROL PLANE</p><h1>Family AI</h1><p className="sub">Create assistants with exactly the sources you approve. Private sources are excluded until explicitly granted.</p></div><button className="primary" disabled={creating} onClick={create}>{creating ? 'Creating…' : 'Create agent'}</button></header><div className="ai-control-layout"><aside className="ai-agent-list" aria-label="Your Family AI agents"><header><b>Your agents</b><span>{agents.length}</span></header>{loading ? <p>Loading agents…</p> : agents.length ? agents.map(agent => <button key={agent.id} className={agent.id === selectedId ? 'active' : ''} onClick={() => setSelectedId(agent.id)}><b>{agent.name}</b><small>{STATUS_LABELS[agent.status]} · {grants.filter(grant => grant.agent_id === agent.id).length} approved source{grants.filter(grant => grant.agent_id === agent.id).length === 1 ? '' : 's'}</small></button>) : <div className="ai-empty-list"><b>No agent yet</b><p>Create a draft, then choose its sources.</p></div>}</aside><section className="ai-control-main">{error && <div className="ai-error" role="alert">{error}<button type="button" onClick={() => void load()}>Try again</button></div>}{selected ? <AgentEditor key={selected.id} agent={selected} grants={selectedGrants} spaces={spaces} context={context} supabase={supabase} onChange={load} flash={flash} /> : !loading && <div className="ai-empty"><h2>Build an assistant around approved sources</h2><p>Every agent begins with zero access. You decide each shared or private space it may use.</p><button className="primary" onClick={create}>Create an agent</button></div>}</section></div></>
}

function AgentEditor({ agent, grants, spaces, context, supabase, onChange, flash }) {
  const [name, setName] = useState(agent.name)
  const [purpose, setPurpose] = useState(agent.purpose)
  const [instructions, setInstructions] = useState(agent.instructions)
  const [busy, setBusy] = useState(false)
  const [error, setError] = useState('')
  const [sourceId, setSourceId] = useState('')
  const [capability, setCapability] = useState('read')
  const [confirmArchive, setConfirmArchive] = useState(false)
  const grantedSpaceIds = new Set(grants.map(grant => grant.space_id))
  const grantBySpace = new Map(grants.map(grant => [grant.space_id, grant]))

  const save = async () => {
    const cleanName = name.trim(), cleanPurpose = purpose.trim(), cleanInstructions = instructions.trim()
    if (!cleanName) { setError('Give this agent a name before saving.'); return }
    setBusy(true); setError('')
    const { error: saveError } = await supabase.from('agents').update({ name: cleanName, purpose: cleanPurpose, instructions: cleanInstructions }).eq('id', agent.id)
    setBusy(false)
    if (saveError) setError(saveError.message); else { flash?.('Agent details saved.'); void onChange() }
  }
  const addSource = async () => {
    if (!sourceId || busy) return
    setBusy(true); setError('')
    const { data: grant, error: grantError } = await supabase.from('agent_scope_grants').insert({ agent_id: agent.id, space_id: sourceId, capability, granted_by_user_id: context.userId }).select().single()
    if (grantError) { setBusy(false); setError(grantError.message); return }
    const { error: consentError } = await supabase.from('agent_consents').insert({ agent_id: agent.id, scope_grant_id: grant.id, consented_by_user_id: context.userId })
    setBusy(false)
    if (consentError) { setError(`Source was granted, but the consent record could not be completed: ${consentError.message}`); return }
    setSourceId(''); flash?.('Source access granted and recorded.'); void onChange()
  }
  const revoke = async grant => {
    if (!window.confirm('Revoke this source immediately? Family AI will no longer be permitted to use it.')) return
    setBusy(true); setError('')
    const { error: revokeError } = await supabase.from('agent_scope_grants').update({ revoked_at: new Date().toISOString() }).eq('id', grant.id)
    setBusy(false)
    if (revokeError) setError(revokeError.message); else { flash?.('Source access revoked.'); void onChange() }
  }
  const setStatus = async status => {
    if (status === 'active' && !grants.length) { setError('Grant at least one source before activating this agent.'); return }
    setBusy(true); setError('')
    const { error: statusError } = await supabase.from('agents').update({ status }).eq('id', agent.id)
    setBusy(false)
    if (statusError) setError(statusError.message); else { flash?.(`Agent ${STATUS_LABELS[status].toLowerCase()}.`); void onChange() }
  }
  const archive = async () => { setConfirmArchive(false); await setStatus('archived') }

  return <><header className="agent-detail-head"><div><div className={`agent-status ${agent.status}`}>{STATUS_LABELS[agent.status]}</div><h2>{agent.name}</h2><p>{agent.status === 'active' ? 'This agent can use only the sources shown below. A model provider is not connected yet.' : 'Draft agents cannot process or access any family source.'}</p></div><div className="agent-actions">{agent.status !== 'active' && <button className="primary" disabled={busy} onClick={() => setStatus('active')}>Activate</button>}{agent.status === 'active' && <button className="secondary" disabled={busy} onClick={() => setStatus('paused')}>Pause</button>}<button className="text-button danger-text" disabled={busy} onClick={() => setConfirmArchive(true)}>Archive</button></div></header>{error && <div className="ai-error" role="alert">{error}</div>}<div className="agent-editor-grid"><section className="agent-settings"><h3>Purpose and instructions</h3><p>Instructions direct the future provider. They never expand source access.</p><label>Agent name<input value={name} maxLength="120" onChange={event => setName(event.target.value)} /></label><label>Purpose<input value={purpose} maxLength="1000" onChange={event => setPurpose(event.target.value)} /></label><label>Instructions<textarea value={instructions} maxLength="10000" onChange={event => setInstructions(event.target.value)} /></label><button className="primary" disabled={busy} onClick={save}>Save changes</button></section><section className="agent-sources"><header><div><h3>Approved sources</h3><p>Only these spaces may be used for answers or suggestions.</p></div><span>{grants.length} granted</span></header>{grants.length ? <div className="granted-source-list">{grants.map(grant => { const space = spaces.find(item => item.id === grant.space_id); return <article key={grant.id}><div><b>{space?.name || 'Unavailable source'}</b><small>{space ? sourceLabel(space) : 'No longer accessible'} · {grant.capability === 'suggest' ? 'Suggestions only' : 'Read and answer'}</small></div><button type="button" disabled={busy} onClick={() => revoke(grant)}>Revoke</button></article> })}</div> : <div className="source-empty"><b>No sources granted</b><p>This agent cannot read, answer from, or process any family content.</p></div>}<div className="grant-source"><h4>Grant a source</h4><label>Space<select value={sourceId} onChange={event => setSourceId(event.target.value)}><option value="">Select an accessible space</option>{spaces.filter(space => !grantedSpaceIds.has(space.id)).map(space => <option key={space.id} value={space.id}>{sourceLabel(space)}</option>)}</select></label><label>Allowed activity<select value={capability} onChange={event => setCapability(event.target.value)}><option value="read">Read and answer from sources</option><option value="suggest">Create suggestions only</option></select></label>{sourceId && spaces.find(space => space.id === sourceId)?.space_type === 'private_vault' && <p className="vault-warning">You are explicitly granting this private vault. This access can be revoked at any time.</p>}<button className="secondary" disabled={busy || !sourceId} onClick={addSource}>Grant source access</button></div></section></div><section className="agent-chat-shell"><header><div><p className="kicker">FAMILY AI CHAT</p><h3>Ask {agent.name}</h3></div><span>Provider not connected</span></header><p>Agent chat will become available after a server-side AI provider is connected. The provider must re-check each approved source at runtime and cite the underlying files. No family content is sent anywhere from this screen.</p><textarea disabled placeholder="AI chat is unavailable until a provider is securely connected." aria-label="Family AI chat unavailable" /><button disabled>Send</button></section>{confirmArchive && <div className="modal-backdrop"><section className="capture-modal confirmation-dialog" role="dialog" aria-modal="true" aria-labelledby="archive-agent-title"><h2 id="archive-agent-title">Archive this agent?</h2><p>It will be paused and hidden from normal use. Its audit trail and past grant records remain intact.</p><footer><button className="secondary" onClick={() => setConfirmArchive(false)}>Cancel</button><button className="primary danger-primary" onClick={archive}>Archive agent</button></footer></section></div>}</>
}
