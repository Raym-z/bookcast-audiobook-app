-- Database statistics for /api/health.
-- Run once in the Supabase SQL editor (Dashboard -> SQL Editor -> New query).
--
-- /api/health is called by a cron job to keep this Supabase project from being
-- paused for inactivity. It needs to read aggregate table counts, including the
-- number of registered users, which live in auth.users.
--
-- The anon/authenticated roles cannot read auth.users, so the function is
-- SECURITY DEFINER (it runs with the privileges of its owner, postgres).
-- Only aggregate counts are returned — never user rows or personal data.

create or replace function public.health_stats()
returns jsonb
language sql
stable
security definer
set search_path = ''
as $$
  select jsonb_build_object(
    'users', (select count(*) from auth.users),
    'audiobooks', (select count(*) from public.audiobooks),
    'favorites', (select count(*) from public.favorites),
    'listening_history', (select count(*) from public.listening_history)
  );
$$;

-- Nobody gets to call it by default...
revoke all on function public.health_stats() from public;

-- ...except the roles the app and the cron route use.
grant execute on function public.health_stats() to anon, authenticated, service_role;

-- Make the function available immediately instead of waiting for PostgREST's
-- schema cache to refresh.
notify pgrst, 'reload schema';
