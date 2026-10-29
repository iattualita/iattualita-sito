-- ============================================================================
-- Chiude il testo integrale degli articoli a chi non ha fatto l'accesso.
--
-- DA ESEGUIRE UNA VOLTA SOLA nel SQL Editor di Supabase, e SOLO DOPO che il
-- sito aggiornato (quello con l'accesso dei lettori) e' online.
-- Si puo' rieseguire senza danni.
--
-- ORDINE:
--   1. 005_accesso_lettori.sql   (aggiunge, non rompe niente)
--   2. pubblica il sito nuovo    (merge della modifica su GitHub)
--   3. questa                    (da qui in poi il testo e' chiuso davvero)
--
-- Eseguita prima del punto 2, il sito vecchio smette di mostrare gli
-- articoli: chiede il testo con la chiave pubblica e si vede rispondere
-- "permission denied".
--
-- COSA FA
-- Finora la chiave pubblica del sito (ruolo "anon") poteva leggere tutta la
-- tabella news, compresi body (il testo HTML) e summary (lo stesso testo
-- senza formattazione). Bastava aprire gli strumenti sviluppatore del
-- browser per leggere qualunque articolo. Nascondere il testo solo nella
-- pagina non sarebbe servito a niente.
--
-- Da qui in poi "anon" puo' leggere tutte le colonne TRANNE body e summary.
-- Il testo integrale lo legge solo il server (service_role), e lo consegna
-- a chi ha fatto l'accesso. La redazione (ruolo "authenticated") non cambia.
--
-- SE UN GIORNO AGGIUNGI UNA COLONNA A news
-- Il permesso e' colonna per colonna: una colonna nuova NON e' leggibile dal
-- pubblico finche' non la apri. Riesegui questo file (apre tutte le colonne
-- tranne body e summary) oppure scrivi:
--   grant select (nome_colonna) on public.news to anon;
-- Il sito, se chiede una colonna chiusa, riceve "permission denied".
-- ============================================================================

do $$
declare
  col record;
begin
  -- Via il permesso su tutta la tabella...
  execute 'revoke select on public.news from anon';

  -- ...e di nuovo, colonna per colonna, tutte tranne le due col testo.
  for col in
    select column_name
      from information_schema.columns
     where table_schema = 'public'
       and table_name   = 'news'
       and column_name not in ('body', 'summary')
  loop
    execute format('grant select (%I) on public.news to anon', col.column_name);
  end loop;
end
$$;

-- La redazione e il server continuano a leggere e scrivere tutto. Sono gia'
-- cosi', ma lo si ribadisce: questo file non deve toglierlo per sbaglio.
-- I limiti del ruolo giornalista sono nelle policy RLS (004) e restano.
grant select, insert, update, delete on public.news to authenticated, service_role;

notify pgrst, 'reload schema';

-- ---------------------------------------------------------------------------
-- Controllo finale. Le prime due righe devono dire "chiuso", le altre "aperto".
-- ---------------------------------------------------------------------------
select 'pubblico legge body'      as controllo,
       case when has_column_privilege('anon', 'public.news', 'body', 'SELECT')    then 'ATTENZIONE: ancora aperto' else 'chiuso' end as stato
union all
select 'pubblico legge summary',
       case when has_column_privilege('anon', 'public.news', 'summary', 'SELECT') then 'ATTENZIONE: ancora aperto' else 'chiuso' end
union all
select 'pubblico legge title',
       case when has_column_privilege('anon', 'public.news', 'title', 'SELECT')     then 'aperto' else 'ATTENZIONE: chiuso' end
union all
select 'pubblico legge anteprima',
       case when has_column_privilege('anon', 'public.news', 'anteprima', 'SELECT') then 'aperto' else 'ATTENZIONE: chiuso (hai eseguito la 005?)' end
union all
select 'redazione legge body',
       case when has_column_privilege('authenticated', 'public.news', 'body', 'SELECT') then 'aperto' else 'ATTENZIONE: chiuso' end;
