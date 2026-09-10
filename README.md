# Private Family OS

A privacy-first family memory application built with **Next.js**, **Supabase Auth OAuth**, **Supabase PostgreSQL**, and **Supabase Storage**.

## Stack

- Next.js 16 (App Router) and React 19
- Supabase Auth with OAuth (Google enabled in the current sign-in flow)
- Supabase PostgreSQL with Row Level Security (RLS)
- Supabase Storage private bucket with space-level access policies
- Vercel-ready deployment

## Local setup

1. Create a Supabase project.
2. In **Authentication → Providers**, enable Google OAuth and set its client ID and secret if you want Google sign-in.
3. In **Authentication → Providers → Email**, keep Email enabled. Configure confirmation emails and a production SMTP provider before inviting real family members.
4. Add `http://localhost:3000/auth/callback` and your production callback URL under **Authentication → URL Configuration**.
5. Copy `.env.example` to `.env.local` and provide the URL and publishable key from **Project Settings → API**.
5. Apply database policies and household onboarding with `npx supabase db push` after linking the project. If using the SQL Editor, run both migrations in timestamp order: `20260910110000_initial_schema.sql`, then `20260910130000_household_onboarding.sql`.
6. Run `npm install` then `npm run dev`.
7. After the first sign-in, create your household. This atomically creates your owner membership, **My Vault**, and **Family Space**; other people receive no access until an invitation flow is added.

## Permission model

OAuth proves identity; it does **not** grant household access. PostgreSQL RLS enforces explicit household and space membership. Private media is stored in the non-public `family-assets` bucket, with objects named `{household_id}/{space_id}/{asset_id}/{filename}`. Storage access requires an active membership in that specific space.

`SUPABASE_SERVICE_ROLE_KEY` is server-only. Do not expose it in browser code or commit it.
