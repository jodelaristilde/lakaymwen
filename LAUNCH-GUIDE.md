# Lakaymwen.com: Launch Guide

This folder is your whole website. You'll set up three free accounts:

- **Supabase** keeps the members, profiles, photos and messages.
- **GitHub** stores your website's files.
- **Vercel** puts the website on the internet, and updates it every time you change a file on GitHub.

Plan on about 30 minutes. You don't need to write any code.

---

## What's in this folder

| File | What it is |
|---|---|
| `index.html` | The website page |
| `styles.css` | Colors and layout |
| `app.js` | Makes registration, search, profiles, messages and the admin page work |
| `i18n.js` | **All the words on the site, in English and Kreyòl.** Edit this to change any text. |
| `towns.js` | The town list from your original site (151 towns) |
| `depts.js` | Which department each town is in |
| `geo.js` | Countries and states for the "Where do you live now" drop-downs |
| `haiti-map.svg` | The clickable Haiti map |
| `config.js` | Where you paste your Supabase keys (step 3) |
| `supabase-setup.sql` | Creates the database and its privacy rules (step 2) |
| `alert-emails.sql` | Optional: emails members when a name they're watching joins (step 9) |
| `manifest.webmanifest`, `sw.js`, `icons/` | Let members install Lakaymwen on their phone like an app |
| `vercel.json` | A small Vercel setting for the app part |

---

## Step 1: Create your Supabase project

1. Go to **supabase.com** and click **Start your project**. Sign up with your email.
2. Click **New project**.
   - Name: `lakaymwen`
   - Database password: make a strong one and **save it somewhere safe**
   - Region: **East US** (closest to Florida and the Caribbean)
3. Click **Create new project** and wait a minute or two while it sets up.

## Step 2: Create the database

1. In the left menu, click **SQL Editor**.
2. Click **New query**.
3. Open `supabase-setup.sql` from this folder in Notepad (Windows) or TextEdit (Mac), select everything, copy it, and paste it into the box.
4. Click **Run**. You should see **"Success. No rows returned."**

It's safe to run this again later. It won't erase anything. **Whenever I send you a new `supabase-setup.sql`, run it again the same way** so the database has the newest features.

## Step 3: Connect the website to your database

1. In Supabase, click the **gear icon (Project Settings)**, then **API** (it may be called **Data API** or **API Keys**).
2. Copy the **Project URL**. It looks like `https://abcdefgh.supabase.co`.
3. Copy the **anon / public** key. It's a long line of letters and numbers.
4. Open `config.js` in Notepad or TextEdit and paste them in place of the placeholder text, keeping the quote marks:

```js
SUPABASE_URL: "https://abcdefgh.supabase.co",
SUPABASE_ANON_KEY: "eyJhbGciOi...the long key...",
```

5. Save the file.

> Both of these are meant to be public, so it's fine that they're in the website. Never paste the **service_role** key anywhere; that one is secret.

## Step 4: Put the files on GitHub

1. Go to **github.com** and create a free account.
2. Click the **+** at the top right, then **New repository**.
   - Repository name: `lakaymwen`
   - Choose **Public** or **Private** (either works with Vercel).
   - Click **Create repository**.
3. On the next page, click **uploading an existing file**.
4. Drag **all the website files** onto the page (`index.html`, `styles.css`, `app.js`, `config.js`, `i18n.js`, `towns.js`, `depts.js`, `geo.js`, `haiti-map.svg`, `manifest.webmanifest`, `sw.js`, `vercel.json`, and the whole `icons` folder). You can drag the `icons` folder in as a folder.
5. Click **Commit changes**.

> Make sure you pasted your Supabase keys into `config.js` first (step 3). Those two keys are meant to be public, so it's safe for them to be on GitHub. Never upload the **service_role** key.

## Step 5: Put the site online with Vercel

1. Go to **vercel.com** and click **Sign Up**, then choose **Continue with GitHub**.
2. Click **Add New… → Project**.
3. Find your `lakaymwen` repository and click **Import**.
4. Leave every setting as it is (Framework Preset: **Other**) and click **Deploy**.
5. In under a minute you get a web address like `https://lakaymwen.vercel.app`. That's your live site.

**To update the site later,** change or upload the file on GitHub and click **Commit changes**. Vercel puts the new version online automatically within a minute.

## Step 6: Set up the email codes (required)

Members sign up with their email, and Supabase emails them a **6-digit code** to confirm it. "Forgot password" works the same way.

**6a. Turn on email confirmation**
1. In Supabase, go to **Authentication → Sign In / Providers → Email**.
2. Make sure **Email** is on and **Confirm email** is **on**, then click **Save**.

**6b. Put the code in the emails**
Go to **Authentication → Emails** (called **Email Templates** on some screens).
1. Open **Confirm signup** and replace the message with:
   ```html
   <h2>Welcome to Lakaymwen!</h2>
   <p>Your code is: <strong style="font-size:24px">{{ .Token }}</strong></p>
   <p>Type this code on the Register page to confirm your email.</p>
   ```
2. Open **Reset password** and replace the message with:
   ```html
   <h2>Reset your Lakaymwen password</h2>
   <p>Your code is: <strong style="font-size:24px">{{ .Token }}</strong></p>
   <p>Type this code on the site, then choose a new password.</p>
   ```
3. Click **Save** on each.

**6c. Use a real email sender (needed before launch)**
Supabase's built-in email only sends a few emails per hour. That's fine for testing, but not for real members.
1. Sign up at **resend.com** (free for up to 3,000 emails a month) and add your domain.
2. In Supabase, go to **Authentication → Emails → SMTP Settings**, turn on **Custom SMTP**, and enter the details Resend gives you.

## Step 7: Test it yourself

1. Open your site and click anywhere on the map. The **"Where are you from in Haiti?"** page opens.
2. Click your town. Fill in your username, email, password and name, then click **Create my account**.
3. Check your email for the 6-digit code, type it in, and you're a member.
4. Log out, then log back in with the **Member Login** box using your email and password.
5. Register a second test account (or ask a friend), add each other as friends, and send a message to check it arrives.

## Step 8: Make yourself the admin

The **Admin** page lets you see reports, hide bad accounts and watch how many members you have. Only admins see it.

1. Register on your own site first (step 7), with your own email.
2. In Supabase, open **SQL Editor → New query**, paste this (with your email), and click **Run**:
   ```sql
   insert into public.admins (user_id)
   select id from auth.users where email = 'jodel1112@gmail.com';
   ```
3. Log out and back in. A red **Admin** button appears in the left menu.

To add a helper as a second admin, run the same line with their email. To remove one, run `delete from public.admins where user_id = (select id from auth.users where email = 'their@email.com');`

## Step 9: Turn on alert emails (do this after Step 6c)

Members can save a name under **My alerts**. When that person joins, or a member lists them as family, the saver sees it on the site right away, with a red number on **My alerts**. This step also sends them an **email**, which is what brings people back.

You need the Resend account from Step 6c, with **lakaymwen.com** verified as a domain (emails come from `alerts@lakaymwen.com`).

1. In Resend, go to **API Keys → Create API Key**, choose **Sending access**, and copy the key (it starts with `re_`).
2. In Supabase, open **SQL Editor → New query**, paste these two lines with your key and your site address, and click **Run**:
   ```sql
   select vault.create_secret('re_paste_your_key_here', 'resend_api_key');
   select vault.create_secret('https://lakaymwen.com', 'site_url');
   ```
3. Open a **New query**, paste everything from `alert-emails.sql`, and click **Run**.
4. To test it, save an alert for a made-up name, then register a second account with that name. The email should arrive within a minute.

Members get the email in Kreyòl or English, whichever language they last used on the site. To stop all alert emails, go to **Project Settings → Vault** and delete `resend_api_key`. Alerts keep working on the site.

---

## Before you announce it

### Get lakaymwen.com back
1. Check whether it's available at **Namecheap** or **GoDaddy** and buy it (about $10–15 a year).
2. In Vercel, open your project and go to **Settings → Domains**, type `lakaymwen.com` and click **Add**. Vercel shows you the two records to enter at Namecheap or GoDaddy, and sets up the secure **https** lock for free.
3. In Supabase, go to **Authentication → URL Configuration** and set **Site URL** to `https://lakaymwen.com`.

---

## Running the site day to day

- **Reports:** When a member reports someone, it shows on your **Admin** page with the reason. Click **Hide member** to take the account off the site right away (they disappear from search, the home page, town lists and can't send messages), or **Close report** if it's nothing. Hidden members are listed at the bottom of the Admin page with a **Restore** button.
- **Block:** Members can block anyone themselves. A blocked person can't message them, and they no longer see each other in lists.
- **Check the Admin page a few times a week.** The "open reports" number tells you if anything is waiting. Act fast on scams (people asking for money) and anything involving someone under 18.
- **Forgot password:** Members reset it themselves with **Forgot password?**: they get a 6-digit code by email and choose a new password.
- **Profile photos:** Members' photos are kept in Supabase under **Storage → avatars**, one folder per member. The setup file creates this for you. To take down an inappropriate photo, open the member's folder, delete `avatar.jpg`, then clear their `photo_url` in **Table Editor → profiles**.
- **Removing a member for good:** Hiding is usually enough. To erase an account completely, go to **Authentication → Users**, find them, and delete them. Their profile, messages and friends are removed too.
- **Members deleting themselves:** Members can delete their own account from **My account → Delete my account**. Everything of theirs is erased, including their photo.
- **Founding members:** People who were members before 2008 can tick **"I was a member of the old Lakaymwen"** when they register and give their old username. They get a gold ★ Founding member badge. You can check it in **Table Editor → profiles** (`founding`, `old_username`) and untick it if someone wasn't really a member.
- **Changing text:** Edit `i18n.js`. Every sentence is there in English (`en`) and Kreyòl (`ht`). Then commit the change on GitHub; Vercel updates the site by itself.
- **Adding a town:** Add it to the list in `towns.js` (and to its department in `depts.js`), then commit on GitHub.
- **Contact email in the footer:** Change `CONTACT_EMAIL` in `config.js`.
- **Old photos (Foto lontan):** Photos are kept in Supabase under **Storage → photos**, and the setup file creates that folder. Reported photos show on your **Admin** page with a **Hide photo** button. You can also hide or restore any photo from its own page while logged in as admin.
- **Family tree:** When a member's family list has a name that matches another member, the site asks "Is this your brother Paul Member?". Members can also tap **We're family** on anyone's profile. The other person confirms and says how they're related, and both appear in each other's **Family tree**. Either one can remove the link.
- **People you may know:** This runs by itself. It suggests classmates (same school, overlapping years), people from the same katye, people who listed each other as family, and friends of friends.
- **Languages:** The site speaks Kreyòl, French and English (buttons KR / FR / EN at the top). French is chosen automatically for visitors whose phone is set to French. All the words are in `i18n.js`.
- **Phone app:** On Android, members see an **Install the app** button. On iPhone, the site shows how to add it with Share → Add to Home Screen. Nothing to set up; it works once the site is on Vercel.
- **School pages:** Every school members enter gets its own page under **Schools**. Different spellings like "Lycee Petion" and "Lycée Pétion" are grouped together automatically. If someone types a school name very differently, the member can fix it under **My account**.

## How members' privacy is protected

These rules are built into the database itself, so they hold even if someone tries to get around the website:

- Passwords are stored securely by Supabase and are never visible, not even to you.
- Email addresses are never shown on the site.
- Only signed-in members can see profiles, and members can hide themselves from search.
- Messages can be read only by the two people in the conversation.
- Hidden (suspended) members and people who blocked you can't receive your messages or friend requests.
- Members must confirm they are 18 or older and agree to the privacy rules (linked in the footer) to register.
- The privacy page is a plain-language starting point, not legal advice. If the site grows large, have a lawyer look at it.

## Getting the word out

- Share the site on **WhatsApp** and **Facebook**, and use **Tell a friend** in the menu.
- Every school page, katye page and profile has an **Invite on WhatsApp** button with a ready-made message. Start with your own school: open its page and send the invite to your old classmates' group.
- Contact Haitian radio shows in Miami, Boston, New York and Montréal, plus hometown associations and churches.
- Post in Facebook groups for each town ("Moun Jacmel", "Moun Okap", and so on).
