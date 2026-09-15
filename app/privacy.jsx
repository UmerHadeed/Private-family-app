'use client'

import { useCallback, useEffect, useMemo, useState } from 'react'
import './privacy.css'

const dateLabel = value => new Intl.DateTimeFormat(undefined, { dateStyle: 'medium', timeStyle: 'short' }).format(new Date(value))

export default function Privacy({ supabase, context, assets = [], flash }) {
  const [exportRequests, setExportRequests] = useState([])
  const [deletionRequests, setDeletionRequests] = useState([])
  const [sharedCopyIds, setSharedCopyIds] = useState([])
  const [loading, setLoading] = useState(true)
  const [busy, setBusy] = useState('')
  const [error, setError] = useState('')

  const ownedOriginals = useMemo(() => {
    const copiedIds = new Set(sharedCopyIds)
    return assets.filter(asset => asset.uploadedBy === context?.userId && !copiedIds.has(asset.id))
  }, [assets, context?.userId, sharedCopyIds])
  const pendingDeletionAssetIds = useMemo(() => new Set(deletionRequests.filter(request => request.status === 'pending').map(request => request.asset_id)), [deletionRequests])

  const load = useCallback(async () => {
    if (!supabase || !context?.userId) return
    setLoading(true); setError('')
    const [{ data: exports, error: exportError }, { data: deletions, error: deletionError }, { data: shares, error: sharesError }] = await Promise.all([
      supabase.from('privacy_export_requests').select('id,status,requested_at,withdrawn_at').eq('requester_user_id', context.userId).order('requested_at', { ascending: false }),
      supabase.from('privacy_deletion_requests').select('id,asset_id,status,requested_at,withdrawn_at,asset:assets(filename)').eq('requester_user_id', context.userId).order('requested_at', { ascending: false }),
      supabase.from('asset_shares').select('shared_asset_id')
    ])
    setLoading(false)
    if (exportError || deletionError || sharesError) return setError(exportError?.message || deletionError?.message || sharesError?.message || 'We could not load your privacy requests.')
    setExportRequests(exports || []); setDeletionRequests(deletions || []); setSharedCopyIds((shares || []).map(share => share.shared_asset_id))
  }, [context, supabase])

  useEffect(() => { const timer = window.setTimeout(() => void load(), 0); return () => window.clearTimeout(timer) }, [load])

  const requestExport = async () => {
    if (!context?.householdId || busy) return
    setBusy('export'); setError('')
    const { error: requestError } = await supabase.rpc('request_privacy_export', { target_household_id: context.householdId })
    setBusy('')
    if (requestError) return setError(requestError.message)
    await load(); flash('Export request recorded for review. No archive has been created yet.')
  }

  const requestDeletion = async asset => {
    if (busy) return
    if (!window.confirm(`Request review to delete “${asset.title}”? This does not delete the file now.`)) return
    setBusy(`delete:${asset.id}`); setError('')
    const { error: requestError } = await supabase.rpc('request_privacy_asset_deletion', { target_asset_id: asset.id })
    setBusy('')
    if (requestError) return setError(requestError.message)
    await load(); flash('Deletion request recorded. The original remains available until a reviewed process acts on it.')
  }

  const withdraw = async (type, id) => {
    if (busy) return
    setBusy(`${type}:${id}`); setError('')
    const { error: withdrawError } = await supabase.rpc('withdraw_privacy_request', { target_request_type: type, target_request_id: id })
    setBusy('')
    if (withdrawError) return setError(withdrawError.message)
    await load(); flash('Pending privacy request withdrawn.')
  }

  return <section className="privacy-page">
    <header className="page-heading"><div><p className="kicker">PRIVACY CONTROLS</p><h1>Your data requests</h1><p className="sub">Request a reviewable export manifest or deletion review. Nothing is downloaded or permanently removed from this page.</p></div></header>
    {error && <div className="privacy-error" role="alert">{error}<button onClick={() => void load()}>Try again</button></div>}
    <section className="privacy-card"><header><div><p className="kicker">EXPORT</p><h2>Request an export</h2><p>We snapshot metadata for items you can access now, including your own uploads. This records a request only—there is no archive or download link until a separate process creates one.</p></div><button className="primary" disabled={Boolean(busy) || exportRequests.some(request => request.status === 'pending')} onClick={() => void requestExport()}>{busy === 'export' ? 'Recording…' : exportRequests.some(request => request.status === 'pending') ? 'Export pending' : 'Request export'}</button></header>
      <RequestList loading={loading} requests={exportRequests} type="export" busy={busy} onWithdraw={withdraw} empty="No export requests yet." />
    </section>
    <section className="privacy-card"><header><div><p className="kicker">DELETION</p><h2>Request deletion of an original</h2><p>Only originals you uploaded can be submitted. The request is durable and auditable; it never automatically deletes database records or storage objects.</p></div></header>
      <div className="privacy-assets">{ownedOriginals.length ? ownedOriginals.map(asset => <article key={asset.id}><div><b>{asset.title}</b><span>{asset.spaceName || 'Private space'} · {asset.date}</span></div><button className="secondary" disabled={Boolean(busy) || pendingDeletionAssetIds.has(asset.id)} onClick={() => void requestDeletion(asset)}>{busy === `delete:${asset.id}` ? 'Recording…' : pendingDeletionAssetIds.has(asset.id) ? 'Deletion pending' : 'Request deletion'}</button></article>) : <p className="privacy-empty">You have no uploaded originals available for deletion review.</p>}</div>
      <RequestList loading={loading} requests={deletionRequests} type="deletion" busy={busy} onWithdraw={withdraw} empty="No deletion requests yet." assetName />
    </section>
  </section>
}

function RequestList({ loading, requests, type, busy, onWithdraw, empty, assetName = false }) {
  if (loading) return <p className="privacy-empty">Loading your requests…</p>
  if (!requests.length) return <p className="privacy-empty">{empty}</p>
  return <section className="privacy-request-list" aria-label={`${type} requests`}>{requests.map(request => <article key={request.id}><div><b>{assetName ? request.asset?.filename || 'Original item' : 'Export request'}</b><span>Requested {dateLabel(request.requested_at)} · <strong className={`privacy-status ${request.status}`}>{request.status}</strong></span></div>{request.status === 'pending' && <button className="text-button" disabled={Boolean(busy)} onClick={() => void onWithdraw(type, request.id)}>{busy === `${type}:${request.id}` ? 'Withdrawing…' : 'Withdraw request'}</button>}</article>)}</section>
}
