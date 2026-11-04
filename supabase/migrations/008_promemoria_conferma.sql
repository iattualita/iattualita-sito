-- ============================================================================
-- Promemoria a chi si e' iscritto alla newsletter ma non ha mai confermato.
--
-- DA ESEGUIRE UNA VOLTA SOLA nel SQL Editor di Supabase, prima di usare il
-- pulsante "Promemoria conferma" in redazione. Si puo' rieseguire senza danni.
--
-- Chi non ha confermato non ha ancora dato il consenso: gli si puo' scrivere
-- UNA volta, solo per ricordargli di confermare, senza contenuti della
-- newsletter. Questa colonna registra quando il promemoria e' partito, cosi'
-- nessuno lo riceve due volte, nemmeno premendo il pulsante piu' volte.
-- ============================================================================

alter table public.subscribers
  add column if not exists promemoria_at timestamptz;

comment on column public.subscribers.promemoria_at is
  'Quando e'' stato mandato il promemoria di conferma (una volta sola). NULL = mai.';

notify pgrst, 'reload schema';

-- Controllo: quanti iscritti in attesa di conferma riceveranno il promemoria.
select count(*) as in_attesa_senza_promemoria
  from public.subscribers
 where status = 'pending' and promemoria_at is null;
