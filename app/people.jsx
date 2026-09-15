'use client'

import { useCallback, useEffect, useMemo, useState } from 'react'
import FamilyProfiles from './family-profiles'

const initials = name => (name || 'Family member').split(/\s+/).slice(0, 2).map(part => part[0]).join('').toUpperCase()
const roleLabel = role => role === 'owner' ? 'Household owner' : role === 'viewer' ? 'Viewer' : 'Adult member'
const accessLabel = role => role === 'editor' ? 'Can contribute' : 'Can view'

export default function People({ supabase, context, spaces, flash }) {
  const [members, setMembers] = useState([])
  const [invitations, setInvitations] = useState([])
  const [loading, setLoading] = useState(true)
  const [error, setError] = useState('')
  const [inviteOpen, setInviteOpen] = useState(false)
  const familySpace = useMemo(() => spaces.find(space => space.space_type === 'family'), [spaces])
  const canManage = members.some(member => member.user_id === context?.userId && member.role === 'owner')
  const load = useCallback(async () => {
    if (!supabase || !context) return
    setLoading(true); setError('')
    const [{ data: memberRows, error: memberError }, { data: invitationRows, error: invitationError }] = await Promise.all([
      supabase.from('household_members').select('user_id,role,joined_at').eq('household_id', context.householdId).is('revoked_at', null).order('joined_at'),
      supabase.from('household_invitations').select('id,invited_email,household_role,family_space_role,status,expires_at,created_at').eq('household_id', context.householdId).eq('status', 'pending').order('created_at', { ascending: false })
    ])
    if (memberError || invitationError) { setError(memberError?.message || invitationError?.message); setLoading(false); return }
    const ids = (memberRows || []).map(member => member.user_id)
    const { data: profiles, error: profileError } = ids.length ? await supabase.from('profiles').select('id,display_name').in('id', ids) : { data: [], error: null }
    if (profileError) { setError(profileError.message); setLoading(false); return }
    const { data: memberships, error: membershipError } = familySpace ? await supabase.from('space_memberships').select('user_id,role').eq('space_id', familySpace.id).is('revoked_at', null) : { data: [], error: null }
    if (membershipError) { setError(membershipError.message); setLoading(false); return }
    const names = new Map((profiles || []).map(profile => [profile.id, profile.display_name]))
    const access = new Map((memberships || []).map(membership => [membership.user_id, membership.role]))
    setMembers((memberRows || []).map(member => ({ ...member, name: names.get(member.user_id) || 'Family member', spaceRole: access.get(member.user_id) || null })))
    setInvitations(invitationRows || []); setLoading(false)
  }, [context, familySpace, supabase])
  useEffect(() => { const timer = window.setTimeout(() => void load(), 0); return () => window.clearTimeout(timer) }, [load])

  const revokeInvitation = async invitation => {
    if (!window.confirm(`Revoke the invitation for ${invitation.invited_email}? They will not be able to join using it.`)) return
    const { error: revokeError } = await supabase.rpc('revoke_household_invitation', { invitation_id: invitation.id })
    if (revokeError) return setError(revokeError.message)
    await load(); flash(`Invitation revoked for ${invitation.invited_email}.`)
  }
  const removeMember = async member => {
    if (!window.confirm(`Remove ${member.name} from Family Space and Family Calendar? Their My Vault is not affected because it is separate.`)) return
    const { error: removeError } = await supabase.rpc('revoke_household_member', { member_user_id: member.user_id })
    if (removeError) return setError(removeError.message)
    await load(); flash(`${member.name} no longer has shared household access.`)
  }

  if (!context) return <section className="people-empty"><h2>People is still loading</h2><p>Refresh to load your household access.</p></section>
  return <><header className="page-heading"><div><p className="kicker">YOUR HOUSEHOLD</p><h1>People</h1><p className="sub">Manage who can access Family Space and Family Calendar. My Vault is never included.</p></div>{canManage && <button className="primary" onClick={() => setInviteOpen(true)}>Invite person</button>}</header>{error && <div className="people-error" role="alert">{error}<button onClick={() => void load()}>Try again</button></div>}<section className="people-access-note"><b>Shared access only</b><span>Family Space and its calendar follow the same explicit membership. Private vaults remain private.</span></section><section className="people-section"><header><div><h2>Current household</h2><p>{loading ? 'Loading access…' : `${members.length} ${members.length === 1 ? 'person' : 'people'} with current access`}</p></div></header>{!loading && members.length === 0 ? <div className="people-empty"><h3>No active household members</h3><p>Refresh and try again.</p></div> : <div className="people-list">{members.map(member => <article key={member.user_id}><span className="person-avatar">{initials(member.name)}</span><div className="person-name"><b>{member.name}{member.user_id === context.userId ? ' · You' : ''}</b><small>{roleLabel(member.role)}</small></div><div className="person-access"><span>Family Space and Calendar</span><b>{member.spaceRole ? accessLabel(member.spaceRole) : 'No shared access'}</b></div>{canManage && member.role !== 'owner' ? <button className="danger-text" onClick={() => void removeMember(member)}>Remove</button> : <span className="owner-label">{member.role === 'owner' ? 'Owner' : ''}</span>}</article>)}</div>}</section><FamilyProfiles supabase={supabase} context={context} flash={flash} />{canManage && <section className="people-section pending"><header><div><h2>Pending invitations</h2><p>Each expires after 14 days. An account must use the invited email to accept.</p></div></header>{loading ? null : invitations.length ? <div className="people-list invitations">{invitations.map(invitation => <article key={invitation.id}><span className="person-avatar pending-avatar">{initials(invitation.invited_email)}</span><div className="person-name"><b>{invitation.invited_email}</b><small>Invited {new Intl.DateTimeFormat(undefined, { month: 'short', day: 'numeric' }).format(new Date(invitation.created_at))}</small></div><div className="person-access"><span>Family Space and Calendar</span><b>{accessLabel(invitation.family_space_role)}</b></div><button className="danger-text" onClick={() => void revokeInvitation(invitation)}>Revoke</button></article>)}</div> : <div className="people-empty compact"><h3>No pending invitations</h3><p>People you invite will appear here until they join or the invitation expires.</p></div>}</section>}{inviteOpen && <InviteDialog supabase={supabase} close={() => setInviteOpen(false)} onSaved={async message => { setInviteOpen(false); await load(); flash(message) }} />}</>
}

function InviteDialog({ supabase, close, onSaved }) {
  const [email, setEmail] = useState('')
  const [access, setAccess] = useState('editor')
  const [busy, setBusy] = useState(false)
  const [error, setError] = useState('')
  const submit = async event => {
    event.preventDefault(); if (busy) return
    setBusy(true); setError('')
    const cleanEmail = email.trim().toLowerCase()
    const { data: invitation, error: invitationError } = await supabase.rpc('create_household_invitation', { invite_email: cleanEmail, invited_household_role: access === 'editor' ? 'adult_member' : 'viewer', invited_family_space_role: access })
    if (invitationError) { setBusy(false); setError(invitationError.message); return }
    const { data: { session } } = await supabase.auth.getSession()
    const delivery = await fetch('/api/household-invitations', { method: 'POST', headers: { 'Content-Type': 'application/json', Authorization: `Bearer ${session?.access_token || ''}` }, body: JSON.stringify({ email: cleanEmail, invitationId: invitation.id }) })
    const payload = await delivery.json().catch(() => ({}))
    setBusy(false)
    if (!delivery.ok) { setError(`The access invitation was saved, but the email could not be sent: ${payload.error || 'try again later.'}`); return }
    onSaved(`Invitation email sent to ${cleanEmail}.`)
  }
  return <div className="modal-backdrop" onMouseDown={event => event.target === event.currentTarget && close()}><section className="invite-modal" role="dialog" aria-modal="true" aria-labelledby="invite-person-title"><header><div><p className="kicker">ADD A PERSON</p><h2 id="invite-person-title">Invite to Family Space</h2><p>They will receive an email and can only join with this address.</p></div><button type="button" className="modal-close" aria-label="Close" onClick={close}>×</button></header><form onSubmit={submit}><label>Email address<input type="email" autoFocus autoComplete="email" value={email} onChange={event => setEmail(event.target.value)} required /></label><fieldset><legend>Shared access</legend><label className="access-choice"><input type="radio" value="editor" checked={access === 'editor'} onChange={() => setAccess('editor')} /><span><b>Can contribute</b><small>Can send messages, upload to Family Space, and add calendar events.</small></span></label><label className="access-choice"><input type="radio" value="viewer" checked={access === 'viewer'} onChange={() => setAccess('viewer')} /><span><b>Can view</b><small>Can read Family Space and Calendar but cannot publish or change shared content.</small></span></label></fieldset><div className="invite-safety"><b>Private by default</b><span>This never shares My Vault or any other private space.</span></div>{error && <p className="capture-error" role="alert">{error}</p>}<footer><button className="secondary" type="button" onClick={close} disabled={busy}>Cancel</button><button className="primary" disabled={busy}>{busy ? 'Sending invitation…' : 'Send invitation'}</button></footer></form></section></div>
}
