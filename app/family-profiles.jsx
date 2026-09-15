'use client'

import { useCallback, useEffect, useMemo, useState } from 'react'
import './family-profiles.css'

const initials = name => (name || 'Family profile').split(/\s+/).slice(0, 2).map(word => word[0]).join('').toUpperCase()
const typeLabel = type => type === 'dependent' ? 'Dependant profile' : 'Child profile'
const dateLabel = value => value ? new Intl.DateTimeFormat(undefined, { month: 'long', day: 'numeric', year: 'numeric' }).format(new Date(`${value}T12:00:00`)) : 'No birth date saved'

export default function FamilyProfiles({ supabase, context, flash, onViewMemories }) {
  const [profiles, setProfiles] = useState([])
  const [members, setMembers] = useState([])
  const [guardians, setGuardians] = useState([])
  const [loading, setLoading] = useState(true)
  const [error, setError] = useState('')
  const [editor, setEditor] = useState(null)
  const [canManage, setCanManage] = useState(false)

  const load = useCallback(async () => {
    if (!supabase || !context) return
    setLoading(true); setError('')
    const [{ data: profileRows, error: profileError }, { data: memberRows, error: memberError }] = await Promise.all([
      supabase.from('family_profiles').select('id,profile_type,display_name,birth_date,created_at').eq('household_id', context.householdId).order('created_at'),
      supabase.from('household_members').select('user_id,role').eq('household_id', context.householdId).is('revoked_at', null)
    ])
    if (profileError || memberError) { setError(profileError?.message || memberError?.message); setLoading(false); return }
    const ids = (memberRows || []).map(member => member.user_id)
    const { data: userProfiles, error: userError } = ids.length ? await supabase.from('profiles').select('id,display_name').in('id', ids) : { data: [], error: null }
    if (userError) { setError(userError.message); setLoading(false); return }
    const profileIds = (profileRows || []).map(profile => profile.id)
    const { data: guardianRows, error: guardianError } = profileIds.length ? await supabase.from('profile_guardians').select('profile_id,user_id').in('profile_id', profileIds).is('revoked_at', null) : { data: [], error: null }
    if (guardianError) { setError(guardianError.message); setLoading(false); return }
    const names = new Map((userProfiles || []).map(profile => [profile.id, profile.display_name]))
    setProfiles(profileRows || []); setGuardians(guardianRows || []); setMembers((memberRows || []).map(member => ({ ...member, name: names.get(member.user_id) || 'Family member' }))); setCanManage((memberRows || []).some(member => member.user_id === context.userId && member.role === 'owner')); setLoading(false)
  }, [context, supabase])

  useEffect(() => { const timer = window.setTimeout(() => void load(), 0); return () => window.clearTimeout(timer) }, [load])
  const profileGuardians = profile => guardians.filter(guardian => guardian.profile_id === profile.id).map(guardian => members.find(member => member.user_id === guardian.user_id)?.name || 'Family member')

  return <section className="family-profiles-section"><header><div><p className="kicker">FAMILY PROFILES</p><h2>Children and dependants</h2><p>Profiles preserve family context. They do not have an account and do not inherit Family Space or My Vault access.</p></div>{canManage && <button className="primary" onClick={() => setEditor({})}>Add profile</button>}</header>{error && <div className="people-error" role="alert">{error}<button onClick={() => void load()}>Try again</button></div>}{loading ? <p className="profiles-loading">Loading family profiles…</p> : profiles.length ? <div className="profile-list">{profiles.map(profile => <article key={profile.id}><span className="profile-avatar">{initials(profile.display_name)}</span><div><b>{profile.display_name}</b><small>{typeLabel(profile.profile_type)} · does not have an account</small><small>{dateLabel(profile.birth_date)}</small></div><div className="profile-guardians"><span>Guardians</span><b>{profileGuardians(profile).length ? profileGuardians(profile).join(', ') : 'No guardian assigned'}</b></div><div className="profile-actions"><button className="link" onClick={() => onViewMemories?.(profile)}>View permitted memories</button>{canManage && <button className="secondary" onClick={() => setEditor(profile)}>Manage</button>}</div></article>)}</div> : <div className="people-empty compact"><h3>No child or dependant profiles yet</h3><p>Create a profile to keep their milestones and private profile space explicit.</p></div>}{editor && <ProfileEditor profile={editor.id ? editor : null} members={members} guardians={editor.id ? guardians.filter(guardian => guardian.profile_id === editor.id).map(guardian => guardian.user_id) : [context.userId]} supabase={supabase} close={() => setEditor(null)} onSaved={async message => { setEditor(null); await load(); flash(message) }} />}</section>
}

function ProfileEditor({ profile, members, guardians, supabase, close, onSaved }) {
  const [name, setName] = useState(profile?.display_name || '')
  const [type, setType] = useState(profile?.profile_type || 'child')
  const [birthDate, setBirthDate] = useState(profile?.birth_date || '')
  const [selected, setSelected] = useState(() => new Set(guardians))
  const [publishBirthday, setPublishBirthday] = useState(Boolean(!profile && false))
  const [busy, setBusy] = useState(false)
  const [error, setError] = useState('')
  const toggleGuardian = id => setSelected(current => { const next = new Set(current); next.has(id) ? next.delete(id) : next.add(id); return next })
  const submit = async event => {
    event.preventDefault(); if (busy) return
    if (!name.trim()) return setError('Give this profile a name.')
    setBusy(true); setError('')
    if (profile) {
      const { error: detailError } = await supabase.rpc('update_family_profile_details', { profile_id: profile.id, profile_name: name.trim(), profile_birth_date: birthDate || null })
      if (detailError) { setBusy(false); return setError(detailError.message) }
      const { error: guardianError } = await supabase.rpc('update_family_profile_guardians', { profile_id: profile.id, guardian_user_ids: [...selected] })
      setBusy(false)
      if (guardianError) return setError(guardianError.message)
      return onSaved('Family profile and guardians updated.')
    }
    const { error: createError } = await supabase.rpc('create_family_profile_with_milestone', { profile_name: name.trim(), kind: type, profile_birth_date: birthDate || null, guardian_user_ids: [...selected], publish_birthday: publishBirthday })
    setBusy(false)
    if (createError) return setError(createError.message)
    onSaved(publishBirthday && birthDate ? 'Family profile created and birthday added to Family Calendar.' : 'Family profile created with an explicit private profile space.')
  }
  return <div className="modal-backdrop" onMouseDown={event => event.target === event.currentTarget && close()}><section className="profile-modal" role="dialog" aria-modal="true" aria-labelledby="profile-editor-title"><header><div><p className="kicker">{profile ? 'MANAGE PROFILE' : 'ADD FAMILY PROFILE'}</p><h2 id="profile-editor-title">{profile ? profile.display_name : 'Create a child or dependant profile'}</h2><p>This creates a profile, not a sign-in account. Access is set only through the guardians selected below.</p></div><button type="button" className="modal-close" aria-label="Close" onClick={close}>×</button></header><form onSubmit={submit}><label>Name<input autoFocus maxLength="120" value={name} onChange={event => setName(event.target.value)} required /></label>{!profile && <label>Profile type<select value={type} onChange={event => setType(event.target.value)}><option value="child">Child</option><option value="dependent">Dependant</option></select></label>}<label>Birth date<input type="date" max={new Date().toISOString().slice(0, 10)} value={birthDate} onChange={event => setBirthDate(event.target.value)} /></label><fieldset><legend>Guardians with profile-space access</legend><p>Guardians can access this profile’s separate space. This does not give them access to My Vault or other private spaces.</p>{members.map(member => <label className="guardian-choice" key={member.user_id}><input type="checkbox" checked={selected.has(member.user_id)} onChange={() => toggleGuardian(member.user_id)} /><span><b>{member.name}</b><small>{member.role === 'owner' ? 'Household owner' : member.role === 'viewer' ? 'Viewer' : 'Adult member'}</small></span></label>)}</fieldset>{!profile && <label className="birthday-publish"><input type="checkbox" checked={publishBirthday} disabled={!birthDate} onChange={event => setPublishBirthday(event.target.checked)} /> Publish birthday to the shared Family Calendar</label>}<div className="profile-safety"><b>Private by design</b><span>{profile ? 'Updating guardians changes access to this profile’s own space only.' : 'A separate private profile space is created. The profile does not have an account or automatic shared-space access.'}</span></div>{error && <p className="capture-error" role="alert">{error}</p>}<footer><button className="secondary" type="button" onClick={close} disabled={busy}>Cancel</button><button className="primary" disabled={busy}>{busy ? 'Saving…' : profile ? 'Save profile' : 'Create profile'}</button></footer></form></section></div>
}
