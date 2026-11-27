-- Meteo di tutti i comuni (dal 27/11/2026): tabella, contatore e cron del calcolo mattutino.
-- (tabelle meteo_comuni e meteo_consumo + meteo_consumo_aggiungi: vedi la migrazione applicata
--  come "meteo_comuni" su Supabase; qui il cron)
create or replace function public.meteo_comuni_lotto()
returns void language plpgsql security definer set search_path to 'public', 'extensions' as $$
declare chiave text; h int := extract(hour from now() at time zone 'Europe/Rome')::int;
begin
  -- dalle 5 alle 7 ora italiana, un lotto da 400 comuni ogni 2 minuti finche' non sono tutti aggiornati
  if h not in (5, 6) then return; end if;
  if not exists (select 1 from public.meteo_comuni where not capoluogo and (giorno is null or giorno < (now() at time zone 'Europe/Rome')::date)) then return; end if;
  select decrypted_secret into chiave from vault.decrypted_secrets where name = 'meteo_cron_chiave';
  perform net.http_post(
    url := 'https://wzkshpgakvasqwrrgkgd.supabase.co/functions/v1/meteo-comuni',
    headers := jsonb_build_object('Content-Type', 'application/json', 'x-meteo-cron', chiave),
    body := '{"lotto":true}'::jsonb, timeout_milliseconds := 110000);
end $$;
revoke all on function public.meteo_comuni_lotto() from public, anon, authenticated;
select cron.schedule('meteo-comuni', '*/2 3,4,5,6 * * *', 'select public.meteo_comuni_lotto()');
