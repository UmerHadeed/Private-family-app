'use client'

import Link from 'next/link'
import { useEffect, useState } from 'react'
import { getSupabaseBrowserClient } from '../../lib/supabase/client'

export default function ResetPasswordPage() {
  const supabase = getSupabaseBrowserClient()
  const [password, setPassword] = useState('')
  const [confirm, setConfirm] = useState('')
  const [status, setStatus] = useState('checking')
  const [message, setMessage] = useState('')
  const [busy, setBusy] = useState(false)

  useEffect(() => {
    const checkRecovery = async () => {
      if (!supabase) { setStatus('error'); setMessage('Account recovery is not configured.'); return }
      const { data, error } = await supabase.auth.getUser()
      if (error || !data.user) { setStatus('error'); setMessage('This reset link is invalid or has expired. Request a new link from sign in.'); return }
      setStatus('ready')
    }
    const timer = window.setTimeout(() => { void checkRecovery() }, 0)
    return () => window.clearTimeout(timer)
  }, [supabase])

  const submit = async event => {
    event.preventDefault()
    if (!supabase || busy) return
    if (password.length < 8) { setMessage('Choose a password with at least 8 characters.'); return }
    if (password !== confirm) { setMessage('The passwords do not match.'); return }
    setBusy(true); setMessage('')
    const { error } = await supabase.auth.updateUser({ password })
    setBusy(false)
    if (error) { setMessage(error.message); return }
    setStatus('complete'); setMessage('Your password has been updated. You can now return to Private Family OS.')
  }

  return <main className="auth-screen"><section className="auth-card"><span className="auth-logo">♡</span><p className="kicker">ACCOUNT RECOVERY</p><h1>Choose a new password.</h1>{status === 'checking' ? <p>Checking your secure reset link…</p> : status === 'ready' ? <form className="auth-form" onSubmit={submit}><label>New password<input autoFocus type="password" autoComplete="new-password" minLength="8" value={password} onChange={event => setPassword(event.target.value)} required /></label><label>Confirm password<input type="password" autoComplete="new-password" minLength="8" value={confirm} onChange={event => setConfirm(event.target.value)} required /></label><button className="primary" disabled={busy}>{busy ? 'Updating…' : 'Update password'}</button></form> : null}{message && <p className="auth-message" role={status === 'error' ? 'alert' : 'status'}>{message}</p>}{status !== 'ready' && <Link className="text-button" href="/">Return to sign in</Link>}</section></main>
}
