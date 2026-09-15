-- Family Calendar invitees need the display name of existing household members.
-- This exposes no private-vault data and remains bounded to shared household membership.

begin;

create policy "profiles: household member read" on public.profiles
for select to authenticated
using (
  exists (
    select 1
    from public.household_members mine
    join public.household_members peer on peer.household_id = mine.household_id
    where mine.user_id = auth.uid()
      and mine.revoked_at is null
      and peer.user_id = profiles.id
      and peer.revoked_at is null
  )
);

commit;
