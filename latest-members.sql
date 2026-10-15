-- Lakaymwen: lets the home page show the newest REAL members to visitors who are not signed in.
-- Each real member WITH A PROFILE PHOTO takes the place of one sample (AI) profile, until all 21 places are real people.
-- Members without a photo are not shown here, so every card on the home page always has a face.
-- Shows ONLY: first name, first letter of last name, hometown, profile photo. Nothing else.
-- Run this once in Supabase: SQL Editor > New query > paste > Run.
create or replace function public.latest_members(p_limit int default 21)
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
  limit least(greatest(coalesce(p_limit, 21), 1), 21);
$$;

grant execute on function public.latest_members(int) to anon, authenticated;

-- To turn it off later: drop function public.latest_members(int);
