-- ============================================================================
-- Ruolo "giornalista" per la redazione.
--
-- DA ESEGUIRE UNA VOLTA SOLA nel SQL Editor di Supabase.
-- (Dashboard Supabase -> SQL Editor -> New query -> incolla -> Run)
-- Si puo' rieseguire senza danni.
--
-- Chi ha app_metadata.ruolo = 'giornalista' puo':
--   - scrivere articoli nuovi
--   - correggere SOLO gli articoli scritti da lui
--   - fare gli invii speciali (pulsante "Invio speciale")
-- e NON puo':
--   - cancellare articoli
--   - modificare gli articoli degli altri
--   - cambiare logo, social, contatti, "Chi siamo" (tabella site_info)
--   - inviare la newsletter settimanale (bloccato in send-digest.js)
--
-- Tutte le altre utenze (i due soci) restano come prima: nessun limite.
--
-- Come funziona: le policy qui sotto sono RESTRICTIVE, cioe' si sommano a
-- quelle che esistono gia' sulle tabelle senza toccarle. Per chi non e'
-- giornalista la condizione e' sempre vera e non cambia nulla.
-- Il ruolo sta in app_metadata, che l'utente non puo' modificare da se':
-- lo cambia solo chi entra nella dashboard Supabase.
-- ============================================================================

-- ---------------------------------------------------------------------------
-- 1. Funzione di comodo: l'utente collegato e' un giornalista?
-- ---------------------------------------------------------------------------
create or replace function public.is_giornalista()
returns boolean
language sql
stable
as $$
  select coalesce(auth.jwt() -> 'app_metadata' ->> 'ruolo', '') = 'giornalista'
$$;

-- ---------------------------------------------------------------------------
-- 2. Chi ha scritto l'articolo
-- Gli articoli gia' esistenti restano senza autore registrato: il giornalista
-- non puo' modificarli. Da adesso ogni articolo nuovo registra chi l'ha creato.
-- ---------------------------------------------------------------------------
alter table public.news add column if not exists created_by uuid default auth.uid();

-- ---------------------------------------------------------------------------
-- 3. Articoli
-- ---------------------------------------------------------------------------
drop policy if exists "giornalista: crea solo a suo nome"     on public.news;
drop policy if exists "giornalista: modifica solo i suoi"      on public.news;
drop policy if exists "giornalista: non cancella"              on public.news;

create policy "giornalista: crea solo a suo nome"
  on public.news as restrictive
  for insert to authenticated
  with check (not public.is_giornalista() or created_by = auth.uid());

create policy "giornalista: modifica solo i suoi"
  on public.news as restrictive
  for update to authenticated
  using      (not public.is_giornalista() or created_by = auth.uid())
  with check (not public.is_giornalista() or created_by = auth.uid());

create policy "giornalista: non cancella"
  on public.news as restrictive
  for delete to authenticated
  using (not public.is_giornalista());

-- ---------------------------------------------------------------------------
-- 4. Logo, social, contatti, "Chi siamo"
-- ---------------------------------------------------------------------------
drop policy if exists "giornalista: non modifica il sito" on public.site_info;
drop policy if exists "giornalista: non aggiunge al sito"  on public.site_info;
drop policy if exists "giornalista: non cancella dal sito" on public.site_info;

create policy "giornalista: non modifica il sito"
  on public.site_info as restrictive
  for update to authenticated
  using      (not public.is_giornalista())
  with check (not public.is_giornalista());

create policy "giornalista: non aggiunge al sito"
  on public.site_info as restrictive
  for insert to authenticated
  with check (not public.is_giornalista());

create policy "giornalista: non cancella dal sito"
  on public.site_info as restrictive
  for delete to authenticated
  using (not public.is_giornalista());

-- ---------------------------------------------------------------------------
-- 5. Lista iscritti: il giornalista non la puo' leggere ne' toccare.
-- Gli invii (settimanale e speciali) la leggono dal server con la
-- service_role, che non passa da queste policy: l'invio speciale funziona.
-- ---------------------------------------------------------------------------
drop policy if exists "giornalista: niente lista iscritti" on public.subscribers;
create policy "giornalista: niente lista iscritti"
  on public.subscribers as restrictive
  for all to authenticated
  using (not public.is_giornalista())
  with check (not public.is_giornalista());

-- ---------------------------------------------------------------------------
-- 6. Assegna il ruolo a Francesco Fravolini.
-- Se la sua utenza non esiste ancora non succede nulla: creala da
-- Authentication -> Users -> Add user e riesegui solo questa istruzione.
-- Per un altro giornalista in futuro: stessa riga con la sua email.
-- Per togliere il ruolo:  raw_app_meta_data = raw_app_meta_data - 'ruolo'
-- Il ruolo vale dal suo prossimo accesso (esce e rientra).
-- ---------------------------------------------------------------------------
update auth.users
set raw_app_meta_data = coalesce(raw_app_meta_data, '{}'::jsonb) || '{"ruolo":"giornalista"}'::jsonb
where email = 'ffravolini@gmail.com';

-- ---------------------------------------------------------------------------
-- 7. Controllo finale: il risultato di questa query mostra lo stato.
-- Le tre tabelle devono risultare "RLS attiva", altrimenti le policy
-- restrittive di quella tabella non hanno effetto. L'ultima riga dice se
-- Fravolini ha il ruolo.
-- ---------------------------------------------------------------------------
select c.relname::text as controllo,
       case when c.relrowsecurity then 'RLS attiva' else 'ATTENZIONE: RLS spenta' end as stato,
       (select count(*) from pg_policies p
         where p.schemaname = 'public' and p.tablename = c.relname
           and p.policyname like 'giornalista:%')::text as policy_giornalista
from pg_class c
join pg_namespace n on n.oid = c.relnamespace
where n.nspname = 'public' and c.relname in ('news', 'site_info', 'subscribers')
union all
select 'utenza ffravolini@gmail.com',
       coalesce((select 'ruolo: ' || coalesce(raw_app_meta_data ->> 'ruolo', 'nessuno')
                   from auth.users where email = 'ffravolini@gmail.com'),
                'utenza non ancora creata'),
       ''
order by 1;
