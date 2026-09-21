-- ============================================================================
-- Ricorda a chi la newsletter di questa settimana e' gia' stata spedita.
--
-- DA ESEGUIRE UNA VOLTA SOLA nel SQL Editor di Supabase.
--
-- Perche' serve: l'invio scriveva "fatto" nel registro solo alla fine, dopo
-- l'ultimo iscritto. Se si interrompeva a meta' (la funzione serverless ha
-- pochi secondi di tempo), il registro restava vuoto: al tentativo successivo
-- la data di partenza era la stessa e la stessa mail ripartiva verso tutti,
-- compresi quelli che l'avevano gia' ricevuta.
--
-- Con questa colonna l'invio diventa ripartibile: si spedisce a blocchi e
-- chi ha gia' ricevuto viene saltato, qualunque cosa sia successa prima.
--
-- Il valore NULL sulle righe esistenti e' corretto: significa "non ha ancora
-- ricevuto nessun digest", quindi al primo invio dopo questa modifica
-- rientrano tutti, come e' giusto.
-- ============================================================================

alter table public.subscribers
  add column if not exists last_digest_at timestamptz;

comment on column public.subscribers.last_digest_at is
  'Quando a questo iscritto e'' stato spedito l''ultimo digest. Serve a non spedirglielo due volte se un invio si interrompe a meta''.';

-- L'invio filtra gli iscritti confermati; l'indice tiene la query veloce
-- anche quando la lista cresce.
create index if not exists subscribers_status_digest_idx
  on public.subscribers (status, last_digest_at);
