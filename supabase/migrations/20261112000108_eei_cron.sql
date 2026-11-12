-- Free-text EEI: the tagger runs every 5 minutes (minutes 2, 7, 12, …), only while some theatre was
-- used in the last 24 h (see public.eei_tick in 20261112000107). Kept apart so it is approved last.
select cron.unschedule('osintfront-eei-tick') where exists (select 1 from cron.job where jobname = 'osintfront-eei-tick');
select cron.schedule('osintfront-eei-tick', '2-59/5 * * * *', $c$select public.eei_tick()$c$);
