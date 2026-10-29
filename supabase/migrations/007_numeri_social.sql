-- ============================================================================
-- I numeri dei canali social per la pagina /numeri.
--
-- DA ESEGUIRE UNA VOLTA SOLA nel SQL Editor di Supabase, PRIMA di pubblicare
-- il sito con la pagina. Si puo' rieseguire senza danni.
--
-- Una riga per piattaforma. YouTube, Instagram e Facebook li scrive ogni
-- notte la funzione numeri-cron.mjs leggendo le API ufficiali; TikTok lo
-- scrive la redazione dalla pagina stessa (TikTok non ha un'API semplice
-- per leggere i propri numeri senza una revisione dell'app).
-- ============================================================================

create table if not exists public.numeri_social (
  piattaforma      text primary key check (piattaforma in ('youtube', 'instagram', 'facebook', 'tiktok')),
  follower         bigint,
  visualizzazioni  bigint,
  periodo          text,          -- a cosa si riferiscono le visualizzazioni, es. "ultimi 30 giorni"
  fonte            text not null default 'manuale' check (fonte in ('automatico', 'manuale')),
  aggiornato_at    timestamptz,
  errore           text           -- ultimo errore della lettura automatica, per la redazione
);

-- Le quattro righe di partenza, vuote: la pagina sa gia' cosa mostrare.
insert into public.numeri_social (piattaforma, fonte) values
  ('youtube', 'automatico'), ('instagram', 'automatico'), ('facebook', 'automatico'), ('tiktok', 'manuale')
on conflict (piattaforma) do nothing;

alter table public.numeri_social enable row level security;

-- Chiunque legge: la pagina e' pubblica.
drop policy if exists "tutti leggono i numeri" on public.numeri_social;
create policy "tutti leggono i numeri"
  on public.numeri_social for select
  to anon, authenticated
  using (true);

-- La redazione aggiorna i numeri inseriti a mano (TikTok). Il giornalista no:
-- e' un dato che finisce davanti a sponsor e uffici stampa.
drop policy if exists "soci aggiornano i numeri manuali" on public.numeri_social;
create policy "soci aggiornano i numeri manuali"
  on public.numeri_social for update
  to authenticated
  using      (fonte = 'manuale' and not public.is_giornalista())
  with check (fonte = 'manuale' and not public.is_giornalista());

-- L'errore tecnico serve alla redazione, non al pubblico.
revoke select on public.numeri_social from anon;
grant select (piattaforma, follower, visualizzazioni, periodo, fonte, aggiornato_at) on public.numeri_social to anon;
grant select, update on public.numeri_social to authenticated;
grant select, insert, update, delete on public.numeri_social to service_role;

notify pgrst, 'reload schema';

select piattaforma, fonte, follower, aggiornato_at from public.numeri_social order by piattaforma;
