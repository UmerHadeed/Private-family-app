'use client'

import { useCallback, useEffect, useMemo, useState } from 'react'

const WEEKDAYS = ['Sun', 'Mon', 'Tue', 'Wed', 'Thu', 'Fri', 'Sat']
const REMINDER_OPTIONS = [{ value: 0, label: 'At time of event' }, { value: 10, label: '10 minutes before' }, { value: 30, label: '30 minutes before' }, { value: 60, label: '1 hour before' }, { value: 1440, label: '1 day before' }, { value: 10080, label: '1 week before' }]

function localDate(value) { const date = new Date(value); return new Date(date.getFullYear(), date.getMonth(), date.getDate()) }
function dateKey(value) { const date = localDate(value); return `${date.getFullYear()}-${String(date.getMonth() + 1).padStart(2, '0')}-${String(date.getDate()).padStart(2, '0')}` }
function toInputDate(value) { const date = localDate(value); return `${date.getFullYear()}-${String(date.getMonth() + 1).padStart(2, '0')}-${String(date.getDate()).padStart(2, '0')}` }
function toInputTime(value) { const date = new Date(value); return `${String(date.getHours()).padStart(2, '0')}:${String(date.getMinutes()).padStart(2, '0')}` }
function formatDateTime(value, allDay) { return new Intl.DateTimeFormat(undefined, allDay ? { weekday: 'short', month: 'short', day: 'numeric' } : { weekday: 'short', month: 'short', day: 'numeric', hour: 'numeric', minute: '2-digit' }).format(new Date(value)) }
function isoFromInputs(date, time, allDay) { return new Date(`${date}T${allDay ? '00:00' : time || '09:00'}:00`).toISOString() }
function monthLabel(cursor) { return new Intl.DateTimeFormat(undefined, { month: 'long', year: 'numeric' }).format(cursor) }
function kindLabel(kind) { return kind === 'birthday' ? 'Birthday' : kind === 'anniversary' ? 'Anniversary' : kind === 'reminder' ? 'Reminder' : 'Family event' }
function addRecurrence(date, frequency, interval) { const next = new Date(date); if (frequency === 'daily') next.setDate(next.getDate() + interval); if (frequency === 'weekly') next.setDate(next.getDate() + interval * 7); if (frequency === 'monthly') next.setMonth(next.getMonth() + interval); if (frequency === 'yearly') next.setFullYear(next.getFullYear() + interval); return next }
function expandEvents(events, rangeStart, rangeEnd) { return events.flatMap(event => { const initial = new Date(event.starts_at); const duration = new Date(event.ends_at).getTime() - initial.getTime(); const items = []; let occurrence = initial; let count = 0; const until = event.recurrence_until ? new Date(`${event.recurrence_until}T23:59:59`) : null; while (occurrence < rangeStart && event.recurrence_frequency && count < 5000 && (!until || occurrence <= until)) { occurrence = addRecurrence(occurrence, event.recurrence_frequency, event.recurrence_interval); count += 1 } while (occurrence <= rangeEnd && count < 5000 && (!until || occurrence <= until)) { if (occurrence >= rangeStart) items.push({ ...event, id: `${event.id}-${occurrence.toISOString()}`, base_id: event.id, starts_at: occurrence.toISOString(), ends_at: new Date(occurrence.getTime() + duration).toISOString() }); if (!event.recurrence_frequency) break; occurrence = addRecurrence(occurrence, event.recurrence_frequency, event.recurrence_interval); count += 1 } return items })}

export default function FamilyCalendar({ supabase, context, spaces, flash }) {
  const [calendar, setCalendar] = useState(null)
  const [events, setEvents] = useState([])
  const [invitees, setInvitees] = useState([])
  const [reminders, setReminders] = useState([])
  const [members, setMembers] = useState([])
  const [view, setView] = useState('month')
  const [cursor, setCursor] = useState(() => new Date())
  const [loading, setLoading] = useState(true)
  const [error, setError] = useState('')
  const [editor, setEditor] = useState(null)
  const familySpace = useMemo(() => spaces.find(space => space.space_type === 'family'), [spaces])

  const load = useCallback(async () => {
    if (!supabase || !context || !familySpace) { setLoading(false); return }
    setLoading(true); setError('')
    const { data: calendarRow, error: calendarError } = await supabase.from('calendars').select('*').eq('space_id', familySpace.id).maybeSingle()
    if (calendarError || !calendarRow) { setError(calendarError?.message || 'Family Calendar is still being prepared. Refresh in a moment.'); setLoading(false); return }
    const [{ data: eventRows, error: eventError }, { data: memberRows, error: memberError }] = await Promise.all([
      supabase.from('calendar_events').select('*').eq('calendar_id', calendarRow.id).is('cancelled_at', null).order('starts_at'),
      supabase.from('household_members').select('user_id').eq('household_id', context.householdId).is('revoked_at', null)
    ])
    if (eventError || memberError) { setError(eventError?.message || memberError?.message); setLoading(false); return }
    const memberIds = (memberRows || []).map(member => member.user_id)
    const { data: profiles, error: profileError } = memberIds.length ? await supabase.from('profiles').select('id,display_name').in('id', memberIds) : { data: [], error: null }
    if (profileError) { setError(profileError.message); setLoading(false); return }
    const ids = (eventRows || []).map(event => event.id)
    const { data: inviteRows, error: inviteError } = ids.length ? await supabase.from('calendar_event_invitees').select('*').in('event_id', ids) : { data: [], error: null }
    const { data: reminderRows, error: reminderError } = await supabase.from('calendar_reminders').select('*').eq('user_id', context.userId).eq('status', 'pending')
    if (inviteError || reminderError) { setError(inviteError?.message || reminderError?.message); setLoading(false); return }
    const names = new Map((profiles || []).map(profile => [profile.id, profile.display_name]))
    setCalendar(calendarRow); setEvents(eventRows || []); setInvitees(inviteRows || []); setReminders(reminderRows || []); setMembers((memberRows || []).map(member => ({ id: member.user_id, name: names.get(member.user_id) || 'Family member' }))); setLoading(false)
  }, [context, familySpace, supabase])

  useEffect(() => { const timer = window.setTimeout(() => void load(), 0); return () => window.clearTimeout(timer) }, [load])
  useEffect(() => {
    if (!supabase || !calendar?.id) return undefined
    const channel = supabase.channel(`family-calendar-${calendar.id}`)
      .on('postgres_changes', { event: '*', schema: 'public', table: 'calendar_events', filter: `calendar_id=eq.${calendar.id}` }, () => void load())
      .on('postgres_changes', { event: '*', schema: 'public', table: 'calendar_event_invitees' }, () => void load())
      .subscribe()
    return () => { supabase.removeChannel(channel) }
  }, [calendar?.id, load, supabase])

  if (!familySpace) return <section className="calendar-empty"><h2>Family Calendar is unavailable</h2><p>You need current Family Space access before you can view this shared calendar.</p></section>
  return <><header className="page-heading"><div><p className="kicker">SHARED FAMILY SPACE</p><h1>Family Calendar</h1><p className="sub">Plan together, invite family members and keep the important dates in one private place.</p></div><button className="primary" onClick={() => setEditor({})}>Add event</button></header>{error && <div className="calendar-error" role="alert">{error}<button onClick={() => void load()}>Try again</button></div>}<section className="calendar-shell"><header className="calendar-toolbar"><div className="calendar-nav"><button type="button" aria-label="Previous month" onClick={() => setCursor(value => new Date(value.getFullYear(), value.getMonth() - 1, 1))}>‹</button><h2>{view === 'month' ? monthLabel(cursor) : 'Upcoming events'}</h2><button type="button" aria-label="Next month" onClick={() => setCursor(value => new Date(value.getFullYear(), value.getMonth() + 1, 1))}>›</button><button type="button" className="today-button" onClick={() => setCursor(new Date())}>Today</button></div><div className="calendar-view-switch"><button className={view === 'month' ? 'active' : ''} onClick={() => setView('month')}>Month</button><button className={view === 'agenda' ? 'active' : ''} onClick={() => setView('agenda')}>Agenda</button></div></header>{loading ? <div className="calendar-loading">Loading your shared calendar…</div> : view === 'month' ? <MonthView cursor={cursor} events={events} onSelect={setEditor} onAdd={date => setEditor({ date })} /> : <AgendaView events={events} invitees={invitees} currentUserId={context.userId} onSelect={setEditor} />}</section><CalendarSummary events={events} invitees={invitees} reminders={reminders} members={members} currentUserId={context.userId} onOpen={setEditor} />{editor && <EventEditor event={editor.id ? events.find(item => item.id === editor.id) : null} initialDate={editor.date} calendar={calendar} invitees={invitees.filter(invitee => invitee.event_id === editor.id)} members={members} context={context} supabase={supabase} close={() => setEditor(null)} onSaved={async text => { await load(); setEditor(null); flash?.(text) }} />}</>
}

function MonthView({ cursor, events, onSelect, onAdd }) {
  const first = new Date(cursor.getFullYear(), cursor.getMonth(), 1)
  const start = new Date(cursor.getFullYear(), cursor.getMonth(), 1 - first.getDay())
  const days = Array.from({ length: 42 }, (_, index) => new Date(start.getFullYear(), start.getMonth(), start.getDate() + index))
  const today = dateKey(new Date())
  const visibleEvents = expandEvents(events, start, new Date(start.getFullYear(), start.getMonth(), start.getDate() + 42))
  return <div className="calendar-month"><div className="calendar-weekdays">{WEEKDAYS.map(day => <span key={day}>{day}</span>)}</div><div className="calendar-days">{days.map(day => { const key = dateKey(day); const inMonth = day.getMonth() === cursor.getMonth(); const dayEvents = visibleEvents.filter(event => dateKey(event.starts_at) === key); return <article className={`${inMonth ? '' : 'outside'} ${key === today ? 'today' : ''}`} key={key}><header><button type="button" onClick={() => onAdd(key)} aria-label={`Add event on ${key}`}>{day.getDate()}</button></header>{dayEvents.slice(0, 3).map(event => <button key={event.id} className={`calendar-event-chip ${event.event_kind}`} onClick={() => onSelect({ id: event.base_id || event.id })}><span>{event.all_day ? 'All day' : toInputTime(event.starts_at)}</span>{event.title}</button>)}{dayEvents.length > 3 && <button className="more-events" onClick={() => onAdd(key)}>+{dayEvents.length - 3} more</button>}</article> })}</div></div>
}

function AgendaView({ events, invitees, currentUserId, onSelect }) {
  const future = expandEvents(events, new Date(), new Date(new Date().getFullYear() + 1, 11, 31)).slice(0, 60)
  if (!future.length) return <div className="agenda-empty"><h3>No upcoming family events</h3><p>Add an event to start planning together.</p></div>
  return <div className="agenda-list">{future.map(event => { const eventId = event.base_id || event.id; const myInvite = invitees.find(invitee => invitee.event_id === eventId && invitee.user_id === currentUserId); return <button key={event.id} onClick={() => onSelect({ id: eventId })}><time><b>{new Intl.DateTimeFormat(undefined, { month: 'short', day: 'numeric' }).format(new Date(event.starts_at))}</b><small>{event.all_day ? 'All day' : toInputTime(event.starts_at)}</small></time><span className={`agenda-kind ${event.event_kind}`}>{kindLabel(event.event_kind)}</span><div><h3>{event.title}</h3><p>{event.location || event.description || 'Family event'}</p><small>{event.recurrence_frequency ? `Repeats ${event.recurrence_frequency}` : 'One-time event'}{myInvite ? ` · Your RSVP: ${myInvite.rsvp_status}` : ''}</small></div><em>›</em></button> })}</div>
}

function CalendarSummary({ events, invitees, reminders, members, currentUserId, onOpen }) {
  const upcoming = events.filter(event => new Date(event.ends_at) >= new Date()).slice(0, 3)
  const dueReminders = reminders.map(reminder => { const event = events.find(item => item.id === reminder.event_id); return event ? { ...reminder, event, dueAt: new Date(new Date(event.starts_at).getTime() - reminder.minutes_before * 60000) } : null }).filter(Boolean).filter(reminder => reminder.dueAt >= new Date()).sort((a, b) => a.dueAt - b.dueAt).slice(0, 3)
  const memberNames = new Map(members.map(member => [member.id, member.name]))
  return <><section className="calendar-summary"><div><h2>Up next</h2><p>Important family dates and plans.</p></div>{upcoming.length ? <div className="summary-events">{upcoming.map(event => { const going = invitees.filter(invitee => invitee.event_id === event.id && invitee.rsvp_status === 'going').map(invitee => memberNames.get(invitee.user_id) || 'Family member'); return <button key={event.id} onClick={() => onOpen({ id: event.id })}><time>{formatDateTime(event.starts_at, event.all_day)}</time><b>{event.title}</b><small>{going.length ? `${going.join(', ')} going` : 'Family event'}</small></button> })}</div> : <button className="link" onClick={() => onOpen({})}>Add the first family event</button>}</section>{dueReminders.length ? <section className="calendar-reminders"><div><h2>Your reminders</h2><p>Saved in-app reminders. Browser push requires a registered device and enabled delivery preference.</p></div><div>{dueReminders.map(reminder => <button key={reminder.id} onClick={() => onOpen({ id: reminder.event.id })}><b>{reminder.event.title}</b><span>{formatDateTime(reminder.dueAt, false)} · {REMINDER_OPTIONS.find(option => option.value === reminder.minutes_before)?.label}</span></button>)}</div></section> : null}</>
}

function EventEditor({ event, initialDate, calendar, invitees, members, context, supabase, close, onSaved }) {
  const initialStart = event?.starts_at || isoFromInputs(initialDate || toInputDate(new Date()), '09:00', false)
  const initialEnd = event?.ends_at || isoFromInputs(initialDate || toInputDate(new Date()), '10:00', false)
  const [title, setTitle] = useState(event?.title || '')
  const [description, setDescription] = useState(event?.description || '')
  const [location, setLocation] = useState(event?.location || '')
  const [kind, setKind] = useState(event?.event_kind || 'event')
  const [allDay, setAllDay] = useState(event?.all_day || false)
  const [startDate, setStartDate] = useState(toInputDate(initialStart))
  const [startTime, setStartTime] = useState(toInputTime(initialStart))
  const [endDate, setEndDate] = useState(toInputDate(initialEnd))
  const [endTime, setEndTime] = useState(toInputTime(initialEnd))
  const [frequency, setFrequency] = useState(event?.recurrence_frequency || '')
  const [until, setUntil] = useState(event?.recurrence_until || '')
  const [selectedMembers, setSelectedMembers] = useState(() => new Set(invitees.map(invitee => invitee.user_id)))
  const [reminders, setReminders] = useState(() => new Set(kind === 'birthday' ? [10080, 1440] : [60]))
  const [busy, setBusy] = useState(false)
  const [error, setError] = useState('')
  const owner = event?.created_by_user_id === context.userId
  const memberToggle = id => setSelectedMembers(current => { const next = new Set(current); next.has(id) ? next.delete(id) : next.add(id); return next })
  const reminderToggle = value => setReminders(current => { const next = new Set(current); next.has(value) ? next.delete(value) : next.add(value); return next })
  const save = async submit => {
    submit.preventDefault(); if (busy) return
    const startsAt = isoFromInputs(startDate, startTime, allDay), endsAt = isoFromInputs(endDate, endTime, allDay)
    if (!title.trim()) { setError('Give the event a title.'); return }
    if (new Date(endsAt) <= new Date(startsAt)) { setError('The event must end after it starts.'); return }
    setBusy(true); setError('')
    const payload = { calendar_id: calendar.id, created_by_user_id: context.userId, title: title.trim(), description: description.trim(), location: location.trim(), event_kind: kind, starts_at: startsAt, ends_at: endsAt, all_day: allDay, timezone: Intl.DateTimeFormat().resolvedOptions().timeZone || 'UTC', recurrence_frequency: frequency || null, recurrence_interval: 1, recurrence_until: frequency && until ? until : null }
    const result = event ? await supabase.from('calendar_events').update(payload).eq('id', event.id).select().single() : await supabase.from('calendar_events').insert(payload).select().single()
    if (result.error) { setBusy(false); setError(result.error.message); return }
    const saved = result.data
    if (!event) {
      const attendeeRows = [...selectedMembers].map(userId => ({ event_id: saved.id, user_id: userId, invited_by_user_id: context.userId }))
      if (attendeeRows.length) { const { error: inviteError } = await supabase.from('calendar_event_invitees').insert(attendeeRows); if (inviteError) { setBusy(false); setError(`Event was saved, but invites could not be added: ${inviteError.message}`); return } }
      const reminderRows = [...reminders].map(minutesBefore => ({ event_id: saved.id, user_id: context.userId, minutes_before: minutesBefore }))
      if (reminderRows.length) { const { error: reminderError } = await supabase.from('calendar_reminders').insert(reminderRows); if (reminderError) { setBusy(false); setError(`Event was saved, but a reminder could not be added: ${reminderError.message}`); return } }
    }
    setBusy(false); onSaved(event ? 'Family event updated.' : 'Family event added and shared.')
  }
  const rsvp = async status => { const me = invitees.find(invitee => invitee.user_id === context.userId); if (!me) return; setBusy(true); const { error: rsvpError } = await supabase.from('calendar_event_invitees').update({ rsvp_status: status }).eq('event_id', event.id).eq('user_id', context.userId); setBusy(false); if (rsvpError) setError(rsvpError.message); else onSaved(`RSVP updated to ${status}.`) }
  const cancel = async () => { if (!window.confirm('Cancel this family event? It will stay in the audit history, but no longer appear on the calendar.')) return; setBusy(true); const { error: cancelError } = await supabase.from('calendar_events').update({ cancelled_at: new Date().toISOString() }).eq('id', event.id); setBusy(false); if (cancelError) setError(cancelError.message); else onSaved('Family event cancelled.') }
  const myInvite = invitees.find(invitee => invitee.user_id === context.userId)
  return <div className="modal-backdrop" onMouseDown={target => target.target === target.currentTarget && close()}><section className="calendar-modal" role="dialog" aria-modal="true" aria-labelledby="calendar-event-title"><header><div><p className="kicker">{event ? kindLabel(event.event_kind) : 'NEW FAMILY EVENT'}</p><h2 id="calendar-event-title">{event ? event.title : 'Plan something together'}</h2></div><button type="button" aria-label="Close" className="modal-close" onClick={close}>×</button></header>{event && !owner ? <><div className="event-detail"><p>{formatDateTime(event.starts_at, event.all_day)}{event.recurrence_frequency ? ` · Repeats ${event.recurrence_frequency}` : ''}</p>{event.location && <p>{event.location}</p>}{event.description && <p>{event.description}</p>}</div>{myInvite ? <div className="rsvp-row"><span>Your RSVP</span>{['going', 'maybe', 'declined'].map(status => <button key={status} className={myInvite.rsvp_status === status ? 'active' : ''} disabled={busy} onClick={() => rsvp(status)}>{status === 'going' ? 'Going' : status === 'maybe' ? 'Maybe' : 'Can’t attend'}</button>)}</div> : <p className="not-invited">You can view this shared Family Calendar event, but you were not invited.</p>}</> : <form onSubmit={save} className="calendar-event-form"><label>Title<input value={title} maxLength="240" onChange={input => setTitle(input.target.value)} required /></label><div className="event-row"><label>Type<select value={kind} onChange={input => setKind(input.target.value)}><option value="event">Family event</option><option value="birthday">Birthday</option><option value="anniversary">Anniversary</option><option value="reminder">Reminder</option></select></label><label>Location<input value={location} maxLength="500" onChange={input => setLocation(input.target.value)} placeholder="Optional" /></label></div><label className="all-day-toggle"><input type="checkbox" checked={allDay} onChange={input => setAllDay(input.target.checked)} /> All-day event</label><div className="event-row"><label>Starts<input type="date" value={startDate} onChange={input => setStartDate(input.target.value)} required />{!allDay && <input type="time" value={startTime} onChange={input => setStartTime(input.target.value)} required />}</label><label>Ends<input type="date" value={endDate} onChange={input => setEndDate(input.target.value)} required />{!allDay && <input type="time" value={endTime} onChange={input => setEndTime(input.target.value)} required />}</label></div><div className="event-row"><label>Repeats<select value={frequency} onChange={input => setFrequency(input.target.value)}><option value="">Does not repeat</option><option value="daily">Daily</option><option value="weekly">Weekly</option><option value="monthly">Monthly</option><option value="yearly">Yearly</option></select></label>{frequency && <label>Repeat until<input type="date" value={until} onChange={input => setUntil(input.target.value)} /></label>}</div><label>Description<textarea value={description} maxLength="5000" onChange={input => setDescription(input.target.value)} placeholder="Optional notes for the family" /></label>{!event && <fieldset><legend>Invite family members</legend><p>Only current Family Space members can be invited.</p>{members.map(member => <label key={member.id} className="check-row"><input type="checkbox" checked={selectedMembers.has(member.id)} onChange={() => memberToggle(member.id)} /> {member.id === context.userId ? `${member.name} (you)` : member.name}</label>)}</fieldset>}{!event && <fieldset><legend>Your in-app reminders</legend><p>Push and external calendar notifications are not connected yet.</p>{REMINDER_OPTIONS.map(option => <label key={option.value} className="check-row"><input type="checkbox" checked={reminders.has(option.value)} onChange={() => reminderToggle(option.value)} /> {option.label}</label>)}</fieldset>}<footer><button type="button" className="secondary" onClick={close} disabled={busy}>Cancel</button>{event && <button type="button" className="text-button danger-text" onClick={cancel} disabled={busy}>Cancel event</button>}<button className="primary" disabled={busy}>{busy ? 'Saving…' : event ? 'Save changes' : 'Add family event'}</button></footer></form>}{error && <p className="capture-error" role="alert">{error}</p>}</section></div>
}
