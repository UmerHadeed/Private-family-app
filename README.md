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
2. In **Authentication → Providers**, enable Google OAuth and set its client ID and secret.
3. Add `http://localhost:3000/auth/callback` and your production callback URL under **Authentication → URL Configuration**.
4. Copy `.env.example` to `.env.local` and provide the URL and publishable key from **Project Settings → API**.
5. Apply database policies with `npx supabase db push` after linking the project, or paste `supabase/migrations/20260910110000_initial_schema.sql` into the Supabase SQL Editor.
6. Run `npm install` then `npm run dev`.

## Permission model

OAuth proves identity; it does **not** grant household access. PostgreSQL RLS enforces explicit household and space membership. Private media is stored in the non-public `family-assets` bucket, with objects named `{household_id}/{space_id}/{asset_id}/{filename}`. Storage access requires an active membership in that specific space.

`SUPABASE_SERVICE_ROLE_KEY` is server-only. Do not expose it in browser code or commit it.
