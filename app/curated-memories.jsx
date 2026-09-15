'use client'

import { useCallback, useEffect, useMemo, useState } from 'react'

function memoryDate(value) {
  return new Intl.DateTimeFormat(undefined, { month: 'short', day: 'numeric', year: 'numeric' }).format(new Date(value))
}

export default function CuratedMemories({ supabase, context, spaces, assets, query, flash }) {
  const [memories, setMemories] = useState([])
  const [links, setLinks] = useState(new Map())
  const [loading, setLoading] = useState(true)
  const [error, setError] = useState('')
  const [editor, setEditor] = useState(null)
  const normalizedQuery = query.trim()

  const load = useCallback(async () => {
    if (!supabase || !context) { setLoading(false); return }
    setLoading(true); setError('')
    const result = normalizedQuery
      ? await supabase.rpc('search_curated_memories', { search_query: normalizedQuery, result_limit: 50 })
      : await supabase.from('curated_memories').select('id,household_id,space_id,created_by_user_id,title,summary,created_at,updated_at').is('archived_at', null).order('created_at', { ascending: false }).limit(50)
    if (result.error) { setError(result.error.message); setLoading(false); return }
    const rows = result.data || []
    const ids = rows.map(memory => memory.id)
    const linkResult = ids.length ? await supabase.from('curated_memory_assets').select('memory_id,asset_id,assets(id,filename,asset_type,space_id)').in('memory_id', ids) : { data: [], error: null }
    if (linkResult.error) { setError(linkResult.error.message); setLoading(false); return }
    const nextLinks = new Map()
    ;(linkResult.data || []).forEach(link => nextLinks.set(link.memory_id, [...(nextLinks.get(link.memory_id) || []), link.assets].filter(Boolean)))
    setMemories(rows); setLinks(nextLinks); setLoading(false)
  }, [context, normalizedQuery, supabase])

  useEffect(() => { const timer = window.setTimeout(() => void load(), 0); return () => window.clearTimeout(timer) }, [load])
  useEffect(() => {
    if (!supabase || !context?.userId) return undefined
    const channel = supabase.channel(`curated-memories-${context.userId}`)
      .on('postgres_changes', { event: '*', schema: 'public', table: 'curated_memories' }, () => void load())
      .on('postgres_changes', { event: '*', schema: 'public', table: 'curated_memory_assets' }, () => void load())
      .subscribe()
    return () => { supabase.removeChannel(channel) }
  }, [context?.userId, load, supabase])

  const assetsById = useMemo(() => new Map(assets.map(asset => [asset.id, asset])), [assets])
  return <section className="curated-memories"><header className="curated-memories-head"><div><p className="kicker">CURATED MEMORIES</p><h2>{normalizedQuery ? 'Curated search results' : 'Saved collections'}</h2><p>{normalizedQuery ? 'Searches saved titles, summaries, and permitted linked asset filenames.' : 'Personal titles and summaries, with links to the original permitted items.'}</p></div><button className="secondary" onClick={() => setEditor({})}>＋ Curate memory</button></header>{error && <div className="curated-error" role="alert">{error}<button onClick={() => void load()}>Try again</button></div>}{loading ? <p className="curated-empty">Loading curated memories…</p> : memories.length ? <div className="curated-memory-list">{memories.map(memory => <MemoryRow key={memory.id} memory={memory} linkedAssets={links.get(memory.id) || []} canEdit={memory.created_by_user_id === context.userId} onEdit={() => setEditor(memory)} />)}</div> : <p className="curated-empty">{normalizedQuery ? 'No permitted curated memories match this search.' : 'Create a collection to add your own title, summary, and links to permitted assets.'}</p>}{editor && <MemoryEditor memory={editor.id ? editor : null} spaces={spaces} assets={assets} linkedAssets={editor.id ? links.get(editor.id) || [] : []} context={context} supabase={supabase} assetsById={assetsById} close={() => setEditor(null)} onSaved={async message => { setEditor(null); await load(); flash?.(message) }} />}</section>
}

function MemoryRow({ memory, linkedAssets, canEdit, onEdit }) {
  return <article className="curated-memory-row"><div><div className="curated-memory-title"><h3>{memory.title}</h3>{memory.asset_match && <span>Matched linked item</span>}</div>{memory.summary && <p>{memory.summary}</p>}<small>Created {memoryDate(memory.created_at)} · {linkedAssets.length ? `${linkedAssets.length} permitted linked ${linkedAssets.length === 1 ? 'item' : 'items'}` : 'No linked items'}</small>{linkedAssets.length ? <div className="curated-asset-links">{linkedAssets.map(asset => <span key={asset.id}>{asset.filename}</span>)}</div> : null}</div>{canEdit && <button className="text-button" onClick={onEdit}>Edit</button>}</article>
}

function MemoryEditor({ memory, spaces, assets, linkedAssets, context, supabase, assetsById, close, onSaved }) {
  const [title, setTitle] = useState(memory?.title || '')
  const [summary, setSummary] = useState(memory?.summary || '')
  const [spaceId, setSpaceId] = useState(memory?.space_id || spaces.find(space => space.space_type === 'private_vault')?.id || spaces[0]?.id || '')
  const [selected, setSelected] = useState(() => new Set(linkedAssets.map(asset => asset.id)))
  const [busy, setBusy] = useState(false)
  const [error, setError] = useState('')
  const toggleAsset = id => setSelected(current => { const next = new Set(current); next.has(id) ? next.delete(id) : next.add(id); return next })
  const save = async event => {
    event.preventDefault()
    if (busy || !title.trim() || !spaceId) { setError('Choose a space and add a title.'); return }
    setBusy(true); setError('')
    const payload = { household_id: context.householdId, space_id: spaceId, created_by_user_id: context.userId, title: title.trim(), summary: summary.trim() }
    const savedResult = memory
      ? await supabase.from('curated_memories').update(payload).eq('id', memory.id).select().single()
      : await supabase.from('curated_memories').insert(payload).select().single()
    if (savedResult.error) { setBusy(false); setError(savedResult.error.message); return }
    const saved = savedResult.data
    const prior = new Set(linkedAssets.map(asset => asset.id))
    const removed = [...prior].filter(id => !selected.has(id))
    const added = [...selected].filter(id => !prior.has(id) && assetsById.has(id))
    if (removed.length) {
      const { error: removeError } = await supabase.from('curated_memory_assets').delete().eq('memory_id', saved.id).in('asset_id', removed)
      if (removeError) { setBusy(false); setError(`Memory saved, but some asset links could not be removed: ${removeError.message}`); return }
    }
    if (added.length) {
      const { error: linkError } = await supabase.from('curated_memory_assets').insert(added.map(assetId => ({ memory_id: saved.id, asset_id: assetId, linked_by_user_id: context.userId })))
      if (linkError) { setBusy(false); setError(`Memory saved, but some asset links could not be added: ${linkError.message}`); return }
    }
    setBusy(false); await onSaved(memory ? 'Curated memory updated.' : 'Curated memory saved.')
  }
  const archive = async () => {
    if (!memory || busy || !window.confirm('Archive this curated memory? Its original assets are not changed.')) return
    setBusy(true); setError('')
    const { error: archiveError } = await supabase.from('curated_memories').update({ archived_at: new Date().toISOString() }).eq('id', memory.id)
    setBusy(false)
    if (archiveError) setError(archiveError.message); else await onSaved('Curated memory archived. Original assets remain unchanged.')
  }
  return <div className="modal-backdrop" onMouseDown={event => event.target === event.currentTarget && close()}><section className="curated-memory-modal" role="dialog" aria-modal="true" aria-labelledby="curated-memory-title"><header><div><p className="kicker">{memory ? 'EDIT CURATED MEMORY' : 'NEW CURATED MEMORY'}</p><h2 id="curated-memory-title">{memory ? 'Update your collection' : 'Curate a memory'}</h2><p>Titles and summaries are written by you. Linked items keep their own space access.</p></div><button className="modal-close" type="button" onClick={close} aria-label="Close">×</button></header><form onSubmit={save}><label>Title<input value={title} maxLength="240" onChange={event => setTitle(event.target.value)} required /></label><label>Summary<textarea value={summary} maxLength="4000" onChange={event => setSummary(event.target.value)} placeholder="Describe this collection in your own words." /></label><label>Save collection in<select value={spaceId} onChange={event => setSpaceId(event.target.value)} disabled={Boolean(memory)} required>{spaces.map(space => <option key={space.id} value={space.id}>{space.name}{space.space_type === 'private_vault' ? ' · private' : ' · shared'}</option>)}</select></label><fieldset><legend>Link permitted assets</legend><p>Only non-deleted assets you can access are available. Linking does not share an original item or change its access.</p><div className="curated-asset-picker">{assets.length ? assets.map(asset => <label key={asset.id}><input type="checkbox" checked={selected.has(asset.id)} onChange={() => toggleAsset(asset.id)} /> <span><b>{asset.title}</b><small>{asset.type} · {asset.spaceName}</small></span></label>) : <span>No permitted assets are available to link.</span>}</div></fieldset>{error && <p className="capture-error" role="alert">{error}</p>}<footer>{memory && <button type="button" className="text-button curated-archive" disabled={busy} onClick={() => void archive()}>Archive memory</button>}<span /><button className="secondary" type="button" disabled={busy} onClick={close}>Cancel</button><button className="primary" disabled={busy}>{busy ? 'Saving…' : 'Save curated memory'}</button></footer></form></section></div>
}
