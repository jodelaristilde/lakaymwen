-- ============================================================
-- Lakaymwen.com database setup
-- Paste this whole file into Supabase > SQL Editor > New query
-- and press "Run". Run it once.
-- ============================================================

create extension if not exists unaccent with schema extensions;

-- ---------- Notices: "I'm looking for someone" ----------
create table if not exists public.notices (
  id          uuid primary key default gen_random_uuid(),
  author      uuid not null default auth.uid() references auth.users(id) on delete cascade,
  person_name text not null check (char_length(person_name) between 2 and 80),
  hometown    text not null check (char_length(hometown) between 2 and 60),
  last_heard  text check (char_length(last_heard) <= 40),
  message     text check (char_length(message) <= 600),
  posted_by   text not null check (char_length(posted_by) between 2 and 60),
  name_key    text,
  active      boolean not null default true,
  created_at  timestamptz not null default now()
);
create index if not exists notices_created_idx on public.notices (created_at desc);
create index if not exists notices_hometown_idx on public.notices (hometown);

-- Makes search ignore accents and capitals ("Leogane" finds "Léogâne")
create or replace function public.set_name_key()
returns trigger language plpgsql
set search_path = public, extensions
as $$
begin
  new.name_key := lower(unaccent(new.person_name));
  return new;
end $$;

drop trigger if exists notices_name_key on public.notices;
create trigger notices_name_key
  before insert or update of person_name on public.notices
  for each row execute function public.set_name_key();

alter table public.notices enable row level security;

drop policy if exists "Anyone can read active notices" on public.notices;
create policy "Anyone can read active notices" on public.notices
  for select using (active or author = auth.uid());

drop policy if exists "Members post their own notices" on public.notices;
create policy "Members post their own notices" on public.notices
  for insert to authenticated with check (author = auth.uid());

drop policy if exists "Authors edit their own notices" on public.notices;
create policy "Authors edit their own notices" on public.notices
  for update to authenticated using (author = auth.uid()) with check (author = auth.uid());

drop policy if exists "Authors delete their own notices" on public.notices;
create policy "Authors delete their own notices" on public.notices
  for delete to authenticated using (author = auth.uid());

-- ---------- Member profiles (created when someone registers) ----------
-- Only a display name and hometown. Email stays hidden inside Supabase.
create table if not exists public.profiles (
  id           uuid primary key default auth.uid() references auth.users(id) on delete cascade,
  display_name text not null check (char_length(display_name) between 2 and 60),
  hometown     text not null check (char_length(hometown) between 2 and 60),
  lives_in     text check (char_length(lives_in) <= 60),
  listed       boolean not null default true,
  name_key     text,
  created_at   timestamptz not null default now()
);
create index if not exists profiles_hometown_idx on public.profiles (hometown);
-- Members log in with a username (no email needed)
alter table public.profiles add column if not exists username text;
create unique index if not exists profiles_username_idx on public.profiles (lower(username));
-- Profile photo and "About me"
alter table public.profiles add column if not exists photo_url text;
alter table public.profiles add column if not exists bio text check (char_length(bio) <= 600);

-- Old-site profile questions + family
alter table public.profiles add column if not exists first_name text check (char_length(first_name) <= 40);
alter table public.profiles add column if not exists last_name  text check (char_length(last_name)  <= 40);
alter table public.profiles add column if not exists nickname   text check (char_length(nickname)   <= 40);
alter table public.profiles add column if not exists schools    text check (char_length(schools)    <= 300);
alter table public.profiles add column if not exists country    text check (char_length(country)    <= 60);
alter table public.profiles add column if not exists family     jsonb not null default '[]'::jsonb
  check (jsonb_typeof(family) = 'array' and jsonb_array_length(family) <= 30);
alter table public.profiles add column if not exists family_key text;
-- Neighborhood in Haiti (katye), and a search key for katye + schools
alter table public.profiles add column if not exists katye text check (char_length(katye) <= 80);
alter table public.profiles add column if not exists place_key text;
alter table public.profiles add column if not exists state text check (char_length(state) <= 60);
alter table public.profiles add column if not exists school_list jsonb not null default '[]'::jsonb
  check (jsonb_typeof(school_list) = 'array' and jsonb_array_length(school_list) <= 15);

-- Lets the Register page check a username before the account is created
create or replace function public.username_available(u text)
returns boolean language sql stable security definer
set search_path = public
as $$ select not exists (select 1 from public.profiles where lower(username) = lower(trim(u))) $$;
grant execute on function public.username_available(text) to anon, authenticated;

-- Search keys: names (with nickname) and family members' names,
-- without accents or capitals, so "leogane" finds "Léogâne"
create or replace function public.set_profile_key()
returns trigger language plpgsql
set search_path = public, extensions
as $$
begin
  new.name_key := lower(unaccent(coalesce(new.display_name, '') || ' ' || coalesce(new.nickname, '')));
  new.family_key := lower(unaccent(coalesce(
    (select string_agg(e->>'name', ' | ') from jsonb_array_elements(coalesce(new.family, '[]'::jsonb)) e), '')));
  -- schools are {name, years}; very old rows may be plain text
  new.place_key := lower(unaccent(coalesce(new.katye, '') || ' | ' || coalesce(
    (select string_agg(case when jsonb_typeof(e) = 'string' then e #>> '{}' else e->>'name' end, ' | ')
       from jsonb_array_elements(coalesce(new.school_list, '[]'::jsonb)) e), '')));
  return new;
end $$;

drop trigger if exists profiles_name_key on public.profiles;
create trigger profiles_name_key
  before insert or update on public.profiles
  for each row execute function public.set_profile_key();
-- fill the search keys for members who joined before this was added
update public.profiles set id = id where place_key is null;

alter table public.profiles enable row level security;

drop policy if exists "Members see listed members" on public.profiles;
create policy "Members see listed members" on public.profiles
  for select to authenticated using (listed or id = auth.uid());

drop policy if exists "Create your own profile" on public.profiles;
create policy "Create your own profile" on public.profiles
  for insert to authenticated with check (id = auth.uid());

drop policy if exists "Edit your own profile" on public.profiles;
create policy "Edit your own profile" on public.profiles
  for update to authenticated using (id = auth.uid()) with check (id = auth.uid());

-- ---------- Private messages ----------
-- A message is either about a notice (between the person who posted it
-- and one other member) or sent directly to a listed member.
create table if not exists public.messages (
  id          uuid primary key default gen_random_uuid(),
  notice_id   uuid references public.notices(id) on delete cascade,
  sender      uuid not null default auth.uid() references auth.users(id) on delete cascade,
  recipient   uuid not null references auth.users(id) on delete cascade,
  body        text not null check (char_length(body) between 1 and 2000),
  created_at  timestamptz not null default now(),
  read_at     timestamptz
);
alter table public.messages alter column notice_id drop not null;
create index if not exists messages_recipient_idx on public.messages (recipient, created_at desc);
create index if not exists messages_sender_idx on public.messages (sender, created_at desc);

alter table public.messages enable row level security;

drop policy if exists "See only your own conversations" on public.messages;
create policy "See only your own conversations" on public.messages
  for select to authenticated using (sender = auth.uid() or recipient = auth.uid());

drop policy if exists "Send messages about a notice" on public.messages;
create policy "Send messages about a notice" on public.messages
  for insert to authenticated with check (
    sender = auth.uid()
    and sender <> recipient
    and (
      (notice_id is not null and exists (
        select 1 from public.notices n
        where n.id = notice_id
          and (n.author = recipient or n.author = auth.uid())))
      or
      (notice_id is null and exists (
        select 1 from public.profiles p
        where p.id = recipient and p.listed))
    )
  );

drop policy if exists "Mark your messages as read" on public.messages;
create policy "Mark your messages as read" on public.messages
  for update to authenticated using (recipient = auth.uid()) with check (recipient = auth.uid());

-- ---------- Reports (you review these in the Supabase Table Editor) ----------
create table if not exists public.reports (
  id         uuid primary key default gen_random_uuid(),
  notice_id  uuid not null references public.notices(id) on delete cascade,
  reporter   uuid not null default auth.uid() references auth.users(id) on delete cascade,
  reason     text check (char_length(reason) <= 500),
  created_at timestamptz not null default now()
);

alter table public.reports enable row level security;

drop policy if exists "Members can report a notice" on public.reports;
create policy "Members can report a notice" on public.reports
  for insert to authenticated with check (reporter = auth.uid());

-- ---------- Profile photos (Supabase Storage) ----------
-- A public "avatars" folder. Each member can only add, change or delete
-- photos inside their own sub-folder. Max 2 MB, images only.
insert into storage.buckets (id, name, public, file_size_limit, allowed_mime_types)
values ('avatars', 'avatars', true, 2097152, array['image/jpeg','image/png','image/webp'])
on conflict (id) do nothing;

drop policy if exists "Members add their own photo" on storage.objects;
create policy "Members add their own photo" on storage.objects
  for insert to authenticated
  with check (bucket_id = 'avatars' and (storage.foldername(name))[1] = auth.uid()::text);

drop policy if exists "Members change their own photo" on storage.objects;
create policy "Members change their own photo" on storage.objects
  for update to authenticated
  using (bucket_id = 'avatars' and (storage.foldername(name))[1] = auth.uid()::text)
  with check (bucket_id = 'avatars' and (storage.foldername(name))[1] = auth.uid()::text);

drop policy if exists "Members delete their own photo" on storage.objects;
create policy "Members delete their own photo" on storage.objects
  for delete to authenticated
  using (bucket_id = 'avatars' and (storage.foldername(name))[1] = auth.uid()::text);

drop policy if exists "Members read their own photo files" on storage.objects;
create policy "Members read their own photo files" on storage.objects
  for select to authenticated
  using (bucket_id = 'avatars' and (storage.foldername(name))[1] = auth.uid()::text);

-- ---------- Friends ----------
-- A request starts as "pending"; the other member accepts it (or declines by deleting it).
-- Accepted friendships are visible to all members, so friend lists show on profiles.
create table if not exists public.friendships (
  requester  uuid not null default auth.uid() references auth.users(id) on delete cascade,
  addressee  uuid not null references auth.users(id) on delete cascade,
  status     text not null default 'pending' check (status in ('pending', 'accepted')),
  created_at timestamptz not null default now(),
  primary key (requester, addressee),
  check (requester <> addressee)
);
create index if not exists friendships_addressee_idx on public.friendships (addressee);

alter table public.friendships enable row level security;

drop policy if exists "Members see friendships" on public.friendships;
create policy "Members see friendships" on public.friendships
  for select to authenticated
  using (status = 'accepted' or requester = auth.uid() or addressee = auth.uid());

drop policy if exists "Members send friend requests" on public.friendships;
create policy "Members send friend requests" on public.friendships
  for insert to authenticated
  with check (requester = auth.uid() and status = 'pending');

drop policy if exists "Members accept requests sent to them" on public.friendships;
create policy "Members accept requests sent to them" on public.friendships
  for update to authenticated
  using (addressee = auth.uid())
  with check (addressee = auth.uid() and status = 'accepted');

drop policy if exists "Members remove their own friendships" on public.friendships;
create policy "Members remove their own friendships" on public.friendships
  for delete to authenticated
  using (requester = auth.uid() or addressee = auth.uid());

-- ============================================================
-- Safety, admin and account tools
-- ============================================================

-- New profile fields
alter table public.profiles add column if not exists founding boolean not null default false;   -- member before 2008
alter table public.profiles add column if not exists old_username text check (char_length(old_username) <= 40);
alter table public.profiles add column if not exists accepted_terms_at timestamptz;
alter table public.profiles add column if not exists suspended boolean not null default false;   -- hidden by an admin

-- ---------- Admins (you add yourself, see LAUNCH-GUIDE.md) ----------
create table if not exists public.admins (
  user_id uuid primary key references auth.users(id) on delete cascade
);
alter table public.admins enable row level security;
drop policy if exists "Admins see the admin list" on public.admins;
create policy "Admins see the admin list" on public.admins
  for select to authenticated using (user_id = auth.uid());

create or replace function public.is_admin()
returns boolean language sql stable security definer
set search_path = public
as $$ select exists (select 1 from public.admins where user_id = auth.uid()) $$;
grant execute on function public.is_admin() to authenticated;

-- Profiles: hidden or suspended members don't show (except to themselves and admins)
drop policy if exists "Members see listed members" on public.profiles;
create policy "Members see listed members" on public.profiles
  for select to authenticated
  using ((listed and not suspended) or id = auth.uid() or public.is_admin());

drop policy if exists "Admins can hide or restore members" on public.profiles;
create policy "Admins can hide or restore members" on public.profiles
  for update to authenticated using (public.is_admin()) with check (public.is_admin());

-- Members can't un-suspend themselves
create or replace function public.keep_suspended()
returns trigger language plpgsql
set search_path = public
as $$
begin
  if not public.is_admin() then
    new.suspended := old.suspended;
  end if;
  return new;
end $$;
drop trigger if exists profiles_keep_suspended on public.profiles;
create trigger profiles_keep_suspended
  before update on public.profiles
  for each row execute function public.keep_suspended();

-- ---------- Blocking ----------
create table if not exists public.blocks (
  blocker    uuid not null default auth.uid() references auth.users(id) on delete cascade,
  blocked    uuid not null references auth.users(id) on delete cascade,
  created_at timestamptz not null default now(),
  primary key (blocker, blocked),
  check (blocker <> blocked)
);

-- Members can only read their own block list, so rules that must respect
-- someone else's block ask this function instead.
create or replace function public.has_blocked(p_blocker uuid, p_blocked uuid)
returns boolean language sql stable security definer  -- only answers about blocks that involve you
set search_path = public
as $$ select auth.uid() in (p_blocker, p_blocked)
       and exists (select 1 from public.blocks where blocker = p_blocker and blocked = p_blocked) $$;
grant execute on function public.has_blocked(uuid, uuid) to authenticated;

alter table public.blocks enable row level security;
drop policy if exists "Members manage their own blocks" on public.blocks;
create policy "Members manage their own blocks" on public.blocks
  for all to authenticated using (blocker = auth.uid()) with check (blocker = auth.uid());

-- Messages: only to visible members who haven't blocked you
drop policy if exists "Send messages about a notice" on public.messages;
create policy "Send messages about a notice" on public.messages
  for insert to authenticated with check (
    sender = auth.uid()
    and sender <> recipient
    and exists (select 1 from public.profiles p where p.id = recipient and not p.suspended)
    and not public.has_blocked(recipient, auth.uid())
    and not exists (select 1 from public.profiles s where s.id = auth.uid() and s.suspended)
  );

-- Friend requests: not to (or from) someone who blocked you
drop policy if exists "Members send friend requests" on public.friendships;
create policy "Members send friend requests" on public.friendships
  for insert to authenticated
  with check (requester = auth.uid() and status = 'pending'
    and not public.has_blocked(addressee, auth.uid()));

-- ---------- Reporting a member ----------
create table if not exists public.member_reports (
  id         uuid primary key default gen_random_uuid(),
  reporter   uuid not null default auth.uid() references auth.users(id) on delete cascade,
  reported   uuid not null references auth.users(id) on delete cascade,
  reason     text not null check (char_length(reason) between 1 and 60),
  details    text check (char_length(details) <= 1000),
  status     text not null default 'open' check (status in ('open', 'done')),
  created_at timestamptz not null default now(),
  check (reporter <> reported)
);
alter table public.member_reports enable row level security;
drop policy if exists "Members report members" on public.member_reports;
create policy "Members report members" on public.member_reports
  for insert to authenticated with check (reporter = auth.uid() and status = 'open');
drop policy if exists "Admins read reports" on public.member_reports;
create policy "Admins read reports" on public.member_reports
  for select to authenticated using (public.is_admin());
drop policy if exists "Admins close reports" on public.member_reports;
create policy "Admins close reports" on public.member_reports
  for update to authenticated using (public.is_admin()) with check (public.is_admin());

-- ---------- Town counts (correct at any size; anyone can see the numbers) ----------
create or replace function public.town_counts()
returns table (hometown text, members bigint) language sql stable security definer
set search_path = public
as $$ select hometown, count(*) from public.profiles where listed and not suspended group by hometown $$;
grant execute on function public.town_counts() to anon, authenticated;

-- ---------- Admin numbers ----------
create or replace function public.admin_stats()
returns json language sql stable security definer
set search_path = public
as $$
  select case when public.is_admin() then json_build_object(
    'members',        (select count(*) from public.profiles),
    'new_this_week',  (select count(*) from public.profiles where created_at > now() - interval '7 days'),
    'hidden',         (select count(*) from public.profiles where suspended),
    'open_reports',   (select count(*) from public.member_reports where status = 'open'),
    'messages',       (select count(*) from public.messages)
  ) end
$$;
grant execute on function public.admin_stats() to authenticated;

-- ---------- Delete my account ----------
-- Removes the login; profile, messages, friends, blocks and reports go with it.
create or replace function public.delete_my_account()
returns void language plpgsql security definer
set search_path = public
as $$
begin
  if auth.uid() is null then raise exception 'not signed in'; end if;
  delete from auth.users where id = auth.uid();
end $$;
grant execute on function public.delete_my_account() to authenticated;

-- =====================================================================
-- Name alerts: "Tell me when Marie Joseph joins"
-- A member saves a first + last name. When someone with that name joins,
-- or a member lists that name in their family, the saver gets a match
-- on the site (and an email, once alert-emails.sql is set up).
-- =====================================================================
create table if not exists public.search_alerts (
  id         uuid primary key default gen_random_uuid(),
  owner      uuid not null default auth.uid() references auth.users(id) on delete cascade,
  query      text not null check (char_length(query) between 3 and 80),
  query_key  text not null default '',
  hometown   text check (char_length(hometown) <= 80),
  created_at timestamptz not null default now()
);
create unique index if not exists search_alerts_unique on public.search_alerts (owner, query_key, coalesce(hometown, ''));

create or replace function public.set_alert_key()
returns trigger language plpgsql
set search_path = public, extensions
as $$
begin
  new.query := btrim(regexp_replace(new.query, '\s+', ' ', 'g'));
  new.query_key := lower(unaccent(regexp_replace(new.query, '[%_\\,()*]', '', 'g')));
  if new.query_key !~ '\S{2,}\s+\S{2,}' then
    raise exception 'Use a first and last name' using errcode = '22023';
  end if;
  if tg_op = 'INSERT' and (select count(*) from public.search_alerts where owner = new.owner) >= 20 then
    raise exception 'Too many alerts' using errcode = '54000';
  end if;
  return new;
end $$;
drop trigger if exists search_alerts_key on public.search_alerts;
create trigger search_alerts_key before insert or update on public.search_alerts
  for each row execute function public.set_alert_key();

alter table public.search_alerts enable row level security;
drop policy if exists "Own alerts: read" on public.search_alerts;
create policy "Own alerts: read" on public.search_alerts for select to authenticated using (owner = auth.uid());
drop policy if exists "Own alerts: add" on public.search_alerts;
create policy "Own alerts: add" on public.search_alerts for insert to authenticated with check (owner = auth.uid());
drop policy if exists "Own alerts: remove" on public.search_alerts;
create policy "Own alerts: remove" on public.search_alerts for delete to authenticated using (owner = auth.uid());

create table if not exists public.alert_matches (
  id              uuid primary key default gen_random_uuid(),
  alert_id        uuid not null references public.search_alerts(id) on delete cascade,
  owner           uuid not null references auth.users(id) on delete cascade,
  profile_id      uuid not null references public.profiles(id) on delete cascade,
  via             text not null check (via in ('name', 'family')),
  family_relation text,
  family_name     text,
  seen            boolean not null default false,
  created_at      timestamptz not null default now(),
  unique (alert_id, profile_id)
);
create index if not exists alert_matches_owner on public.alert_matches (owner, seen);
alter table public.alert_matches enable row level security;
drop policy if exists "Own matches: read" on public.alert_matches;
create policy "Own matches: read" on public.alert_matches for select to authenticated using (owner = auth.uid());
drop policy if exists "Own matches: mark seen" on public.alert_matches;
create policy "Own matches: mark seen" on public.alert_matches for update to authenticated using (owner = auth.uid()) with check (owner = auth.uid());
drop policy if exists "Own matches: remove" on public.alert_matches;
create policy "Own matches: remove" on public.alert_matches for delete to authenticated using (owner = auth.uid());
-- members can only flip "seen"; matches are created by the database itself
revoke insert, update on public.alert_matches from anon, authenticated;
grant update (seen) on public.alert_matches to authenticated;

-- every word of the saved name must appear (so "Joseph Marie" finds "Marie Joseph")
create or replace function public.words_in(q text, hay text)
returns boolean language sql immutable
as $$
  select coalesce(bool_and(position(w in coalesce(hay, '')) > 0), false)
  from unnest(regexp_split_to_array(btrim(coalesce(q, '')), '\s+')) w where w <> ''
$$;

-- Email hook. This placeholder does nothing; alert-emails.sql replaces it
-- with one that sends the email. Re-running this file keeps your real one.
do $$ begin
  if not exists (select 1 from pg_proc p join pg_namespace n on n.oid = p.pronamespace
                 where n.nspname = 'public' and p.proname = 'send_alert_email') then
    execute 'create function public.send_alert_email(p_owner uuid, p_query text, p_name text, p_profile uuid, p_via text, p_relation text)
             returns void language plpgsql as $f$ begin return; end $f$';
  end if;
end $$;

create or replace function public.match_alerts()
returns trigger language plpgsql security definer
set search_path = public, extensions
as $$
declare
  a record; hit jsonb; by_name boolean;
begin
  if not new.listed or new.suspended then return null; end if;
  if tg_op = 'UPDATE' and new.name_key is not distinct from old.name_key
     and new.family_key is not distinct from old.family_key
     and new.listed = old.listed and new.suspended = old.suspended then
    return null;
  end if;
  for a in
    select s.* from public.search_alerts s
    where s.owner <> new.id
      and (s.hometown is null or s.hometown = new.hometown)
      and (public.words_in(s.query_key, new.name_key) or public.words_in(s.query_key, new.family_key))
      and not exists (select 1 from public.blocks b
                      where (b.blocker = new.id and b.blocked = s.owner) or (b.blocker = s.owner and b.blocked = new.id))
  loop
    by_name := public.words_in(a.query_key, new.name_key);
    hit := null;
    if not by_name then
      select e into hit from jsonb_array_elements(coalesce(new.family, '[]'::jsonb)) e
      where public.words_in(a.query_key, lower(unaccent(coalesce(e->>'name', '')))) limit 1;
      if hit is null then continue; end if;   -- words were spread over different relatives
    end if;
    insert into public.alert_matches (alert_id, owner, profile_id, via, family_relation, family_name)
    values (a.id, a.owner, new.id, case when by_name then 'name' else 'family' end, hit->>'relation', hit->>'name')
    on conflict (alert_id, profile_id) do nothing;
    if found then
      begin
        perform public.send_alert_email(a.owner, a.query, new.display_name, new.id,
                                        case when by_name then 'name' else 'family' end, hit->>'relation');
      exception when others then null;   -- an email problem must never stop someone from joining
      end;
    end if;
  end loop;
  return null;
end $$;
drop trigger if exists profiles_match_alerts on public.profiles;
create trigger profiles_match_alerts after insert or update on public.profiles
  for each row execute function public.match_alerts();

-- =====================================================================
-- School pages and katye (neighborhood) pages — members only
-- =====================================================================
-- "Bel Air", "bel-air" and "Bèl Air" all count as the same place
create or replace function public.place_norm(t text)
returns text language sql stable
set search_path = public, extensions
as $$ select regexp_replace(lower(unaccent(coalesce(t, ''))), '[^a-z0-9]+', '', 'g') $$;

create or replace function public.school_counts()
returns table (school text, members bigint) language sql stable security definer
set search_path = public, extensions
as $$
  with s as (
    select p.id, btrim(case when jsonb_typeof(e) = 'string' then e #>> '{}' else e->>'name' end) as nm
    from public.profiles p, jsonb_array_elements(p.school_list) e
    where p.listed and not p.suspended)
  select mode() within group (order by nm), count(distinct id)
  from s where char_length(nm) >= 2
  group by public.place_norm(nm)
  order by 2 desc, 1
  limit 1000
$$;

create or replace function public.school_members(p_school text)
returns setof public.profiles language sql stable
set search_path = public, extensions
as $$
  select p.* from public.profiles p
  where not p.suspended and exists (
    select 1 from jsonb_array_elements(p.school_list) e
    where public.place_norm(case when jsonb_typeof(e) = 'string' then e #>> '{}' else e->>'name' end)
        = public.place_norm(p_school))
  order by p.display_name
  limit 500
$$;

create or replace function public.katye_counts(p_town text)
returns table (katye text, members bigint) language sql stable security definer
set search_path = public, extensions
as $$
  select mode() within group (order by btrim(katye)), count(*)
  from public.profiles
  where listed and not suspended and hometown = p_town and char_length(btrim(coalesce(katye, ''))) >= 2
  group by public.place_norm(katye)
  order by 2 desc, 1
  limit 200
$$;

create or replace function public.katye_members(p_town text, p_katye text)
returns setof public.profiles language sql stable
set search_path = public, extensions
as $$
  select p.* from public.profiles p
  where not p.suspended and p.hometown = p_town
    and public.place_norm(p.katye) = public.place_norm(p_katye)
  order by p.display_name
  limit 500
$$;

revoke execute on function public.school_counts(), public.school_members(text),
  public.katye_counts(text), public.katye_members(text, text) from public, anon;
grant execute on function public.school_counts(), public.school_members(text),
  public.katye_counts(text), public.katye_members(text, text) to authenticated;

-- =====================================================================
-- People you may know
-- Classmates (same school, overlapping years), same katye, people who
-- listed you as family (or you listed them), same family name and town,
-- and friends of friends. Returns only ids and reasons.
-- =====================================================================
create or replace function public.school_name(e jsonb)
returns text language sql immutable
as $$ select btrim(case when jsonb_typeof(e) = 'string' then e #>> '{}' else coalesce(e->>'name', '') end) $$;

-- "1985–1992" → [1985,1993), "1990" → [1990,1991), anything else → null
create or replace function public.year_range(y text)
returns int4range language sql immutable
as $$
  select int4range(m[1]::int, coalesce(m[2]::int, m[1]::int) + 1)
  from regexp_matches(coalesce(y, ''), '((?:19|20)\d{2})\D*((?:19|20)\d{2})?') m
  where coalesce(m[2]::int, m[1]::int) >= m[1]::int
$$;

create or replace function public.suggestions()
returns table (id uuid, score int, reasons jsonb) language sql stable security definer
set search_path = public, extensions
as $$
  with me as (select * from public.profiles where id = auth.uid()),
  my_schools as (
    select public.place_norm(public.school_name(e)) k, public.school_name(e) nm, public.year_range(e->>'years') yr
    from me, jsonb_array_elements(me.school_list) e where char_length(public.school_name(e)) >= 2),
  my_friends as (
    select case when f.requester = me.id then f.addressee else f.requester end fid
    from public.friendships f, me where f.status = 'accepted' and me.id in (f.requester, f.addressee)),
  cand as (
    select p.* from public.profiles p, me
    where p.id <> me.id and p.listed and not p.suspended
      and not exists (select 1 from public.friendships f where (f.requester = me.id and f.addressee = p.id) or (f.requester = p.id and f.addressee = me.id))
      and not exists (select 1 from public.blocks b where (b.blocker = me.id and b.blocked = p.id) or (b.blocker = p.id and b.blocked = me.id))),
  scored as (
    select c.id, c.created_at, sch.nm school, sch.ov, lf.rel listed_you, yl.rel you_listed, yl.nm you_listed_name, mu.n mutual,
      (c.hometown = me.hometown and char_length(btrim(coalesce(me.katye, ''))) >= 2 and public.place_norm(c.katye) = public.place_norm(me.katye)) same_katye,
      (c.hometown = me.hometown and char_length(btrim(coalesce(me.last_name, ''))) >= 2
        and lower(unaccent(btrim(c.last_name))) = lower(unaccent(btrim(me.last_name)))) same_name,
      c.hometown = me.hometown same_town,
      me.hometown
    from cand c cross join me
    left join lateral (
      select ms.nm, coalesce(ms.yr && public.year_range(e->>'years'), false) ov
      from jsonb_array_elements(c.school_list) e join my_schools ms on ms.k = public.place_norm(public.school_name(e)) and ms.k <> ''
      order by 2 desc limit 1) sch on true
    left join lateral (
      select e->>'relation' rel from jsonb_array_elements(c.family) e
      where public.words_in(lower(unaccent(coalesce(me.first_name, '') || ' ' || coalesce(me.last_name, ''))), lower(unaccent(coalesce(e->>'name', ''))))
        and char_length(btrim(coalesce(me.last_name, ''))) >= 2
      limit 1) lf on true
    left join lateral (
      select e->>'relation' rel, e->>'name' nm from jsonb_array_elements(me.family) e
      where public.words_in(lower(unaccent(coalesce(e->>'name', ''))), c.name_key) and char_length(coalesce(e->>'name', '')) >= 4
      limit 1) yl on true
    left join lateral (
      select count(*)::int n from public.friendships f
      where f.status = 'accepted' and ((f.requester = c.id and f.addressee in (select fid from my_friends))
                                    or (f.addressee = c.id and f.requester in (select fid from my_friends)))) mu on true
  )
  select id,
    (case when listed_you is not null then 8 else 0 end)
    + (case when you_listed is not null then 8 else 0 end)
    + (case when school is not null then 3 + (case when ov then 4 else 0 end) else 0 end)
    + (case when same_katye then 4 else 0 end)
    + (case when same_name then 3 else 0 end)
    + least(coalesce(mutual, 0), 5) * 2
    + (case when same_town then 1 else 0 end) as score,
    to_jsonb(array_remove(array[
      case when listed_you is not null then jsonb_build_object('k', 'listed_you', 'rel', listed_you) end,
      case when you_listed is not null then jsonb_build_object('k', 'you_listed', 'rel', you_listed, 'name', you_listed_name) end,
      case when school is not null then jsonb_build_object('k', case when ov then 'classmate' else 'school' end, 'school', school) end,
      case when same_katye then jsonb_build_object('k', 'katye', 'town', hometown) end,
      case when same_name then jsonb_build_object('k', 'same_name', 'town', hometown) end,
      case when mutual > 0 then jsonb_build_object('k', 'mutual', 'n', mutual) end,
      case when same_town then jsonb_build_object('k', 'town', 'town', hometown) end
    ], null)) as reasons
  from scored
  where (case when listed_you is not null then 8 else 0 end) + (case when you_listed is not null then 8 else 0 end)
      + (case when school is not null then 3 else 0 end) + (case when same_katye then 4 else 0 end)
      + (case when same_name then 3 else 0 end) + coalesce(mutual, 0) > 0
  order by score desc, created_at desc
  limit 12
$$;
revoke execute on function public.suggestions() from public, anon;
grant execute on function public.suggestions() to authenticated;

-- =====================================================================
-- Foto lontan: old photos from home, with tags and comments
-- =====================================================================
insert into storage.buckets (id, name, public, file_size_limit, allowed_mime_types)
values ('photos', 'photos', true, 3145728, array['image/jpeg','image/webp'])
on conflict (id) do nothing;

drop policy if exists "Members add their own old photos" on storage.objects;
create policy "Members add their own old photos" on storage.objects
  for insert to authenticated
  with check (bucket_id = 'photos' and (storage.foldername(name))[1] = auth.uid()::text);
drop policy if exists "Members delete their own old photos" on storage.objects;
create policy "Members delete their own old photos" on storage.objects
  for delete to authenticated
  using (bucket_id = 'photos' and (storage.foldername(name))[1] = auth.uid()::text);
drop policy if exists "Members read their own old photo files" on storage.objects;
create policy "Members read their own old photo files" on storage.objects
  for select to authenticated
  using (bucket_id = 'photos' and (storage.foldername(name))[1] = auth.uid()::text);

create table if not exists public.photos (
  id         uuid primary key default gen_random_uuid(),
  owner      uuid not null default auth.uid() references auth.users(id) on delete cascade,
  path       text not null check (char_length(path) <= 200),
  url        text not null check (char_length(url) <= 500),
  caption    text check (char_length(caption) <= 500),
  town       text check (char_length(town) <= 80),
  year       text check (char_length(year) <= 20),
  hidden     boolean not null default false,
  created_at timestamptz not null default now()
);
create index if not exists photos_recent on public.photos (created_at desc);

create or replace function public.photos_guard()
returns trigger language plpgsql
set search_path = public
as $$
begin
  if tg_op = 'INSERT' then
    if (select count(*) from public.photos where owner = new.owner) >= 300 then
      raise exception 'Too many photos' using errcode = '54000';
    end if;
    new.hidden := false;
  elsif not public.is_admin() then
    new.hidden := old.hidden;
  end if;
  if tg_op = 'UPDATE' then new.owner := old.owner; new.path := old.path; new.url := old.url; end if;
  return new;
end $$;
drop trigger if exists photos_guard on public.photos;
create trigger photos_guard before insert or update on public.photos
  for each row execute function public.photos_guard();

alter table public.photos enable row level security;
drop policy if exists "Members see photos" on public.photos;
create policy "Members see photos" on public.photos for select to authenticated
  using (owner = auth.uid() or public.is_admin()
         or (not hidden and not exists (select 1 from public.profiles p where p.id = owner and p.suspended)));
drop policy if exists "Members add photos" on public.photos;
create policy "Members add photos" on public.photos for insert to authenticated
  with check (owner = auth.uid() and split_part(path, '/', 1) = auth.uid()::text
              and not exists (select 1 from public.profiles p where p.id = auth.uid() and p.suspended));
drop policy if exists "Owners and admins edit photos" on public.photos;
create policy "Owners and admins edit photos" on public.photos for update to authenticated
  using (owner = auth.uid() or public.is_admin()) with check (owner = auth.uid() or public.is_admin());
drop policy if exists "Owners and admins delete photos" on public.photos;
create policy "Owners and admins delete photos" on public.photos for delete to authenticated
  using (owner = auth.uid() or public.is_admin());

create table if not exists public.photo_tags (
  id         uuid primary key default gen_random_uuid(),
  photo_id   uuid not null references public.photos(id) on delete cascade,
  member     uuid references public.profiles(id) on delete cascade,
  name       text not null default '' check (char_length(name) <= 80),
  added_by   uuid not null default auth.uid() references auth.users(id) on delete cascade,
  seen       boolean not null default false,
  created_at timestamptz not null default now()
);
create unique index if not exists photo_tags_member on public.photo_tags (photo_id, member) where member is not null;
create index if not exists photo_tags_for on public.photo_tags (member, seen);

create or replace function public.photo_tags_guard()
returns trigger language plpgsql
set search_path = public
as $$
begin
  if new.member is not null then
    select display_name into new.name from public.profiles where id = new.member;
  end if;
  new.name := btrim(coalesce(new.name, ''));
  if char_length(new.name) < 2 then raise exception 'Name needed' using errcode = '22023'; end if;
  if (select count(*) from public.photo_tags where photo_id = new.photo_id) >= 40 then
    raise exception 'Too many tags' using errcode = '54000';
  end if;
  new.seen := (new.member is null or new.member = new.added_by);
  return new;
end $$;
drop trigger if exists photo_tags_guard on public.photo_tags;
create trigger photo_tags_guard before insert on public.photo_tags
  for each row execute function public.photo_tags_guard();

alter table public.photo_tags enable row level security;
drop policy if exists "Members see tags" on public.photo_tags;
create policy "Members see tags" on public.photo_tags for select to authenticated
  using (exists (select 1 from public.photos ph where ph.id = photo_id));
drop policy if exists "Members tag photos" on public.photo_tags;
create policy "Members tag photos" on public.photo_tags for insert to authenticated
  with check (added_by = auth.uid()
              and exists (select 1 from public.photos ph where ph.id = photo_id)
              and (member is null or not (public.has_blocked(member, auth.uid()) or public.has_blocked(auth.uid(), member))));
drop policy if exists "Tagged members mark seen" on public.photo_tags;
create policy "Tagged members mark seen" on public.photo_tags for update to authenticated
  using (member = auth.uid()) with check (member = auth.uid());
drop policy if exists "Remove a tag" on public.photo_tags;
create policy "Remove a tag" on public.photo_tags for delete to authenticated
  using (added_by = auth.uid() or member = auth.uid() or public.is_admin()
         or exists (select 1 from public.photos ph where ph.id = photo_id and ph.owner = auth.uid()));
revoke update on public.photo_tags from anon, authenticated;
grant update (seen) on public.photo_tags to authenticated;

create table if not exists public.photo_comments (
  id         uuid primary key default gen_random_uuid(),
  photo_id   uuid not null references public.photos(id) on delete cascade,
  author     uuid not null default auth.uid() references auth.users(id) on delete cascade,
  body       text not null check (char_length(btrim(body)) between 1 and 1000),
  created_at timestamptz not null default now()
);
create index if not exists photo_comments_photo on public.photo_comments (photo_id, created_at);
alter table public.photo_comments enable row level security;
drop policy if exists "Members read comments" on public.photo_comments;
create policy "Members read comments" on public.photo_comments for select to authenticated
  using (exists (select 1 from public.photos ph where ph.id = photo_id)
         and not exists (select 1 from public.profiles p where p.id = author and p.suspended));
drop policy if exists "Members comment" on public.photo_comments;
create policy "Members comment" on public.photo_comments for insert to authenticated
  with check (author = auth.uid()
              and exists (select 1 from public.photos ph where ph.id = photo_id
                          and not public.has_blocked(ph.owner, auth.uid()))
              and not exists (select 1 from public.profiles p where p.id = auth.uid() and p.suspended));
drop policy if exists "Remove a comment" on public.photo_comments;
create policy "Remove a comment" on public.photo_comments for delete to authenticated
  using (author = auth.uid() or public.is_admin()
         or exists (select 1 from public.photos ph where ph.id = photo_id and ph.owner = auth.uid()));
revoke update on public.photo_comments from anon, authenticated;

-- Reports can point at a photo
alter table public.member_reports add column if not exists photo_id uuid references public.photos(id) on delete set null;

-- Admin numbers, now with photos
create or replace function public.admin_stats()
returns json language sql stable security definer
set search_path = public
as $$
  select case when public.is_admin() then json_build_object(
    'members',        (select count(*) from public.profiles),
    'new_this_week',  (select count(*) from public.profiles where created_at > now() - interval '7 days'),
    'hidden',         (select count(*) from public.profiles where suspended),
    'open_reports',   (select count(*) from public.member_reports where status = 'open'),
    'messages',       (select count(*) from public.messages),
    'photos',         (select count(*) from public.photos),
    'alerts',         (select count(*) from public.search_alerts)
  ) end
$$;
grant execute on function public.admin_stats() to authenticated;

-- =====================================================================
-- Family tree: two members confirm they are related
-- "relation" is what the relative is to the requester (e.g. 'mother').
-- "relation_back" is what the requester is to the relative, chosen when
-- the relative accepts.
-- =====================================================================
create table if not exists public.family_links (
  id            uuid primary key default gen_random_uuid(),
  requester     uuid not null default auth.uid() references auth.users(id) on delete cascade,
  relative      uuid not null references auth.users(id) on delete cascade,
  relation      text not null check (relation in ('mother','father','brother','sister','son','daughter','spouse','grandparent','grandchild','aunt','uncle','niece','nephew','cousin','other')),
  relation_back text check (relation_back in ('mother','father','brother','sister','son','daughter','spouse','grandparent','grandchild','aunt','uncle','niece','nephew','cousin','other')),
  status        text not null default 'pending' check (status in ('pending','accepted')),
  created_at    timestamptz not null default now(),
  check (requester <> relative)
);
create unique index if not exists family_links_pair on public.family_links (least(requester, relative), greatest(requester, relative));
create index if not exists family_links_relative on public.family_links (relative, status);

create or replace function public.family_links_guard()
returns trigger language plpgsql
set search_path = public
as $$
begin
  if tg_op = 'INSERT' then
    if (select count(*) from public.family_links where requester = new.requester) >= 100 then
      raise exception 'Too many family links' using errcode = '54000';
    end if;
    new.status := 'pending'; new.relation_back := null;
  else
    new.requester := old.requester; new.relative := old.relative; new.relation := old.relation; new.created_at := old.created_at;
    if new.status = 'accepted' and new.relation_back is null then
      raise exception 'Choose how you are related' using errcode = '22023';
    end if;
  end if;
  return new;
end $$;
drop trigger if exists family_links_guard on public.family_links;
create trigger family_links_guard before insert or update on public.family_links
  for each row execute function public.family_links_guard();

alter table public.family_links enable row level security;
drop policy if exists "See family links" on public.family_links;
create policy "See family links" on public.family_links for select to authenticated
  using (status = 'accepted' or requester = auth.uid() or relative = auth.uid());
drop policy if exists "Ask a relative to link" on public.family_links;
create policy "Ask a relative to link" on public.family_links for insert to authenticated
  with check (requester = auth.uid()
              and not public.has_blocked(relative, auth.uid()) and not public.has_blocked(auth.uid(), relative)
              and not exists (select 1 from public.profiles p where p.id = auth.uid() and p.suspended));
drop policy if exists "Relative accepts" on public.family_links;
create policy "Relative accepts" on public.family_links for update to authenticated
  using (relative = auth.uid() and status = 'pending')
  with check (relative = auth.uid());
drop policy if exists "Either side removes the link" on public.family_links;
create policy "Either side removes the link" on public.family_links for delete to authenticated
  using (requester = auth.uid() or relative = auth.uid());


-- Admin numbers (latest version)
create or replace function public.admin_stats()
returns json language sql stable security definer
set search_path = public
as $$
  select case when public.is_admin() then json_build_object(
    'members',        (select count(*) from public.profiles),
    'new_this_week',  (select count(*) from public.profiles where created_at > now() - interval '7 days'),
    'hidden',         (select count(*) from public.profiles where suspended),
    'open_reports',   (select count(*) from public.member_reports where status = 'open'),
    'messages',       (select count(*) from public.messages),
    'photos',         (select count(*) from public.photos),
    'alerts',         (select count(*) from public.search_alerts),
    'family_links',   (select count(*) from public.family_links where status = 'accepted')
  ) end
$$;
grant execute on function public.admin_stats() to authenticated;

-- People you may know (latest version: also skips relatives you've already linked)
create or replace function public.suggestions()
returns table (id uuid, score int, reasons jsonb) language sql stable security definer
set search_path = public, extensions
as $$
  with me as (select * from public.profiles where id = auth.uid()),
  my_schools as (
    select public.place_norm(public.school_name(e)) k, public.school_name(e) nm, public.year_range(e->>'years') yr
    from me, jsonb_array_elements(me.school_list) e where char_length(public.school_name(e)) >= 2),
  my_friends as (
    select case when f.requester = me.id then f.addressee else f.requester end fid
    from public.friendships f, me where f.status = 'accepted' and me.id in (f.requester, f.addressee)),
  cand as (
    select p.* from public.profiles p, me
    where p.id <> me.id and p.listed and not p.suspended
      and not exists (select 1 from public.friendships f where (f.requester = me.id and f.addressee = p.id) or (f.requester = p.id and f.addressee = me.id))
      and not exists (select 1 from public.blocks b where (b.blocker = me.id and b.blocked = p.id) or (b.blocker = p.id and b.blocked = me.id))
      and not exists (select 1 from public.family_links fl where (fl.requester = me.id and fl.relative = p.id) or (fl.requester = p.id and fl.relative = me.id))),
  scored as (
    select c.id, c.created_at, sch.nm school, sch.ov, lf.rel listed_you, yl.rel you_listed, yl.nm you_listed_name, mu.n mutual,
      (c.hometown = me.hometown and char_length(btrim(coalesce(me.katye, ''))) >= 2 and public.place_norm(c.katye) = public.place_norm(me.katye)) same_katye,
      (c.hometown = me.hometown and char_length(btrim(coalesce(me.last_name, ''))) >= 2
        and lower(unaccent(btrim(c.last_name))) = lower(unaccent(btrim(me.last_name)))) same_name,
      c.hometown = me.hometown same_town,
      me.hometown
    from cand c cross join me
    left join lateral (
      select ms.nm, coalesce(ms.yr && public.year_range(e->>'years'), false) ov
      from jsonb_array_elements(c.school_list) e join my_schools ms on ms.k = public.place_norm(public.school_name(e)) and ms.k <> ''
      order by 2 desc limit 1) sch on true
    left join lateral (
      select e->>'relation' rel from jsonb_array_elements(c.family) e
      where public.words_in(lower(unaccent(coalesce(me.first_name, '') || ' ' || coalesce(me.last_name, ''))), lower(unaccent(coalesce(e->>'name', ''))))
        and char_length(btrim(coalesce(me.last_name, ''))) >= 2
      limit 1) lf on true
    left join lateral (
      select e->>'relation' rel, e->>'name' nm from jsonb_array_elements(me.family) e
      where public.words_in(lower(unaccent(coalesce(e->>'name', ''))), c.name_key) and char_length(coalesce(e->>'name', '')) >= 4
      limit 1) yl on true
    left join lateral (
      select count(*)::int n from public.friendships f
      where f.status = 'accepted' and ((f.requester = c.id and f.addressee in (select fid from my_friends))
                                    or (f.addressee = c.id and f.requester in (select fid from my_friends)))) mu on true
  )
  select id,
    (case when listed_you is not null then 8 else 0 end)
    + (case when you_listed is not null then 8 else 0 end)
    + (case when school is not null then 3 + (case when ov then 4 else 0 end) else 0 end)
    + (case when same_katye then 4 else 0 end)
    + (case when same_name then 3 else 0 end)
    + least(coalesce(mutual, 0), 5) * 2
    + (case when same_town then 1 else 0 end) as score,
    to_jsonb(array_remove(array[
      case when listed_you is not null then jsonb_build_object('k', 'listed_you', 'rel', listed_you) end,
      case when you_listed is not null then jsonb_build_object('k', 'you_listed', 'rel', you_listed, 'name', you_listed_name) end,
      case when school is not null then jsonb_build_object('k', case when ov then 'classmate' else 'school' end, 'school', school) end,
      case when same_katye then jsonb_build_object('k', 'katye', 'town', hometown) end,
      case when same_name then jsonb_build_object('k', 'same_name', 'town', hometown) end,
      case when mutual > 0 then jsonb_build_object('k', 'mutual', 'n', mutual) end,
      case when same_town then jsonb_build_object('k', 'town', 'town', hometown) end
    ], null)) as reasons
  from scored
  where (case when listed_you is not null then 8 else 0 end) + (case when you_listed is not null then 8 else 0 end)
      + (case when school is not null then 3 else 0 end) + (case when same_katye then 4 else 0 end)
      + (case when same_name then 3 else 0 end) + coalesce(mutual, 0) > 0
  order by score desc, created_at desc
  limit 12
$$;
revoke execute on function public.suggestions() from public, anon;
grant execute on function public.suggestions() to authenticated;
