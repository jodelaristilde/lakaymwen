-- Lakaymwen: email members when a name they're watching joins.
-- Run this AFTER supabase-setup.sql, and only once you have a Resend account
-- with your domain verified (see LAUNCH-GUIDE.md, Step 9).
--
-- Before running it, store two secrets (SQL Editor, one time — use your own values):
--   select vault.create_secret('re_your_resend_api_key', 'resend_api_key');
--   select vault.create_secret('https://lakaymwen.com', 'site_url');
-- To turn emails off later, delete the 'resend_api_key' secret (Vault page).

create extension if not exists pg_net;

create or replace function public.html_escape(t text)
returns text language sql immutable
as $$ select replace(replace(replace(replace(coalesce(t, ''), '&', '&amp;'), '<', '&lt;'), '>', '&gt;'), '"', '&quot;') $$;

create or replace function public.send_alert_email(p_owner uuid, p_query text, p_name text, p_profile uuid, p_via text, p_relation text)
returns void language plpgsql security definer
set search_path = public
as $$
declare
  api_key text; site text; addr text; lang text; subj text; body text; link text;
begin
  select decrypted_secret into api_key from vault.decrypted_secrets where name = 'resend_api_key';
  if api_key is null then return; end if;
  select decrypted_secret into site from vault.decrypted_secrets where name = 'site_url';
  site := coalesce(nullif(site, ''), 'https://lakaymwen.com');
  select email, coalesce(raw_user_meta_data->>'lang', 'en') into addr, lang from auth.users where id = p_owner;
  if addr is null then return; end if;
  link := site || '/#member-' || p_profile;

  if lang = 'ht' then
    subj := 'Lakaymwen: nou jwenn yon moun pou "' || p_query || '"';
    body := '<h2 style="font-family:Arial">Bon nouvèl!</h2><p style="font-family:Arial;font-size:16px">'
      || case when p_via = 'name'
           then '<b>' || html_escape(p_name) || '</b> fèk antre sou Lakaymwen. Non an koresponn ak sa w ap chèche a: <b>' || html_escape(p_query) || '</b>.'
           else '<b>' || html_escape(p_name) || '</b> mete <b>' || html_escape(p_query) || '</b> nan fanmi li.' end
      || '</p><p><a href="' || link || '" style="background:#e8193c;color:#fff;padding:12px 20px;border-radius:8px;text-decoration:none;font-family:Arial;font-weight:bold">Gade pwofil la</a></p>'
      || '<p style="font-family:Arial;color:#666;font-size:13px">Ou resevwa imèl sa a paske ou te mande yon alèt sou Lakaymwen. Ou ka retire alèt la nan "Alèt mwen".</p>';
  elsif lang = 'fr' then
    subj := 'Lakaymwen : nous avons trouvé quelqu''un pour « ' || p_query || ' »';
    body := '<h2 style="font-family:Arial">Bonne nouvelle !</h2><p style="font-family:Arial;font-size:16px">'
      || case when p_via = 'name'
           then '<b>' || html_escape(p_name) || '</b> vient de rejoindre Lakaymwen et correspond au nom que vous suivez : <b>' || html_escape(p_query) || '</b>.'
           else '<b>' || html_escape(p_name) || '</b> a ajouté <b>' || html_escape(p_query) || '</b> à sa famille'
                || coalesce(' (' || html_escape(p_relation) || ')', '') || '.' end
      || '</p><p><a href="' || link || '" style="background:#e8193c;color:#fff;padding:12px 20px;border-radius:8px;text-decoration:none;font-family:Arial;font-weight:bold">Voir le profil</a></p>'
      || '<p style="font-family:Arial;color:#666;font-size:13px">Vous recevez ce courriel parce que vous avez créé une alerte sur Lakaymwen. Vous pouvez la retirer dans « Mes alertes ».</p>';
  else
    subj := 'Lakaymwen: we found a match for "' || p_query || '"';
    body := '<h2 style="font-family:Arial">Good news!</h2><p style="font-family:Arial;font-size:16px">'
      || case when p_via = 'name'
           then '<b>' || html_escape(p_name) || '</b> just joined Lakaymwen and matches the name you are watching: <b>' || html_escape(p_query) || '</b>.'
           else '<b>' || html_escape(p_name) || '</b> listed <b>' || html_escape(p_query) || '</b> as family'
                || coalesce(' (' || html_escape(p_relation) || ')', '') || '.' end
      || '</p><p><a href="' || link || '" style="background:#e8193c;color:#fff;padding:12px 20px;border-radius:8px;text-decoration:none;font-family:Arial;font-weight:bold">See the profile</a></p>'
      || '<p style="font-family:Arial;color:#666;font-size:13px">You got this email because you set an alert on Lakaymwen. You can remove it under "My alerts".</p>';
  end if;

  perform net.http_post(
    url := 'https://api.resend.com/emails',
    headers := jsonb_build_object('Authorization', 'Bearer ' || api_key, 'Content-Type', 'application/json'),
    body := jsonb_build_object('from', 'Lakaymwen <alerts@' || regexp_replace(site, '^https?://(www\.)?([^/]+).*$', '\2') || '>',
                               'to', addr, 'subject', subj, 'html', body));
end $$;
revoke execute on function public.send_alert_email(uuid, text, text, uuid, text, text) from public, anon, authenticated;
