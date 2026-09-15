'use client'

import { useCallback, useEffect, useMemo, useState } from 'react'

const CATEGORY_LABELS = {
  message: 'Family Space',
  calendar_invitation: 'Calendar',
  calendar_rsvp: 'Calendar',
  calendar_reminder: 'Calendar',
  asset_share: 'Shared memories',
  household_invitation_accepted: 'Invitations',
  asset_profile_tag: 'Profile-linked memories'
}

function urlBase64ToUint8Array(value) {
  const padded = `${value}${'='.repeat((4 - value.length % 4) % 4)}`.replace(/-/g, '+').replace(/_/g, '/')
  const decoded = window.atob(padded)
  return Uint8Array.from(decoded, char => char.charCodeAt(0))
}

function formatWhen(value) {
  const date = new Date(value)
  const elapsed = Date.now() - date.getTime()
  if (elapsed < 60_000) return 'Just now'
  if (elapsed < 3_600_000) return `${Math.floor(elapsed / 60_000)}m ago`
  if (elapsed < 86_400_000) return `${Math.floor(elapsed / 3_600_000)}h ago`
  return new Intl.DateTimeFormat(undefined, { month: 'short', day: 'numeric', year: date.getFullYear() !== new Date().getFullYear() ? 'numeric' : undefined }).format(date)
}

export default function Notifications({ supabase, context, flash }) {
  const [items, setItems] = useState([])
  const [preferences, setPreferences] = useState([])
  const [devices, setDevices] = useState([])
  const [loading, setLoading] = useState(true)
  const [error, setError] = useState('')
  const [busy, setBusy] = useState(false)
  const [showSettings, setShowSettings] = useState(false)
  const unreadCount = useMemo(() => items.filter(item => !item.read_at).length, [items])

  const load = useCallback(async () => {
    if (!supabase || !context) { setLoading(false); return }
    setLoading(true); setError('')
    const [{ data: inbox, error: inboxError }, { data: preferenceRows, error: preferenceError }, { data: deviceRows, error: deviceError }] = await Promise.all([
      supabase.from('notifications').select('id,notification_kind,title,body,source_type,source_id,created_at,read_at').eq('recipient_user_id', context.userId).order('created_at', { ascending: false }).limit(100),
      supabase.from('notification_preferences').select('notification_kind,in_app_enabled,browser_push_enabled').eq('user_id', context.userId).order('notification_kind'),
      supabase.from('notification_devices').select('id,user_agent,transport,created_at,last_seen_at,revoked_at').eq('user_id', context.userId).is('revoked_at', null).order('created_at', { ascending: false })
    ])
    if (inboxError || preferenceError || deviceError) { setError(inboxError?.message || preferenceError?.message || deviceError?.message); setLoading(false); return }
    setItems(inbox || []); setPreferences(preferenceRows || []); setDevices(deviceRows || []); setLoading(false)
  }, [context, supabase])

  useEffect(() => { const timer = window.setTimeout(() => void load(), 0); return () => window.clearTimeout(timer) }, [load])
  useEffect(() => {
    if (!supabase || !context?.userId) return undefined
    const channel = supabase.channel(`notifications-${context.userId}`).on('postgres_changes', { event: '*', schema: 'public', table: 'notifications', filter: `recipient_user_id=eq.${context.userId}` }, () => void load()).subscribe()
    return () => { supabase.removeChannel(channel) }
  }, [context?.userId, load, supabase])

  const markRead = async id => {
    if (busy) return
    setBusy(true)
    const { error: markError } = await supabase.rpc('mark_notification_read', { notification_id: id })
    setBusy(false)
    if (markError) setError(markError.message); else setItems(current => current.map(item => item.id === id ? { ...item, read_at: new Date().toISOString() } : item))
  }
  const markAllRead = async () => {
    if (!unreadCount || busy) return
    setBusy(true)
    const { error: markError } = await supabase.rpc('mark_all_notifications_read')
    setBusy(false)
    if (markError) setError(markError.message); else { setItems(current => current.map(item => ({ ...item, read_at: item.read_at || new Date().toISOString() }))); flash?.('All notifications marked as read.') }
  }
  const updatePreference = async (category, key, value) => {
    if (busy) return
    const current = preferences.find(item => item.notification_kind === category) || { notification_kind: category, in_app_enabled: true, browser_push_enabled: false }
    setBusy(true)
    const { error: updateError } = await supabase.from('notification_preferences').upsert({ ...current, [key]: value, user_id: context.userId }, { onConflict: 'user_id,notification_kind' })
    setBusy(false)
    if (updateError) setError(updateError.message); else setPreferences(rows => [...rows.filter(item => item.notification_kind !== category), { ...current, [key]: value }].sort((a, b) => a.notification_kind.localeCompare(b.notification_kind)))
  }
  const enablePush = async () => {
    const vapidKey = process.env.NEXT_PUBLIC_VAPID_PUBLIC_KEY
    if (!('serviceWorker' in navigator) || !('PushManager' in window) || !vapidKey) { setError('Browser push needs a supported browser and configured VAPID public key. In-app notifications remain available.'); return }
    const permission = await window.Notification.requestPermission()
    if (permission !== 'granted') { setError('Browser notifications were not enabled. You can change this in browser settings at any time.'); return }
    try {
      const registration = await navigator.serviceWorker.register('/notification-worker.js')
      const subscription = await registration.pushManager.subscribe({ userVisibleOnly: true, applicationServerKey: urlBase64ToUint8Array(vapidKey) })
      const keys = subscription.toJSON().keys || {}
      if (!keys.p256dh || !keys.auth) throw new Error('The browser did not return valid push subscription keys.')
      setBusy(true)
      const { error: deviceError } = await supabase.from('notification_devices').upsert({ user_id: context.userId, push_endpoint: subscription.endpoint, p256dh_key: keys.p256dh, auth_key: keys.auth, user_agent: navigator.userAgent.slice(0, 1024), last_seen_at: new Date().toISOString() }, { onConflict: 'push_endpoint' })
      setBusy(false)
      if (deviceError) setError(deviceError.message); else { await load(); flash?.('This browser is registered for push notifications.') }
    } catch (pushError) { setBusy(false); setError(pushError.message || 'This browser could not create a push subscription.') }
  }
  const revokeDevice = async id => {
    if (busy) return
    setBusy(true)
    const { error: revokeError } = await supabase.from('notification_devices').update({ revoked_at: new Date().toISOString(), revoked_by_user_id: context.userId }).eq('id', id)
    setBusy(false)
    if (revokeError) setError(revokeError.message); else { setDevices(current => current.filter(device => device.id !== id)); flash?.('This browser will no longer receive push notifications.') }
  }

  return <><header className="page-heading notification-heading"><div><p className="kicker">PRIVATE, ON YOUR TERMS</p><h1>Notifications</h1><p className="sub">Updates only for family spaces you can access. Notification settings never change who can see the original content.</p></div><div className="notification-head-actions"><button className="secondary" onClick={() => setShowSettings(open => !open)}>{showSettings ? 'Close settings' : 'Notification settings'}</button><button className="primary" disabled={!unreadCount || busy} onClick={() => void markAllRead()}>Mark all read{unreadCount ? ` (${unreadCount})` : ''}</button></div></header>{error && <div className="notification-error" role="alert">{error}<button onClick={() => { setError(''); void load() }}>Try again</button></div>}{showSettings && <NotificationSettings preferences={preferences} devices={devices} busy={busy} onChange={updatePreference} onEnablePush={enablePush} onRevoke={revokeDevice} />}{loading ? <section className="notification-empty"><h2>Loading your private updates…</h2><p>Only notifications addressed to this account appear here.</p></section> : items.length ? <section className="notification-list" aria-label="Notification inbox">{items.map(item => <article key={item.id} className={item.read_at ? 'read' : 'unread'}><button className="notification-copy" onClick={() => !item.read_at && void markRead(item.id)}><span className={`notification-category ${item.notification_kind}`}>{CATEGORY_LABELS[item.notification_kind] || 'Family update'}</span><b>{item.title}</b>{item.body && <p>{item.body}</p>}<small>{formatWhen(item.created_at)}</small></button>{!item.read_at && <button className="notification-read" aria-label={`Mark ${item.title} as read`} onClick={() => void markRead(item.id)}>Mark read</button>}</article>)}</section> : <section className="notification-empty"><h2>You’re all caught up</h2><p>When a permitted family update needs your attention, it will appear here. My Vault activity stays private to its owner.</p><button className="secondary" onClick={() => setShowSettings(true)}>Review notification settings</button></section>}</>
}

function NotificationSettings({ preferences, devices, busy, onChange, onEnablePush, onRevoke }) {
  return <section className="notification-settings"><header><div><p className="kicker">DELIVERY CONTROLS</p><h2>Choose what reaches you</h2><p>In-app updates are private to your signed-in account. Browser subscriptions do not reveal family content or change access.</p></div>{devices.length ? <span className="notification-device-state">Browser push registered</span> : <button className="primary" disabled={busy} onClick={() => void onEnablePush()}>Enable browser push</button>}</header><div className="notification-preferences">{Object.entries(CATEGORY_LABELS).map(([kind, label]) => { const current = preferences.find(item => item.notification_kind === kind) || { in_app_enabled: true, browser_push_enabled: false }; return <article key={kind}><div><b>{label}</b><p>{kind === 'message' ? 'New Family Space messages.' : kind.startsWith('calendar_') ? 'Calendar invitations, RSVP updates, and reminders.' : 'Updates for family spaces you already can access.'}</p></div><label><input type="checkbox" checked={current.in_app_enabled} disabled={busy} onChange={event => void onChange(kind, 'in_app_enabled', event.target.checked)} /> In app</label><label><input type="checkbox" checked={current.browser_push_enabled} disabled={busy || !devices.length} onChange={event => void onChange(kind, 'browser_push_enabled', event.target.checked)} /> Browser push</label></article> })}</div><div className="notification-devices"><h3>Your registered browsers</h3>{devices.length ? devices.map(device => <article key={device.id}><div><b>{device.user_agent || 'Browser push subscription'}</b><small>Registered {formatWhen(device.created_at)}</small></div><button className="text-button" disabled={busy} onClick={() => void onRevoke(device.id)}>Remove</button></article>) : <p>No browser is registered for push. You can still receive updates in this inbox.</p>}</div></section>
}
