-- Atlas Maharani Group · Weekly KPI Review
-- Run in Supabase: Dashboard → SQL Editor → New query → paste → Run.
-- Safe to run again: it updates an existing database to the latest version without losing data.

-- ============ Tables ============

create table if not exists public.profiles (
  id          uuid primary key references auth.users(id) on delete cascade,
  email       text,
  full_name   text,
  role        text not null default 'pending' check (role in ('admin','hod','viewer','pending')),
  dept_id     text,
  created_at  timestamptz not null default now()
);

create table if not exists public.departments (
  id          text primary key,
  name        text not null,
  hod         text,
  sort_order  int  not null default 99,
  updated_at  timestamptz not null default now()
);

alter table public.profiles drop constraint if exists profiles_dept_fk;
alter table public.profiles add constraint profiles_dept_fk foreign key (dept_id) references public.departments(id) on delete set null;

create table if not exists public.kpis (
  id          text primary key,
  dept_id     text not null references public.departments(id) on delete cascade,
  kra_no      int  not null default 1,
  kra         text not null default '',
  kra_weight  numeric not null default 0,
  no          text not null default '',
  text        text not null,
  target      text not null default '[set]',
  tv          numeric,                     -- numeric target, null = HOD picks status
  dir         text not null default 'up' check (dir in ('up','down','zero')),
  freq        text not null default 'W' check (freq in ('D','W','15D','M','Q','H','Y','AN')),
  owner       text not null default '',
  star        boolean not null default false,  -- headline KPI on the scorecard
  updated_at  timestamptz not null default now()
);
create index if not exists kpis_dept_idx on public.kpis(dept_id);

create table if not exists public.proposals (
  id          uuid primary key default gen_random_uuid(),
  dept_id     text not null references public.departments(id) on delete cascade,
  kra_no      int,
  kra_name    text not null default '',
  text        text not null,
  target      text not null default '',
  freq        text not null default 'W',
  owner       text not null default '',
  note        text not null default '',
  status      text not null default 'pending' check (status in ('pending','approved','rejected')),
  created_by  uuid references auth.users(id) default auth.uid(),
  created_at  timestamptz not null default now(),
  decided_at  timestamptz
);

create table if not exists public.results (
  week        date not null,                -- the Monday of the HOD meeting
  dept_id     text not null references public.departments(id) on delete cascade,
  status      text not null default 'draft' check (status in ('draft','submitted')),
  rows        jsonb not null default '{}'::jsonb,   -- { kpiId: {actual, ach, rag, reason, data, no, text, target, star, kraNo, freq} }
  priorities  jsonb not null default '[]'::jsonb,
  support     text not null default '',
  score       int,
  counts      jsonb not null default '{}'::jsonb,
  ai          jsonb,                                  -- Claude's check of this sheet
  clar        jsonb not null default '[]'::jsonb,     -- HOD's answers to Claude's earlier questions
  updated_by  uuid references auth.users(id),
  updated_at  timestamptz not null default now(),
  primary key (week, dept_id)
);
create index if not exists results_week_idx on public.results(week);

create table if not exists public.actions (
  id          uuid primary key default gen_random_uuid(),
  dept_id     text not null references public.departments(id) on delete cascade,
  week        date,
  kpi_no      text not null default '',
  kpi_text    text not null default '',
  action      text not null,
  owner       text not null default '',
  due         date,
  status      text not null default 'Open' check (status in ('Open','In progress','Done','Not done')),
  result      text not null default '',
  created_by  uuid references auth.users(id) default auth.uid(),
  created_at  timestamptz not null default now(),
  updated_at  timestamptz not null default now()
);
create index if not exists actions_dept_idx on public.actions(dept_id);

create table if not exists public.reviews (
  week        date primary key,
  data        jsonb not null,               -- Claude's MD office review
  created_by  uuid references auth.users(id),
  created_at  timestamptz not null default now()
);

-- ============ Version 2 additions (mobile login, WhatsApp bot, schedule) ============

alter table public.profiles add column if not exists phone text;           -- WhatsApp number, 91XXXXXXXXXX
create unique index if not exists profiles_phone_key on public.profiles(phone) where phone is not null;

-- ============ Version 2.1: username + password login (no email anywhere) ============
-- Behind each username is a hidden login address  <username>@u.atlas-kpi.app  that nobody types or sees.
alter table public.profiles add column if not exists username text;
create unique index if not exists profiles_username_key on public.profiles(lower(username)) where username is not null;
alter table public.results  add column if not exists source text not null default 'app';  -- 'app' or 'whatsapp'

-- One row of settings, edited by the admin in the app (Settings tab)
create table if not exists public.app_settings (
  id              int primary key default 1 check (id = 1),
  report_numbers  text[] not null default '{}',          -- WhatsApp numbers that get the Saturday 5 PM PPT
  bot_scope       text not null default 'weekly' check (bot_scope in ('weekly','headline')),
  tpl_start       text not null default 'kpi_weekly_start',   -- approved WhatsApp template names
  tpl_report      text not null default 'kpi_weekly_report',
  tpl_lang        text not null default 'ml',
  updated_at      timestamptz not null default now()
);
insert into public.app_settings (id) values (1) on conflict (id) do nothing;

-- WhatsApp conversation state, one row per phone (server only)
create table if not exists public.wa_sessions (
  phone       text primary key,
  user_id     uuid references auth.users(id) on delete cascade,
  dept_id     text references public.departments(id) on delete cascade,
  week        date,
  step        text not null default 'idle',
  idx         int  not null default 0,
  items       jsonb not null default '[]'::jsonb,
  sub         text,
  updated_at  timestamptz not null default now()
);

-- WhatsApp message log (for checking what the bot said and received)
create table if not exists public.wa_log (
  id          bigint generated always as identity primary key,
  msg_id      text unique,
  phone       text,
  direction   text check (direction in ('in','out')),
  body        text,
  at          timestamptz not null default now()
);

-- Scheduled job runs (kickoff, reminder, review, PPT)
create table if not exists public.job_runs (
  id          bigint generated always as identity primary key,
  job         text not null,
  week        date,
  ok          boolean not null,
  detail      text,
  at          timestamptz not null default now()
);

-- ============ Helper functions ============

create or replace function public.my_role() returns text
language sql stable security definer set search_path = public as $$
  select coalesce((select role from public.profiles where id = auth.uid()), 'pending');
$$;

create or replace function public.my_dept() returns text
language sql stable security definer set search_path = public as $$
  select dept_id from public.profiles where id = auth.uid();
$$;

create or replace function public.is_admin() returns boolean
language sql stable security definer set search_path = public as $$
  select public.my_role() = 'admin';
$$;

-- HOD of this department, or admin
-- Approved user (admin, hod or viewer) — pending users see nothing
create or replace function public.is_member() returns boolean
language sql stable security definer set search_path = public as $$
  select public.my_role() in ('admin','hod','viewer');
$$;

-- Who may READ a department's data: admin and viewer see all; a HOD sees only their own department
create or replace function public.can_read_dept(d text) returns boolean
language sql stable security definer set search_path = public as $$
  select public.my_role() in ('admin','viewer') or (public.my_role() = 'hod' and public.my_dept() = d);
$$;

create or replace function public.can_write_dept(d text) returns boolean
language sql stable security definer set search_path = public as $$
  select public.is_admin() or (public.my_role() = 'hod' and public.my_dept() = d);
$$;

-- Create a profile row for every new login (role 'pending' until the admin gives access)
create or replace function public.handle_new_user() returns trigger
language plpgsql security definer set search_path = public as $$
begin
  insert into public.profiles (id, email, full_name, phone, username)
  values (new.id,
          case when new.email like '%@u.atlas-kpi.app' or new.email like '%@m.atlas-kpi.app' then null else new.email end,
          coalesce(nullif(new.raw_user_meta_data->>'full_name', ''), split_part(new.email, '@', 1)),
          nullif(new.raw_user_meta_data->>'phone', ''),
          case when new.email like '%@u.atlas-kpi.app' then split_part(new.email, '@', 1) else null end)
  on conflict (id) do nothing;
  return new;
end $$;

drop trigger if exists on_auth_user_created on auth.users;
create trigger on_auth_user_created after insert on auth.users
  for each row execute function public.handle_new_user();

-- A signed-in user may not change their own role or department (only an admin can).
-- Changes from the SQL Editor or the server (no signed-in user) are allowed, so you can set the first admin.
create or replace function public.guard_profile() returns trigger
language plpgsql security definer set search_path = public as $$
begin
  if auth.uid() is not null and not public.is_admin()
     and (new.role is distinct from old.role or new.dept_id is distinct from old.dept_id
          or new.username is distinct from old.username or new.phone is distinct from old.phone) then
    raise exception 'Only an admin can change roles, departments, usernames and mobile numbers';
  end if;
  return new;
end $$;

drop trigger if exists profiles_guard on public.profiles;
create trigger profiles_guard before update on public.profiles
  for each row execute function public.guard_profile();

-- Set (or change) anyone's username + password from the SQL Editor. Used once for the first admin:
--   select public.set_login('your-old-email@gmail.com', 'nowfal', 'YourNewPassword', 'admin');
-- "find" can be the old email, the current username, or the mobile number.
create or replace function public.set_login(find text, new_username text, new_password text, new_role text default null)
returns text language plpgsql security definer set search_path = public, auth, extensions as $$
declare
  uid uuid;
  u text := lower(trim(new_username));
  f text := lower(trim(find));
  login text;
begin
  if u !~ '^[a-z0-9][a-z0-9._-]{2,29}$' then raise exception 'Username: 3-30 letters or numbers (dot, dash, underscore allowed), no spaces'; end if;
  if length(coalesce(new_password, '')) < 6 then raise exception 'Password must be at least 6 characters'; end if;
  if new_role is not null and new_role not in ('admin','hod','viewer','pending') then raise exception 'Unknown role %', new_role; end if;
  select p.id into uid from public.profiles p
   where lower(p.username) = f or lower(p.email) = f
      or p.phone = regexp_replace(f, '\D', '', 'g') or p.phone = '91' || regexp_replace(f, '\D', '', 'g')
   limit 1;
  if uid is null then select id into uid from auth.users where lower(email) = f limit 1; end if;
  if uid is null then raise exception 'No account found for %', find; end if;
  if exists (select 1 from public.profiles where lower(username) = u and id <> uid) then raise exception 'Username % is already taken', u; end if;
  login := u || '@u.atlas-kpi.app';
  update auth.users set email = login,
         encrypted_password = extensions.crypt(new_password, extensions.gen_salt('bf')),
         email_confirmed_at = coalesce(email_confirmed_at, now()), updated_at = now()
   where id = uid;
  update auth.identities set identity_data = identity_data || jsonb_build_object('email', login, 'email_verified', true)
   where user_id = uid and provider = 'email';
  update public.profiles set username = u, email = null, role = coalesce(new_role, role) where id = uid;
  return 'Done. Sign in with username "' || u || '" and the new password.';
end $$;
revoke all on function public.set_login(text, text, text, text) from public, anon, authenticated;

-- Upgrade: accounts made with the mobile-number login (version 2.0) become username = their 10-digit mobile.
do $$
declare r record; u text;
begin
  for r in select au.id, p.phone from auth.users au join public.profiles p on p.id = au.id
            where au.email like '%@m.atlas-kpi.app' and p.username is null loop
    u := right(coalesce(r.phone, split_part((select email from auth.users where id = r.id), '@', 1)), 10);
    if exists (select 1 from public.profiles where lower(username) = u) then continue; end if;
    update auth.users set email = u || '@u.atlas-kpi.app' where id = r.id;
    update auth.identities set identity_data = identity_data || jsonb_build_object('email', u || '@u.atlas-kpi.app')
     where user_id = r.id and provider = 'email';
    update public.profiles set username = u where id = r.id;
  end loop;
end $$;

-- ============ Row level security ============

alter table public.profiles    enable row level security;
alter table public.departments enable row level security;
alter table public.kpis        enable row level security;
alter table public.proposals   enable row level security;
alter table public.results     enable row level security;
alter table public.actions     enable row level security;
alter table public.reviews     enable row level security;

-- profiles: you always see your own row; admin and viewer see everyone; you edit your own name; admin edits all
drop policy if exists profiles_read on public.profiles;
create policy profiles_read on public.profiles for select to authenticated using (id = auth.uid() or public.my_role() in ('admin','viewer'));
drop policy if exists profiles_update_self on public.profiles;
create policy profiles_update_self on public.profiles for update to authenticated using (id = auth.uid() or public.is_admin()) with check (id = auth.uid() or public.is_admin());

-- departments + kpis: admin/viewer read all, HOD reads own department; only admin writes
drop policy if exists dept_read on public.departments;
create policy dept_read on public.departments for select to authenticated using (public.can_read_dept(id));
drop policy if exists dept_admin on public.departments;
create policy dept_admin on public.departments for all to authenticated using (public.is_admin()) with check (public.is_admin());

drop policy if exists kpis_read on public.kpis;
create policy kpis_read on public.kpis for select to authenticated using (public.can_read_dept(dept_id));
drop policy if exists kpis_admin on public.kpis;
create policy kpis_admin on public.kpis for all to authenticated using (public.is_admin()) with check (public.is_admin());

-- proposals: approved users read; HOD/admin propose; only admin approves or rejects
drop policy if exists prop_read on public.proposals;
create policy prop_read on public.proposals for select to authenticated using (public.can_read_dept(dept_id));
drop policy if exists prop_insert on public.proposals;
create policy prop_insert on public.proposals for insert to authenticated with check (public.can_write_dept(dept_id));
drop policy if exists prop_admin_update on public.proposals;
create policy prop_admin_update on public.proposals for update to authenticated using (public.is_admin()) with check (public.is_admin());
drop policy if exists prop_admin_delete on public.proposals;
create policy prop_admin_delete on public.proposals for delete to authenticated using (public.is_admin());

-- results: approved users read; HOD writes only their own department; admin writes all
drop policy if exists res_read on public.results;
create policy res_read on public.results for select to authenticated using (public.can_read_dept(dept_id));
drop policy if exists res_insert on public.results;
create policy res_insert on public.results for insert to authenticated with check (public.can_write_dept(dept_id));
drop policy if exists res_update on public.results;
create policy res_update on public.results for update to authenticated using (public.can_write_dept(dept_id)) with check (public.can_write_dept(dept_id));
drop policy if exists res_delete on public.results;
create policy res_delete on public.results for delete to authenticated using (public.is_admin());

-- actions: approved users read; HOD adds/updates their department's; admin all; only admin deletes
drop policy if exists act_read on public.actions;
create policy act_read on public.actions for select to authenticated using (public.can_read_dept(dept_id));
drop policy if exists act_insert on public.actions;
create policy act_insert on public.actions for insert to authenticated with check (public.can_write_dept(dept_id));
drop policy if exists act_update on public.actions;
create policy act_update on public.actions for update to authenticated using (public.can_write_dept(dept_id)) with check (public.can_write_dept(dept_id));
drop policy if exists act_delete on public.actions;
create policy act_delete on public.actions for delete to authenticated using (public.is_admin());

-- reviews (Claude MD office review): approved users read; only admin writes
drop policy if exists rev_read on public.reviews;
create policy rev_read on public.reviews for select to authenticated using (public.my_role() in ('admin','viewer'));
drop policy if exists rev_admin on public.reviews;
create policy rev_admin on public.reviews for all to authenticated using (public.is_admin()) with check (public.is_admin());

-- settings: admin only (read + write)
alter table public.app_settings enable row level security;
drop policy if exists settings_admin on public.app_settings;
create policy settings_admin on public.app_settings for all to authenticated using (public.is_admin()) with check (public.is_admin());

-- WhatsApp sessions: server only (no policies = no access from the app)
alter table public.wa_sessions enable row level security;

-- WhatsApp log and job runs: admin can read; only the server writes
alter table public.wa_log enable row level security;
drop policy if exists wa_log_admin on public.wa_log;
create policy wa_log_admin on public.wa_log for select to authenticated using (public.is_admin());
alter table public.job_runs enable row level security;
drop policy if exists job_runs_admin on public.job_runs;
create policy job_runs_admin on public.job_runs for select to authenticated using (public.is_admin());

-- Private storage for the weekly PowerPoint files
do $$
begin
  insert into storage.buckets (id, name, public) values ('reports', 'reports', false) on conflict (id) do nothing;
exception when undefined_table or invalid_schema_name then null;
end $$;

-- ============ Version 2.2: proof attachments + locked status ============

-- Private bucket for voice notes, photos and files attached to a KPI. Path: <week>/<dept_id>/<kpi_id>/<file>
do $$
begin
  begin
    insert into storage.buckets (id, name, public, file_size_limit) values ('evidence', 'evidence', false, 10485760)
    on conflict (id) do update set file_size_limit = excluded.file_size_limit;
  exception when undefined_column then
    insert into storage.buckets (id, name, public) values ('evidence', 'evidence', false) on conflict (id) do nothing;
  end;
exception when undefined_table or invalid_schema_name then null;
end $$;

-- Who may see / add / remove proof: same rule as the department's results (HOD = own department only).
do $$
begin
  drop policy if exists evidence_read on storage.objects;
  create policy evidence_read on storage.objects for select to authenticated
    using (bucket_id = 'evidence' and public.can_read_dept((storage.foldername(name))[2]));
  drop policy if exists evidence_add on storage.objects;
  create policy evidence_add on storage.objects for insert to authenticated
    with check (bucket_id = 'evidence' and public.can_write_dept((storage.foldername(name))[2]));
  drop policy if exists evidence_remove on storage.objects;
  create policy evidence_remove on storage.objects for delete to authenticated
    using (bucket_id = 'evidence' and public.can_write_dept((storage.foldername(name))[2]));
exception when undefined_table or invalid_schema_name or undefined_function then null;
end $$;

-- Status is LOCKED: it always comes from the achievement %. Any hand-set status is removed when saved.
create or replace function public.lock_status() returns trigger
language plpgsql as $$
begin
  if new.rows is not null and jsonb_typeof(new.rows) = 'object' then
    new.rows := coalesce((select jsonb_object_agg(k, case when jsonb_typeof(v) = 'object' then v - 'rag' else v end)
                          from jsonb_each(new.rows) as e(k, v)), '{}'::jsonb);
  end if;
  return new;
end $$;
drop trigger if exists results_lock_status on public.results;
create trigger results_lock_status before insert or update on public.results
  for each row execute function public.lock_status();
-- clean statuses chosen by hand before this version
update public.results set rows = rows where rows::text like '%"rag"%';

-- ============ Version 3: one KPI at a time ============

-- Score and Green/Amber/Red counts are always worked out here from the achievement %, so every screen agrees.
create or replace function public.results_summary() returns trigger
language plpgsql as $$
declare v jsonb; a numeric; n int := 0; tot numeric := 0; g int := 0; am int := 0; r int := 0;
begin
  for v in select value from jsonb_each(coalesce(new.rows, '{}'::jsonb)) loop
    if jsonb_typeof(v) = 'object' and jsonb_typeof(v->'ach') = 'number' then
      a := (v->>'ach')::numeric; n := n + 1; tot := tot + least(a, 120);
      if a >= 95 then g := g + 1; elsif a >= 80 then am := am + 1; else r := r + 1; end if;
    end if;
  end loop;
  new.score := case when n > 0 then round(tot / n) else null end;
  new.counts := jsonb_build_object('G', g, 'A', am, 'R', r);
  return new;
end $$;
drop trigger if exists results_summary on public.results;
create trigger results_summary before insert or update on public.results
  for each row execute function public.results_summary();

-- Next steps of finished Amber/Red KPIs become Pending points automatically (one per KPI per week).
alter table public.actions add column if not exists auto_key text;
create unique index if not exists actions_auto_key on public.actions(auto_key) where auto_key is not null;

-- Saves ONE KPI into the week's sheet without touching the others (app and WhatsApp can work at the same time).
-- Runs with the caller's own permissions: a HOD can only save their own department.
create or replace function public.save_kpi(p_week date, p_dept text, p_kpi text, p_row jsonb, p_source text default 'app', p_complete boolean default null)
returns void language plpgsql security invoker set search_path = public as $$
declare a numeric;
begin
  insert into public.results (week, dept_id, status, rows, source, updated_by, updated_at)
  values (p_week, p_dept, case when p_complete then 'submitted' else 'draft' end, jsonb_build_object(p_kpi, p_row), coalesce(p_source, 'app'), auth.uid(), now())
  on conflict (week, dept_id) do update set
    rows = coalesce(public.results.rows, '{}'::jsonb) || jsonb_build_object(p_kpi, p_row),
    status = case when p_complete is null then public.results.status when p_complete then 'submitted' else 'draft' end,
    source = coalesce(p_source, public.results.source),
    updated_by = coalesce(auth.uid(), public.results.updated_by),
    updated_at = now();
  if coalesce((p_row->>'done')::boolean, false) and jsonb_typeof(p_row->'ach') = 'number' and coalesce(trim(p_row->>'next'), '') <> '' then
    a := (p_row->>'ach')::numeric;
    if a < 95 then
      insert into public.actions (dept_id, week, kpi_no, kpi_text, action, status, auto_key)
      values (p_dept, p_week, coalesce(p_row->>'no', ''), coalesce(p_row->>'text', ''), p_row->>'next', 'Open', p_week || '|' || p_dept || '|' || p_kpi)
      on conflict (auto_key) where auto_key is not null do update set action = excluded.action, updated_at = now()
      where public.actions.status <> 'Done';
    end if;
  end if;
end $$;
grant execute on function public.save_kpi(date, text, text, jsonb, text, boolean) to authenticated;

-- Which KPIs HODs must finish each week: 'weekly' = all daily/weekly KPIs, 'headline' = only ★ ones (Settings).
create or replace function public.kpi_scope() returns text
language sql stable security definer set search_path = public as $$
  select coalesce((select bot_scope from public.app_settings where id = 1), 'weekly');
$$;
grant execute on function public.kpi_scope() to authenticated;

-- ============ Live updates ============
do $$
declare t text;
begin
  foreach t in array array['departments','kpis','proposals','results','actions','reviews','profiles','job_runs'] loop
    begin
      execute format('alter publication supabase_realtime add table public.%I', t);
    exception when duplicate_object then null;
             when undefined_object then null;
    end;
  end loop;
end $$;
