-- Atlas Maharani Group · Weekly KPI Review
-- Run this once in Supabase: Dashboard → SQL Editor → New query → paste → Run.

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

create or replace function public.can_write_dept(d text) returns boolean
language sql stable security definer set search_path = public as $$
  select public.is_admin() or (public.my_role() = 'hod' and public.my_dept() = d);
$$;

-- Create a profile row for every new login (role 'pending' until the admin gives access)
create or replace function public.handle_new_user() returns trigger
language plpgsql security definer set search_path = public as $$
begin
  insert into public.profiles (id, email, full_name)
  values (new.id, new.email, coalesce(new.raw_user_meta_data->>'full_name', split_part(new.email, '@', 1)))
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
     and (new.role is distinct from old.role or new.dept_id is distinct from old.dept_id) then
    raise exception 'Only an admin can change roles and departments';
  end if;
  return new;
end $$;

drop trigger if exists profiles_guard on public.profiles;
create trigger profiles_guard before update on public.profiles
  for each row execute function public.guard_profile();

-- ============ Row level security ============

alter table public.profiles    enable row level security;
alter table public.departments enable row level security;
alter table public.kpis        enable row level security;
alter table public.proposals   enable row level security;
alter table public.results     enable row level security;
alter table public.actions     enable row level security;
alter table public.reviews     enable row level security;

-- profiles: you always see your own row; approved users see everyone; you edit your own name; admin edits all
drop policy if exists profiles_read on public.profiles;
create policy profiles_read on public.profiles for select to authenticated using (id = auth.uid() or public.is_member());
drop policy if exists profiles_update_self on public.profiles;
create policy profiles_update_self on public.profiles for update to authenticated using (id = auth.uid() or public.is_admin()) with check (id = auth.uid() or public.is_admin());

-- departments + kpis: approved users read; only admin writes
drop policy if exists dept_read on public.departments;
create policy dept_read on public.departments for select to authenticated using (public.is_member());
drop policy if exists dept_admin on public.departments;
create policy dept_admin on public.departments for all to authenticated using (public.is_admin()) with check (public.is_admin());

drop policy if exists kpis_read on public.kpis;
create policy kpis_read on public.kpis for select to authenticated using (public.is_member());
drop policy if exists kpis_admin on public.kpis;
create policy kpis_admin on public.kpis for all to authenticated using (public.is_admin()) with check (public.is_admin());

-- proposals: approved users read; HOD/admin propose; only admin approves or rejects
drop policy if exists prop_read on public.proposals;
create policy prop_read on public.proposals for select to authenticated using (public.is_member());
drop policy if exists prop_insert on public.proposals;
create policy prop_insert on public.proposals for insert to authenticated with check (public.my_role() in ('admin','hod'));
drop policy if exists prop_admin_update on public.proposals;
create policy prop_admin_update on public.proposals for update to authenticated using (public.is_admin()) with check (public.is_admin());
drop policy if exists prop_admin_delete on public.proposals;
create policy prop_admin_delete on public.proposals for delete to authenticated using (public.is_admin());

-- results: approved users read; HOD writes only their own department; admin writes all
drop policy if exists res_read on public.results;
create policy res_read on public.results for select to authenticated using (public.is_member());
drop policy if exists res_insert on public.results;
create policy res_insert on public.results for insert to authenticated with check (public.can_write_dept(dept_id));
drop policy if exists res_update on public.results;
create policy res_update on public.results for update to authenticated using (public.can_write_dept(dept_id)) with check (public.can_write_dept(dept_id));
drop policy if exists res_delete on public.results;
create policy res_delete on public.results for delete to authenticated using (public.is_admin());

-- actions: approved users read; HOD adds/updates their department's; admin all; only admin deletes
drop policy if exists act_read on public.actions;
create policy act_read on public.actions for select to authenticated using (public.is_member());
drop policy if exists act_insert on public.actions;
create policy act_insert on public.actions for insert to authenticated with check (public.can_write_dept(dept_id));
drop policy if exists act_update on public.actions;
create policy act_update on public.actions for update to authenticated using (public.can_write_dept(dept_id)) with check (public.can_write_dept(dept_id));
drop policy if exists act_delete on public.actions;
create policy act_delete on public.actions for delete to authenticated using (public.is_admin());

-- reviews (Claude MD office review): approved users read; only admin writes
drop policy if exists rev_read on public.reviews;
create policy rev_read on public.reviews for select to authenticated using (public.is_member());
drop policy if exists rev_admin on public.reviews;
create policy rev_admin on public.reviews for all to authenticated using (public.is_admin()) with check (public.is_admin());

-- ============ Live updates ============
do $$
declare t text;
begin
  foreach t in array array['departments','kpis','proposals','results','actions','reviews','profiles'] loop
    begin
      execute format('alter publication supabase_realtime add table public.%I', t);
    exception when duplicate_object then null;
             when undefined_object then null;
    end;
  end loop;
end $$;
