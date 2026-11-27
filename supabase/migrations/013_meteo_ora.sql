-- Osservazioni reali "adesso" (METAR degli aeroporti), aggiornate ogni 30 minuti da meteo-ora.
create table if not exists public.meteo_ora (
  id int primary key default 1 check (id = 1),
  stazioni jsonb not null default '[]'::jsonb,
  aggiornato_il timestamptz not null default now()
);
alter table public.meteo_ora enable row level security;
drop policy if exists "meteo_ora lettura pubblica" on public.meteo_ora;
create policy "meteo_ora lettura pubblica" on public.meteo_ora for select using (true);
grant select on public.meteo_ora to anon, authenticated;
grant select, insert, update, delete on public.meteo_ora to service_role;

create or replace function public.meteo_ora_aggiorna()
returns void language plpgsql security definer set search_path to 'public', 'extensions' as $$
declare chiave text;
begin
  select decrypted_secret into chiave from vault.decrypted_secrets where name = 'meteo_cron_chiave';
  perform net.http_post(
    url := 'https://wzkshpgakvasqwrrgkgd.supabase.co/functions/v1/meteo-ora',
    headers := jsonb_build_object('Content-Type', 'application/json', 'x-meteo-cron', chiave),
    body := '{}'::jsonb, timeout_milliseconds := 60000);
end $$;
revoke all on function public.meteo_ora_aggiorna() from public, anon, authenticated;
select cron.schedule('meteo-ora', '27,57 * * * *', 'select public.meteo_ora_aggiorna()');
