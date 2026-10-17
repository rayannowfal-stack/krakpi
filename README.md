# Atlas KPI Review

Weekly KRA & KPI review for the Atlas Maharani Group Monday HOD meeting.
HODs submit their week's results with supporting data, Claude checks that the results are
**result-oriented and not just duty**, the MD office gets a Claude review with questions for
Monday, and one click builds the PowerPoint for the meeting.

## What's inside

| Part | Technology | Where |
|---|---|---|
| Web app | HTML, CSS, plain JavaScript, built with **Vite** | `index.html`, `src/` |
| Database, login, live updates | **Supabase** (Postgres + Auth + Realtime) | `supabase/schema.sql` |
| Security | Postgres row-level security by role | `supabase/schema.sql` |
| KRA/KPI data | 8 departments, 266 KPIs from your KRA files | `supabase/seed.sql` |
| Claude review | **Supabase Edge Functions** calling the **Claude API** | `supabase/functions/` |
| PowerPoint | **PptxGenJS** (built in the browser) | `src/main.js` |
| Hosting | Netlify or Vercel (free plans are enough to start) | `netlify.toml` |

### Roles

| Role | Can do |
|---|---|
| **Admin** (MD office) | Everything: edit KRA/KPI and departments, approve proposals, give people access, run the MD review, delete actions |
| **HOD** | Submit results for **their own department only**, run the Claude check, update their actions, propose new KRA/KPI |
| **Viewer** | Read everything |
| **Pending** | Anyone who signs in for the first time. Sees nothing until an admin gives them a role |

These rules are enforced inside the database, not just hidden in the screens.

### How the Claude check works

1. The HOD enters the week's actuals, reasons and supporting data.
2. **Check with Claude** sends the sheet to the `ai-check` function, which asks Claude (Sonnet 5.5)
   to rate it *Result-oriented / Partly result-oriented / Activity only*, give an evidence score,
   ask clarification questions and suggest improvements.
3. The HOD must answer the high-severity questions. Submit stays blocked until the sheet has been
   checked, figures haven't changed since, and those questions are answered.
4. In **MD Office**, an admin presses **Generate MD review**: the `ai-review` function sends every
   department's sheet, the HODs' answers, last week's scores and the action tracker to Claude
   (Opus 5.5), and saves the review. It also goes into the PowerPoint.

The Claude API key is stored only as a Supabase secret. It never reaches the browser.

---

## Setup (about 30–45 minutes, one time)

You need: a computer with **Node.js 20+**, a free **Supabase** account, a **Claude API** key
from the Claude Console, and a free **Netlify** (or Vercel) account.

### 1. Create the Supabase project

1. Go to supabase.com → **New project**. Name it `atlas-kpi`, pick region **Mumbai (ap-south-1)**, set a database password and keep it safe.
2. When it's ready, open **SQL Editor → New query**, paste all of `supabase/schema.sql`, press **Run**.
3. New query again, paste all of `supabase/seed.sql`, press **Run**. This loads the 8 departments and 266 KPIs.

### 2. Turn on email login

1. **Authentication → Providers → Email**: keep it enabled (magic link is on by default).
2. **Authentication → URL Configuration**: set **Site URL** to your app address (for now `http://localhost:5173`; change it after step 5).
3. Supabase's built-in email is for testing only and sends very few emails per hour. Before the HODs start, set up your own sender in **Authentication → Emails → SMTP Settings** (Gmail/Google Workspace, Zoho or any SMTP provider works).

### 3. Add the Claude functions

Install the Supabase CLI (see supabase.com/docs/guides/cli), then in this folder:

```bash
supabase login
supabase link --project-ref YOUR-PROJECT-ID
supabase secrets set ANTHROPIC_API_KEY=sk-ant-...your key...
supabase functions deploy ai-check
supabase functions deploy ai-review
```

Optional: choose different Claude models with
`supabase secrets set CLAUDE_MODEL_CHECK=claude-sonnet-5-5 CLAUDE_MODEL_REVIEW=claude-opus-5-5`.

### 4. Run the app on your computer

```bash
cp .env.example .env      # then paste your Supabase URL and anon key (Project Settings → API)
npm install
npm run dev               # opens http://localhost:5173
```

Sign in with your email. You'll see **Waiting for access** — that's expected. Make yourself admin
once in **SQL Editor**:

```sql
update public.profiles set role = 'admin' where email = 'you@yourcompany.com';
```

Refresh: you're the admin. From now on, give everyone else access in the app's **Users** tab
(set **Role** = HOD and their **Department**).

### 5. Put it online

**Netlify:** push this folder to a GitHub repository → Netlify → **Add new site → Import from Git**.
Build command `npm run build`, publish directory `dist` (already in `netlify.toml`).
Under **Site settings → Environment variables** add `VITE_SUPABASE_URL` and `VITE_SUPABASE_ANON_KEY`, then deploy.

Then go back to Supabase **Authentication → URL Configuration** and set **Site URL** to your Netlify
address (or your own domain, e.g. `kpi.atlasmaharani.com`).

---

## Weekly routine

| When | Who | What |
|---|---|---|
| Mon–Sat | HODs | Enter the week's figures, **Check with Claude**, answer questions, **Submit results** |
| Monday morning | MD office | **MD Office → Generate MD review**, read the questions for each HOD |
| Monday meeting | MD / CEO | **Make PPT** and present; new actions go to **Pending points** |

The week shown is the Monday of the meeting; it covers the previous Monday–Sunday.

## Changing things later

- **KRA / KPI:** in the app, **All KRA & KPI** (admin). Set **Target number** and **Better when** so achievement % is calculated; leave the number blank where the HOD should pick Green/Amber/Red.
- **Claude's rules:** edit the prompt text in `supabase/functions/ai-check/index.ts` or `ai-review/index.ts`, then `supabase functions deploy ai-check` (or `ai-review`).
- **Colours and fonts:** the tokens at the top of `src/styles.css`.

## Costs to expect

Supabase and Netlify free plans cover a team of this size to start. Claude API usage is billed per
use on your Anthropic account: one HOD check and one MD review per week is a small amount, but
check current prices in the Claude Console and set a monthly spend limit there.

## Good next steps

1. **Pull actuals from Tally and the billing software** with a scheduled Edge Function, so the sheet
   is filled from the system and HODs only add reasons — the strongest guard against overstated results.
2. **WhatsApp / email reminders** on Saturday evening to HODs who haven't submitted.
3. **Monthly roll-up** of weekly scores for the incentive scheme.
