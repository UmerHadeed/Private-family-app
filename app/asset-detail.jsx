'use client'

import { useCallback, useEffect, useMemo, useState } from 'react'
import './asset-detail.css'

const sizeLabel = bytes => bytes < 1024 * 1024 ? `${Math.max(1, Math.ceil(bytes / 1024))} KB` : `${(bytes / (1024 * 1024)).toFixed(1)} MB`
const visual = asset => asset.voice ? 'Voice note' : asset.type

export default function AssetDetail({ asset, supabase, context, spaces, close, onChanged, flash }) {
  const [title, setTitle] = useState(asset.title)
  const [editing, setEditing] = useState(false)
  const [shares, setShares] = useState([])
  const [destinationId, setDestinationId] = useState('')
  const [busy, setBusy] = useState(false)
  const [loadingShares, setLoadingShares] = useState(false)
  const [error, setError] = useState('')
  const privateSource = asset.spaceType === 'private_vault' && asset.uploadedBy === context?.userId
  const destinations = useMemo(() => spaces.filter(space => space.space_type !== 'private_vault'), [spaces])

  const loadShares = useCallback(async () => {
    if (!privateSource) return
    setLoadingShares(true)
    const { data, error: sharesError } = await supabase.from('asset_shares').select('id,destination_space_id,shared_storage_path,created_at,destination:spaces!asset_shares_destination_space_id_fkey(name)').eq('source_asset_id', asset.id).is('revoked_at', null).order('created_at', { ascending: false })
    setLoadingShares(false)
    if (sharesError) return setError(sharesError.message)
    setShares(data || [])
  }, [asset.id, privateSource, supabase])

  useEffect(() => { const timer = window.setTimeout(() => void loadShares(), 0); return () => window.clearTimeout(timer) }, [loadShares])

  const download = async () => {
    setBusy(true); setError('')
    const { data, error: downloadError } = await supabase.storage.from('family-assets').createSignedUrl(asset.storagePath, 60)
    setBusy(false)
    if (downloadError || !data?.signedUrl) return setError(downloadError?.message || 'We could not prepare your private download.')
    window.open(data.signedUrl, '_blank', 'noopener,noreferrer')
    flash('Private download link opened. It expires shortly.')
  }

  const saveTitle = async event => {
    event.preventDefault(); const filename = title.trim()
    if (!filename || busy) return setError('Enter a file name before saving.')
    setBusy(true); setError('')
    const { error: updateError } = await supabase.from('assets').update({ filename }).eq('id', asset.id)
    setBusy(false)
    if (updateError) return setError(updateError.message)
    setEditing(false); await onChanged(); flash('Item name updated.')
  }

  const share = async event => {
    event.preventDefault()
    if (!destinationId || busy) return setError('Choose the shared Family Space before continuing.')
    const destination = destinations.find(space => space.id === destinationId)
    if (!destination) return setError('Choose a valid shared destination.')
    setBusy(true); setError('')
    const { data: original, error: originalError } = await supabase.storage.from('family-assets').download(asset.storagePath)
    if (originalError || !original) { setBusy(false); return setError(originalError?.message || 'We could not read the private original.') }
    const id = crypto.randomUUID()
    const safeName = asset.title.replace(/[^a-zA-Z0-9._-]/g, '_').slice(0, 180) || 'shared-item'
    const sharedStoragePath = `${context.householdId}/${destinationId}/${id}/${safeName}`
    const { error: uploadError } = await supabase.storage.from('family-assets').upload(sharedStoragePath, original, { contentType: asset.mimeType, upsert: false })
    if (uploadError) { setBusy(false); return setError(uploadError.message) }
    const { error: shareError } = await supabase.rpc('share_asset_to_space', { source_asset_id: asset.id, destination_space_id: destinationId, shared_storage_path: sharedStoragePath })
    if (shareError) { await supabase.storage.from('family-assets').remove([sharedStoragePath]); setBusy(false); return setError(shareError.message) }
    setBusy(false); setDestinationId(''); await loadShares(); await onChanged(); flash(`Shared with ${destination.name}.`)
  }

  const revoke = async share => {
    if (!window.confirm(`Remove this shared copy from ${share.destination?.name || 'the selected space'}? The original remains in My Vault.`)) return
    setBusy(true); setError('')
    const { error: revokeError } = await supabase.rpc('revoke_asset_share', { asset_share_id: share.id })
    if (!revokeError) {
      const { error: removeError } = await supabase.storage.from('family-assets').remove([share.shared_storage_path])
      if (removeError) setError(`Shared access was removed, but the copied file could not be cleaned up: ${removeError.message}`)
    }
    setBusy(false)
    if (revokeError) return setError(revokeError.message)
    await loadShares(); await onChanged(); flash('Shared copy removed. Your private original remains available.')
  }

  return <div className="modal-backdrop" onMouseDown={event => event.target === event.currentTarget && close()}><section className="asset-detail-modal" role="dialog" aria-modal="true" aria-labelledby="asset-detail-title"><header><div><p className="kicker">{asset.scope === 'Private' ? 'MY VAULT · PRIVATE' : 'FAMILY MEMORY'}</p><h2 id="asset-detail-title">{asset.title}</h2><p>{visual(asset)} · {sizeLabel(asset.byteSize)} · saved {asset.date}</p></div><button className="modal-close" type="button" aria-label="Close" onClick={close}>×</button></header><section className="asset-preview"><div className={`asset-preview-icon ${asset.voice ? 'voice' : ''}`}>{asset.voice ? 'Voice' : asset.type}</div><div><b>Current audience</b><p>{asset.scope === 'Private' ? 'Only you, in My Vault.' : `${asset.spaceName || 'Shared Family Space'} members with current access.`}</p></div></section><div className="asset-detail-actions"><button className="secondary" onClick={() => void download()} disabled={busy}>Download original</button>{asset.uploadedBy === context?.userId && <button className="secondary" onClick={() => setEditing(value => !value)} disabled={busy}>{editing ? 'Cancel rename' : 'Rename item'}</button>}</div>{editing && <form className="rename-form" onSubmit={saveTitle}><label>File name<input autoFocus maxLength="512" value={title} onChange={event => setTitle(event.target.value)} /></label><button className="primary" disabled={busy}>{busy ? 'Saving…' : 'Save name'}</button></form>}{privateSource && <section className="share-control"><header><div><p className="kicker">CONTROLLED SHARING</p><h3>Share a copy, not your vault</h3><p>Review who can access it. The original remains in My Vault and can be removed from the shared space at any time.</p></div></header>{destinations.length ? <form onSubmit={share}><label>Share a copy with<select value={destinationId} onChange={event => setDestinationId(event.target.value)} required><option value="">Choose shared Family Space</option>{destinations.map(space => <option key={space.id} value={space.id}>{space.name}</option>)}</select></label><div className="share-review"><b>Before you share</b><span>Every current member of the selected shared space can access the copied file. Future membership changes follow that space’s access rules.</span></div><button className="primary" disabled={busy}>{busy ? 'Creating shared copy…' : 'Review and share copy'}</button></form> : <p className="share-review">There is no shared Family Space you can contribute to yet.</p>}{loadingShares ? <p className="fine">Loading shared copies…</p> : shares.length ? <div className="active-shares"><b>Shared copies</b>{shares.map(share => <div key={share.id}><span>{share.destination?.name || 'Shared Family Space'}</span><button className="danger-text" disabled={busy} onClick={() => void revoke(share)}>Remove shared copy</button></div>)}</div> : <p className="fine">This item has not been shared from My Vault.</p>}</section>}{error && <p className="capture-error" role="alert">{error}</p>}</section></div>
}
