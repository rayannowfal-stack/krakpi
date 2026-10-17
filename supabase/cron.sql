-- Saturday schedule (India time). Run once in Supabase → SQL Editor, AFTER deploying the weekly-jobs function.
-- Before running, replace the two placeholders:
--   YOUR-PROJECT-REF  → your project's Reference ID (the part before .supabase.co)
--   YOUR-CRON-SECRET  → the same value you saved as the CRON_SECRET secret
-- Safe to run again: it replaces the four jobs.

create extension if not exists pg_cron;
create extension if not exists pg_net;

do $$
declare
  j text;
begin
  foreach j in array array['kpi-kickoff','kpi-remind','kpi-review','kpi-ppt'] loop
    begin perform cron.unschedule(j); exception when others then null; end;
  end loop;
end $$;

-- Cron times are in UTC. India is UTC + 5:30.
-- Saturday 9:30 AM IST  = 04:00 UTC → WhatsApp kickoff to every HOD
select cron.schedule('kpi-kickoff', '0 4 * * 6', $$
  select net.http_post(
    url := 'https://YOUR-PROJECT-REF.supabase.co/functions/v1/weekly-jobs',
    headers := jsonb_build_object('Content-Type','application/json','x-cron-secret','YOUR-CRON-SECRET'),
    body := jsonb_build_object('action','kickoff'),
    timeout_milliseconds := 300000);
$$);

-- Saturday 1:30 PM IST = 08:00 UTC → reminder to HODs who haven't submitted
select cron.schedule('kpi-remind', '0 8 * * 6', $$
  select net.http_post(
    url := 'https://YOUR-PROJECT-REF.supabase.co/functions/v1/weekly-jobs',
    headers := jsonb_build_object('Content-Type','application/json','x-cron-secret','YOUR-CRON-SECRET'),
    body := jsonb_build_object('action','remind'),
    timeout_milliseconds := 300000);
$$);

-- Saturday 4:30 PM IST = 11:00 UTC → Claude's MD office review
select cron.schedule('kpi-review', '0 11 * * 6', $$
  select net.http_post(
    url := 'https://YOUR-PROJECT-REF.supabase.co/functions/v1/weekly-jobs',
    headers := jsonb_build_object('Content-Type','application/json','x-cron-secret','YOUR-CRON-SECRET'),
    body := jsonb_build_object('action','review'),
    timeout_milliseconds := 300000);
$$);

-- Saturday 5:00 PM IST = 11:30 UTC → build the PPT and send it on WhatsApp
select cron.schedule('kpi-ppt', '30 11 * * 6', $$
  select net.http_post(
    url := 'https://YOUR-PROJECT-REF.supabase.co/functions/v1/weekly-jobs',
    headers := jsonb_build_object('Content-Type','application/json','x-cron-secret','YOUR-CRON-SECRET'),
    body := jsonb_build_object('action','ppt'),
    timeout_milliseconds := 300000);
$$);

-- Check: select jobname, schedule, active from cron.job;
-- History: select * from cron.job_run_details order by start_time desc limit 20;
