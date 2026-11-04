-- ============================================================================
-- Mail di benvenuto: parte una volta sola, la prima volta che un indirizzo
-- diventa iscritto confermato.
--
-- DA ESEGUIRE UNA VOLTA SOLA nel SQL Editor di Supabase, PRIMA di pubblicare
-- il sito con la mail di benvenuto. Si puo' rieseguire senza danni.
--
-- benvenuto_at registra quando e' partita. Chi e' gia' iscritto (o lo e'
-- stato e si e' disiscritto) viene segnato adesso come "gia' accolto": cosi'
-- il benvenuto arriva solo ai veri nuovi iscritti, non a chi c'era gia' ne'
-- a chi si reiscrive dopo essersene andato.
-- ============================================================================

alter table public.subscribers
  add column if not exists benvenuto_at timestamptz;

comment on column public.subscribers.benvenuto_at is
  'Quando e'' partita la mail di benvenuto (una volta sola). NULL = non ancora.';

update public.subscribers
   set benvenuto_at = coalesce(confirmed_at, now())
 where benvenuto_at is null
   and status in ('confirmed', 'unsubscribed');

notify pgrst, 'reload schema';

-- Controllo: chi ricevera' il benvenuto quando conferma (gli iscritti in attesa).
select status, count(*) as iscritti, count(benvenuto_at) as gia_accolti
  from public.subscribers
 group by status
 order by status;
