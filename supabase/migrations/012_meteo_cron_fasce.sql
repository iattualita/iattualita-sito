-- Aggiornamenti in più oltre a 6:15 e 16:30: 9:15, 12:15, 19:15, 22:15 ora italiana.
create or replace function public.meteo_aggiorna_fasce()
returns void language plpgsql security definer set search_path to 'public', 'extensions' as $$
declare h int := extract(hour from now() at time zone 'Europe/Rome')::int;
begin
  if h in (9, 12, 19, 22) then perform public.meteo_aggiorna(h); end if;
end $$;
revoke all on function public.meteo_aggiorna_fasce() from public, anon, authenticated;
select cron.schedule('meteo-fasce', '15 * * * *', 'select public.meteo_aggiorna_fasce()');
