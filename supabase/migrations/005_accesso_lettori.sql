-- ============================================================================
-- Accesso dei lettori: registrazione gratuita con email e codice a 6 cifre.
--
-- DA ESEGUIRE UNA VOLTA SOLA nel SQL Editor di Supabase, PRIMA di pubblicare
-- il sito aggiornato. (Dashboard Supabase -> SQL Editor -> New query ->
-- incolla -> Run.) Si puo' rieseguire senza danni.
--
-- Questa migrazione AGGIUNGE e basta: il sito attualmente online continua a
-- funzionare identico anche dopo averla eseguita. La chiusura vera del testo
-- integrale sta nella 006, da eseguire DOPO che il sito nuovo e' online.
--
-- Crea tre cose:
--   1. lettori         -> chi si e' registrato per leggere gli articoli
--   2. codici_accesso  -> il codice a 6 cifre in attesa di essere usato
--   3. news.anteprima  -> l'inizio dell'articolo, l'unica parte di testo che
--                         restera' leggibile da chiunque dopo la 006
--
-- PERCHE' I LETTORI NON SONO UTENTI SUPABASE
-- Gli account di Supabase Auth (ruolo "authenticated") sono quelli della
-- redazione, e le policy esistenti danno a quel ruolo il permesso di scrivere
-- articoli e invii speciali. Un lettore registrato con Supabase Auth
-- erediterebbe quei permessi. Per questo i lettori stanno in una tabella a
-- parte, che solo il server legge con la service_role, e la sessione e' un
-- cookie firmato dalle funzioni Netlify, non un token Supabase.
-- ============================================================================

-- ---------------------------------------------------------------------------
-- 1. I lettori registrati
-- ---------------------------------------------------------------------------
create table if not exists public.lettori (
  id             uuid primary key default gen_random_uuid(),
  email          text not null unique,
  created_at     timestamptz not null default now(),
  last_login_at  timestamptz not null default now()
);

comment on table public.lettori is
  'Lettori registrati sul sito (accesso con codice via email). Non sono utenti Supabase Auth: li legge solo il server.';

-- Nessuna policy: per il pubblico e per la redazione la tabella e' invisibile.
-- Solo le funzioni Netlify, con la service_role, la leggono e la scrivono.
alter table public.lettori enable row level security;

-- ---------------------------------------------------------------------------
-- 2. Codici di accesso in attesa
--
-- Una riga per indirizzo: chiedere un codice nuovo sostituisce il vecchio.
-- Il codice non e' salvato in chiaro, solo la sua impronta (HMAC con un
-- segreto che sta nelle variabili d'ambiente di Netlify): chi leggesse la
-- tabella non potrebbe usarlo.
--
-- newsletter: la scelta fatta sulla casella al momento della richiesta.
-- Viene applicata solo quando il codice e' verificato, cioe' quando e'
-- dimostrato che l'indirizzo appartiene a chi l'ha scritto: vale quanto il
-- click sul link del doppio opt-in.
-- ---------------------------------------------------------------------------
create table if not exists public.codici_accesso (
  email       text primary key,
  code_hash   text not null,
  expires_at  timestamptz not null,
  tentativi   integer not null default 0,
  newsletter  boolean not null default false,
  created_at  timestamptz not null default now()
);

alter table public.codici_accesso enable row level security;

grant select, insert, update, delete on public.lettori        to service_role;
grant select, insert, update, delete on public.codici_accesso to service_role;

-- ---------------------------------------------------------------------------
-- codice_tentativo(email): conta un tentativo e restituisce il codice da
-- confrontare, in una sola istruzione.
--
-- Leggere il contatore e poi riscriverlo in due passi lascerebbe un buco:
-- dieci tentativi lanciati insieme leggerebbero tutti "0" e scriverebbero
-- tutti "1", e il limite di 5 non varrebbe piu'. Qui l'incremento e il
-- controllo avvengono nello stesso UPDATE, che Postgres esegue una riga alla
-- volta: il sesto tentativo non riceve niente, comunque arrivi.
--
-- Nessuna riga restituita = codice inesistente, scaduto o gia' bruciato.
-- ---------------------------------------------------------------------------
create or replace function public.codice_tentativo(e text)
returns table (code_hash text, newsletter boolean, tentativi integer)
language sql
as $$
  update public.codici_accesso c
     set tentativi = c.tentativi + 1
   where c.email = e
     and c.tentativi < 5
     and c.expires_at > now()
  returning c.code_hash, c.newsletter, c.tentativi
$$;

revoke all on function public.codice_tentativo(text) from public, anon, authenticated;
grant execute on function public.codice_tentativo(text) to service_role;

-- ---------------------------------------------------------------------------
-- 3. L'anteprima di ogni articolo
--
-- E' una colonna calcolata dal database a ogni salvataggio: nessuno la
-- scrive a mano e non puo' andare fuori sincrono col testo.
--
-- Parte dal corpo HTML (che conserva i paragrafi) e solo se manca usa
-- summary. Prende un terzo del testo, almeno 160 caratteri e al massimo
-- 600: abbastanza per capire di cosa parla l'articolo, mai tutto. Su un
-- pezzo breve un'anteprima fissa di 600 caratteri lo regalerebbe intero.
--
-- Il taglio fine (fine frase, puntini) lo fa shared/anteprima.js, uguale per
-- il sito e per il prerender.
-- ---------------------------------------------------------------------------
create or replace function public.anteprima_testo(s text, b text)
returns text
language sql
immutable
as $$
  select case when t = '' then ''
              else left(t, least(600, greatest(160, length(t) / 3)))
         end
  from (
    select btrim(coalesce(
      nullif(btrim(
        replace(replace(replace(replace(replace(replace(
          regexp_replace(
            regexp_replace(
              regexp_replace(coalesce(b, ''), '</(p|div|h[1-6]|li|blockquote)>|<br[^>]*>', E'\n', 'gi'),
              '<[^>]*>', '', 'g'),
            E'[ \\t]*\\n[\\s]*', E'\n', 'g'),
          '&nbsp;', ' '), '&quot;', '"'), '&#39;', ''''), '&lt;', '<'), '&gt;', '>'), '&amp;', '&')
      ), ''),
      btrim(coalesce(s, ''))
    )) as t
  ) x
$$;

alter table public.news
  add column if not exists anteprima text
  generated always as (public.anteprima_testo(summary, body)) stored;

comment on column public.news.anteprima is
  'Inizio dell''articolo in testo semplice, calcolato dal database. E'' la parte che vede chi non ha fatto l''accesso.';

-- Fa rileggere a Supabase l'elenco delle tabelle e delle colonne.
notify pgrst, 'reload schema';

-- ---------------------------------------------------------------------------
-- Controllo finale: deve mostrare tre righe "ok".
-- ---------------------------------------------------------------------------
select 'tabella lettori' as controllo,
       case when to_regclass('public.lettori') is not null then 'ok' else 'MANCA' end as stato
union all
select 'tabella codici_accesso',
       case when to_regclass('public.codici_accesso') is not null then 'ok' else 'MANCA' end
union all
select 'colonna news.anteprima',
       case when exists (select 1 from information_schema.columns
                          where table_schema = 'public' and table_name = 'news' and column_name = 'anteprima')
            then 'ok (' || (select count(*) from public.news where coalesce(anteprima, '') <> '')::text || ' articoli con anteprima)'
            else 'MANCA' end;
