# Lakaymwen.com

Helping Haitians everywhere find family and friends, in Haiti and across the diaspora. Since 2004.

A static website (HTML, CSS, JavaScript) backed by [Supabase](https://supabase.com) for members, photos and private messages. Hosted on [Vercel](https://vercel.com).

**To set it up or make changes, read [LAUNCH-GUIDE.md](LAUNCH-GUIDE.md).**

| File | What it is |
|---|---|
| `index.html` | The website page |
| `styles.css` | Colors and layout |
| `app.js` | Registration, search, profiles, family tree, photos, alerts, messages, admin |
| `i18n.js` | All the words on the site, in Kreyòl, French and English |
| `towns.js` | The 151 towns from the original site |
| `geo.js` | Countries, and the states / provinces for each |
| `depts.js` | Haiti's 10 departments and their towns (for the map) |
| `haiti-map.svg` | The clickable Haiti map |
| `config.js` | Your Supabase keys |
| `manifest.webmanifest`, `sw.js`, `icons/` | Lets members install the site on their phone like an app |
| `vercel.json` | A small Vercel setting for the phone app part |
| `supabase-setup.sql` | Creates the database and its privacy rules |
| `alert-emails.sql` | Optional: emails members when a name they're watching joins |
