# Atlas KPI Review — version 3

Weekly KRA & KPI review for the Atlas Maharani Group Monday HOD meeting.

- **One KPI at a time.** A HOD sees the list of pending KPIs, picks one, enters the result as a **count or %** (e.g. `1420`, `92`, or `46/48`), adds the reason / proof / next step, and taps **Check with Claude**. Claude checks *that* KPI, **reads the attached photos and PDFs**, counts what the proof shows and says if it matches, and asks its questions in Malayalam. After answering, **Finish** — and the next pending KPI opens. It can be done over several days; everything saves as you go. When every KPI is finished the report is submitted automatically.
- **Same on WhatsApp:** `START` shows the pending list, send a number to pick a KPI, then the figure, proof, reason and next step; Claude's questions follow for that KPI.
- **MD review by Claude is in Malayalam.**
- **Colourful PPT** with charts, a department scoreboard, KPI tiles, the HODs' **proof photos inside the slides** and links to their files. Every HOD can make **their own department's PPT** (button *My PPT*).
- **Saturday:** morning message to each HOD with the number of KPIs still pending (HODs who are done get nothing), 1:30 PM reminder, 5 PM PPT to the admin with **HOD-wise done / not done**.
- **HODs see only their own department** — enforced in the database, not just hidden on screen.
- **Login with username + password.** No email anywhere — not for HODs, not for the admin. The admin creates each login. The mobile number is only for WhatsApp.
- **WhatsApp chatbot:** on Saturday the bot asks each HOD their KPIs one by one, records every answer in the app, then asks Claude's clarification questions **in Malayalam** and records those answers too.
- **Saturday 5 PM:** the PowerPoint (same format as the app's *Make PPT*) is built automatically and sent on WhatsApp.
- **Fits every screen:** phone, tablet, laptop and PC.
- **Status is locked.** Green / Amber / Red always comes from the achievement % (95%+ Green, 80–94% Amber, below 80% Red). Nobody can pick it by hand — not in the app, not on WhatsApp, not by editing the database. KPIs without a number are reported as **% done**.
- **Proof on every KPI:** the HOD can attach a **voice note** (recorded in the app), a **photo** or a **file** (PDF, Excel…) as the reason — in the app, or by sending it on WhatsApp. Files are private: only that department, the admin and viewers can open them.
- **Next step on every KPI:** Amber/Red KPIs can't be submitted without a reason (text or attachment) and a next step (what, who, by when). The bot asks both.

## What's inside

| Part | Technology | Where |
|---|---|---|
| Web app | HTML, CSS, JavaScript, built with **Vite** | `index.html`, `src/` |
| Shared logic (app + server) | scoring, dates, PowerPoint layout | `supabase/functions/_shared/core.js`, `ppt-builder.js` |
| Database, login, live updates | **Supabase** (Postgres + Auth + Realtime + Storage) | `supabase/schema.sql`, `seed.sql` |
| Claude | **Claude API** from Supabase Edge Functions | `ai-check`, `ai-review` |
| WhatsApp bot | **WhatsApp Business Platform (Meta Cloud API)** | `whatsapp` function |
| Saturday schedule | **pg_cron** inside Supabase | `supabase/cron.sql`, `weekly-jobs` function |
| User logins | Supabase Auth admin API | `admin-users` function |
| Paste-ready functions | one file each, for the Supabase website editor | `supabase/dashboard-paste/` |

### Roles

| Role | Sees | Can do |
|---|---|---|
| **Admin** (MD office) | Everything | Edit KRA/KPI, create logins, settings, run MD review, PPT |
| **HOD** | **Only their own department** | Submit results (app or WhatsApp), answer Claude, update actions, propose KPIs |
| **Viewer** | Everything | Read only |
| **Pending** | Nothing | — |

### Saturday timeline (India time)

| Time | What happens |
|---|---|
| 9:30 AM | Bot sends every HOD the kickoff message on WhatsApp |
| Any time | HOD replies START and answers each KPI; then Claude's Malayalam questions |
| 1:30 PM | Reminder (with pending count) to HODs who haven't finished |
| 4:30 PM | Claude writes the MD office review (Malayalam) |
| 5:00 PM | PowerPoint built (with proof photos), stored, and sent to the numbers in **Settings** with **HOD-wise done / not done** |

### WhatsApp commands

HOD: `START` → pending list → send a number to pick a KPI → send the figure (count, %, or `46/48`) → for Amber/Red the reason and next step (text, **photo, PDF or voice note**) → Claude's questions for that KPI → done, next KPI.
Commands: `MENU` pending list · `ALL` every KPI (to change a finished one) · `SKIP` this KPI later (or an optional question) · `BACK` previous · `STATUS` progress · `STOP` pause, continue later with `START` · `HELP`
Admin: `PPT` get this week's deck now · `STATUS` who has submitted

---

## Upgrading from version 2.2 to 3 (one KPI at a time)

1. Upload the new `src/`, `supabase/` and `index.html` to GitHub (replace). Vercel rebuilds by itself.
2. SQL Editor → run all of `supabase/schema.sql` again (adds per-KPI saving, automatic score, automatic Pending points).
3. Redeploy all 5 functions from `supabase/dashboard-paste/` (`ai-check`, `ai-review`, `admin-users`, `weekly-jobs`, `whatsapp`).
4. WhatsApp templates changed: create them with the texts below (if you already made the old ones, make new ones with these texts; same names are fine once the old ones are deleted).

## Upgrading from version 2.1 to 2.2 (proof attachments, locked status, next step)

1. Upload the new `src/` and `supabase/` folders to GitHub (replace). Vercel rebuilds by itself.
2. SQL Editor → run all of `supabase/schema.sql` again. It adds the private **evidence** storage (10 MB per file) and the status lock.
3. Redeploy 4 functions with the new files from `supabase/dashboard-paste/`: `ai-check`, `ai-review`, `weekly-jobs`, `whatsapp`.

## Upgrading from version 1 (you already have the app on Vercel + Supabase)

1. **Update the code on GitHub.** Replace the files in your repository with the ones in this zip (keep the folder structure: `src/`, `supabase/`, `index.html`, `package.json`). Vercel rebuilds by itself.
2. **Update the database.** Supabase → SQL Editor → paste all of `supabase/schema.sql` → Run. It upgrades in place; your data stays.
3. **Turn off email confirmation.** Supabase → Authentication → Sign In / Providers → Email: keep the Email provider **enabled** (usernames work through it behind the scenes) but turn **Confirm email** OFF. Under user sign-ups, turn **Allow new users to sign up** OFF (the admin creates every login).
4. **Give yourself a username + password** (you signed in with an email before). SQL Editor → run this one line, with your old email, the username you want and a new password:
   ```sql
   select public.set_login('your-old-email@gmail.com', 'nowfal', 'YourNewPassword', 'admin');
   ```
   It answers *Done. Sign in with username "nowfal"…*. Sign in with that username + password. In **Users**, give every other person a username (anyone without one shows in red — they can't sign in), and add your own WhatsApp mobile.
   *Logins made with a mobile number in version 2.0 are converted automatically: their username is their 10-digit mobile number. You can change it in Users.*
5. Continue with **Functions**, **WhatsApp** and **Schedule** below.

## Fresh install

1. Create a Supabase project (region Mumbai). SQL Editor: run `supabase/schema.sql`, then `supabase/seed.sql`.
2. Authentication → Email: **Confirm email** OFF, **Allow new users to sign up** OFF.
3. Create your own admin login: Authentication → Users → **Add user** → email `setup@u.atlas-kpi.app`, any password, **Auto confirm** ON (this address is never emailed — it's only a placeholder). Then SQL Editor:
   ```sql
   select public.set_login('setup@u.atlas-kpi.app', 'nowfal', 'YourPassword', 'admin');
   ```
   Sign in with username `nowfal` + that password.
4. Deploy the web app (Vercel or Netlify) with environment variables `VITE_SUPABASE_URL` and `VITE_SUPABASE_ANON_KEY`.
5. Continue below.

## Functions (5)

**Secrets** — Supabase → Edge Functions → Secrets:

| Name | Value |
|---|---|
| `ANTHROPIC_API_KEY` | Claude API key (platform.claude.com) |
| `WA_TOKEN` | WhatsApp permanent access token |
| `WA_PHONE_NUMBER_ID` | WhatsApp sending number's ID |
| `WA_VERIFY_TOKEN` | Any long random word you make up (used once to connect the webhook) |
| `WA_APP_SECRET` | Meta app secret (App settings → Basic) — protects the webhook |
| `CRON_SECRET` | Any long random word you make up (protects the Saturday schedule) |

**Deploy** — either way:

- *Website:* Edge Functions → Deploy a new function → Via Editor. Name it exactly as below, paste the matching file from `supabase/dashboard-paste/`, Deploy.
- *Command line:* `npx supabase functions deploy <name>` (add `--no-verify-jwt` where shown).

| Function | JWT verification |
|---|---|
| `ai-check` | ON (default) |
| `ai-review` | ON (default) |
| `admin-users` | ON (default) |
| `weekly-jobs` | **OFF** — it checks `CRON_SECRET` or the admin login itself |
| `whatsapp` | **OFF** — Meta can't send a Supabase login |

On the website, JWT verification is the **Enforce JWT verification** switch in each function's settings.

## WhatsApp (Meta Cloud API)

You need a Meta Business account and a phone number that is **not** already used in the normal WhatsApp app.

1. developers.facebook.com → **Create app** → Business → add **WhatsApp**.
2. In WhatsApp → API Setup: add and verify your business number; copy its **Phone number ID** → secret `WA_PHONE_NUMBER_ID`.
3. Business Settings → System users → create one (Admin) → **Generate token** for this app with `whatsapp_business_messaging` and `whatsapp_business_management` → secret `WA_TOKEN`.
4. App settings → Basic → **App secret** → secret `WA_APP_SECRET`.
5. WhatsApp → Configuration → **Webhook**: Callback URL `https://YOUR-PROJECT-REF.supabase.co/functions/v1/whatsapp`, Verify token = your `WA_VERIFY_TOKEN` → Verify and save → subscribe to **messages**.
6. WhatsApp Manager → **Message templates** → create these two (category **Utility**, language **Malayalam**):

**`kpi_weekly_start`** — Body (4 values: name, department, week, pending count):
> നമസ്കാരം {{1}}, {{2}} വകുപ്പിന്റെ ഈ ആഴ്ചയിലെ KPI ({{3}}) — ബാക്കിയുള്ളത്: {{4}}. ഇന്ന് വൈകിട്ട് 5 മണിക്ക് മുമ്പ് പൂർത്തിയാക്കുക. തുടങ്ങാൻ START അയക്കുക.

Sample values: Jayan, HR, 12 Oct – 17 Oct, 7 / 7.

Add a **Quick reply** button with the text `START`.

**`kpi_weekly_report`** — Header: **Document**. Body (3 values: week, HODs done, HODs not done):
> ഈ ആഴ്ചയിലെ HOD റിവ്യൂ PPT ({{1}}) തയ്യാറായി. പൂർത്തിയാക്കിയവർ: {{2}}. പൂർത്തിയാക്കാത്തവർ: {{3}}. ഫയൽ ചേർത്തിരിക്കുന്നു.

Sample values: 12 Oct – 17 Oct, Sales, HR (7 ബാക്കി).

Templates must be approved by Meta (usually minutes to a day). Business-started messages are charged by Meta per message; replies within 24 hours of the HOD's last message are part of the same conversation.

7. In the app → **Users**: make sure every HOD has their WhatsApp mobile number. → **Settings**: add the numbers that get the Saturday PPT.
8. Test: in **Settings → Run now → Send kickoff to all HODs**, then reply `START` from a HOD phone.

## Schedule (Saturday automation)

Supabase → SQL Editor → open `supabase/cron.sql`, replace `YOUR-PROJECT-REF` and `YOUR-CRON-SECRET`, Run.
Check with `select jobname, schedule, active from cron.job;` — four jobs. Every run also shows in the app under **Settings → Recent runs**.

## Changing things later

| Change | Where |
|---|---|
| KRA / KPI / targets | App → KRA & KPI (admin) |
| People, usernames, roles, WhatsApp numbers, passwords | App → Users (admin) |
| PPT recipients, bot asks all or only ★ KPIs | App → Settings |
| Saturday times | `supabase/cron.sql` (times are UTC = IST − 5:30) |
| Claude's rules / Malayalam wording | `supabase/functions/_shared/ai.ts`, bot messages in `_shared/bot.ts` → redeploy (or rebuild `dashboard-paste` with `npm run bundle:functions`) |
| PPT layout | `supabase/functions/_shared/ppt-builder.js` (used by app and Saturday job) |

## Troubleshooting

| Problem | Fix |
|---|---|
| "Username or password is wrong" | Admin → Users → check the username, or Reset password |
| Admin forgot own password | SQL Editor: `select public.set_login('nowfal', 'nowfal', 'NewPassword');` |
| HOD sees nothing | Their role or department isn't set in Users |
| Bot doesn't reply | Webhook not verified, `whatsapp` deployed with JWT ON, or the HOD's number in Users doesn't match their WhatsApp number |
| Bot says number not registered | Add the number in Users (10 digits; 91 is added automatically) |
| Kickoff / PPT not received | Template not approved yet, or template name/language in Settings doesn't match Meta |
| Saturday jobs didn't run | `select * from cron.job_run_details order by start_time desc limit 10;` and Settings → Recent runs |
| Claude errors | Edge Functions → (function) → Logs; check `ANTHROPIC_API_KEY` and Claude Console credit |
