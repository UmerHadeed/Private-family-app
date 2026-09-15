import { createClient } from '@supabase/supabase-js'
import { NextResponse } from 'next/server'

export async function POST(request) {
  const url = process.env.NEXT_PUBLIC_SUPABASE_URL
  const publicKey = process.env.NEXT_PUBLIC_SUPABASE_PUBLISHABLE_KEY
  const serviceKey = process.env.SUPABASE_SERVICE_ROLE_KEY
  const token = request.headers.get('authorization')?.replace(/^Bearer\s+/i, '')
  if (!url || !publicKey || !serviceKey) return NextResponse.json({ error: 'Invitation email delivery is not configured.' }, { status: 503 })
  if (!token) return NextResponse.json({ error: 'Sign in again before sending an invitation.' }, { status: 401 })
  const body = await request.json().catch(() => ({}))
  const email = typeof body.email === 'string' ? body.email.trim().toLowerCase() : ''
  const invitationId = typeof body.invitationId === 'string' ? body.invitationId : ''
  if (!email || !invitationId) return NextResponse.json({ error: 'A valid invitation is required.' }, { status: 400 })

  const memberClient = createClient(url, publicKey, { global: { headers: { Authorization: `Bearer ${token}` } } })
  const { data: userData, error: userError } = await memberClient.auth.getUser(token)
  if (userError || !userData.user) return NextResponse.json({ error: 'Your sign-in session is no longer valid.' }, { status: 401 })
  const { data: invitation, error: invitationError } = await memberClient.from('household_invitations').select('id,invited_email,status').eq('id', invitationId).eq('invited_email', email).eq('status', 'pending').maybeSingle()
  if (invitationError || !invitation) return NextResponse.json({ error: 'This invitation is no longer available to send.' }, { status: 403 })

  const admin = createClient(url, serviceKey, { auth: { autoRefreshToken: false, persistSession: false } })
  const { error: deliveryError } = await admin.auth.admin.inviteUserByEmail(email, { redirectTo: `${new URL(request.url).origin}/auth/callback` })
  if (deliveryError) return NextResponse.json({ error: deliveryError.message }, { status: 502 })
  return NextResponse.json({ delivered: true })
}
