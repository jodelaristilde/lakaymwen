-- Lakaymwen: lets the home page show the NEWEST real member (first slot) to visitors who are not signed in.
-- Shows ONLY: first name, first letter of last name, hometown, profile photo. Nothing else.
-- Run this once in Supabase: SQL Editor > New query > paste > Run.
create or replace function public.latest_member()
returns table(first_name text, last_initial text, hometown text, photo_url text)
language sql
security definer
set search_path = public
as $$
  select p.first_name,
         left(coalesce(p.last_name, ''), 1) as last_initial,
         p.hometown,
         p.photo_url
  from public.profiles p
  where coalesce(p.suspended, false) = false
    and p.photo_url is not null and p.photo_url <> ''
    and p.first_name is not null and p.first_name <> ''
  order by p.created_at desc
  limit 1;
$$;

grant execute on function public.latest_member() to anon, authenticated;

-- To turn it off later: drop function public.latest_member();
