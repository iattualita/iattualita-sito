-- Pagina /meteo (dal 27/11/2026): una riga per giorno, scritta dalla edge
-- function meteo-sito (service role) e letta dal sito con la chiave pubblica.
-- Applicata al progetto il 26/11/2026 (migrazioni meteo_giorni e meteo_giorni_service_role).
create table if not exists public.meteo_giorni (
  giorno date primary key,
  titolo text,
  sottotitolo text,
  zone jsonb not null default '{}'::jsonb,
  reel_url text,
  cover_url text,
  allerte jsonb not null default '[]'::jsonb,
  kpi jsonb not null default '{}'::jsonb,
  regioni jsonb not null default '{}'::jsonb,
  punti jsonb not null default '[]'::jsonb,
  tendenza jsonb not null default '[]'::jsonb,
  differenze jsonb not null default '[]'::jsonb,
  fonti text,
  creato_il timestamptz not null default now(),
  aggiornato_il timestamptz not null default now()
);
comment on table public.meteo_giorni is 'Pagina /meteo di iattualita.it: un giorno per riga. Scrive solo la edge function meteo-sito (service role); il sito legge.';
alter table public.meteo_giorni enable row level security;
drop policy if exists "meteo_giorni lettura pubblica" on public.meteo_giorni;
create policy "meteo_giorni lettura pubblica" on public.meteo_giorni for select to anon, authenticated using (true);
grant select on public.meteo_giorni to anon, authenticated;
revoke insert, update, delete on public.meteo_giorni from anon, authenticated;
grant select, insert, update, delete on public.meteo_giorni to service_role;
