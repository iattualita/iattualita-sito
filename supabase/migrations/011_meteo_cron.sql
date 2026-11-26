-- Aggiornamento automatico della pagina /meteo (applicata il 26/11/2026).
-- Oltre al routine del reel (4:55), pg_cron chiama la edge function meteo-sito:
--   6:15  rete di sicurezza: crea la pagina del giorno anche se il routine fallisce (tiene i testi se ci sono);
--   16:30 numeri dalla corsa ICON-2I delle 12 UTC. Testi, reel e allerte del mattino restano.
-- La chiave sta nel Vault (meteo_cron_chiave), qui e in meteo_cron solo l'impronta. La funzione, con la chiave,
-- crea un token di 10 minuti per chiamare meteo-dati e lo cancella alla fine.
create extension if not exists pg_cron;
create extension if not exists pg_net;
create table if not exists public.meteo_cron (hash text primary key, creata_il timestamptz not null default now());
alter table public.meteo_cron enable row level security;
revoke all on public.meteo_cron from anon, authenticated;
grant select on public.meteo_cron to service_role;
-- (a mano: select vault.create_secret('<chiave>', 'meteo_cron_chiave'); insert into public.meteo_cron(hash) values ('<sha256 della chiave>');)

-- pg_cron lavora in UTC: si programma su entrambe le ore possibili e si parte solo all'ora italiana giusta.
create or replace function public.meteo_aggiorna(ora_italiana int)
returns void language plpgsql security definer set search_path = public, extensions as $$
declare chiave text;
begin
  if extract(hour from now() at time zone 'Europe/Rome')::int <> ora_italiana then return; end if;
  select decrypted_secret into chiave from vault.decrypted_secrets where name = 'meteo_cron_chiave';
  perform net.http_post(
    url := 'https://wzkshpgakvasqwrrgkgd.supabase.co/functions/v1/meteo-sito',
    headers := jsonb_build_object('Content-Type', 'application/json', 'x-meteo-cron', chiave),
    body := jsonb_build_object('giorno', to_char(now() at time zone 'Europe/Rome', 'YYYY-MM-DD')),
    timeout_milliseconds := 240000);
end $$;
revoke all on function public.meteo_aggiorna(int) from public, anon, authenticated;
select cron.schedule('meteo-6-15', '15 4,5 * * *', $$select public.meteo_aggiorna(6)$$);
select cron.schedule('meteo-16-30', '30 14,15 * * *', $$select public.meteo_aggiorna(16)$$);
