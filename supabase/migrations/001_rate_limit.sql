-- ============================================================================
-- Contatore per limitare gli abusi sul form di iscrizione alla newsletter.
--
-- DA ESEGUIRE UNA VOLTA SOLA, incollandolo nel SQL Editor di Supabase.
-- (Dashboard Supabase -> SQL Editor -> New query -> incolla -> Run)
--
-- Perche' serve: subscribe.js manda una mail vera a ogni richiesta. Senza un
-- contatore, chiunque puo' iscrivere ripetutamente l'indirizzo di un'altra
-- persona per intasarle la casella, oppure bruciare la quota Brevo con
-- migliaia di indirizzi inventati.
--
-- Finche' questa tabella non esiste, subscribe.js continua a funzionare
-- normalmente ma senza protezione (fail-open): meglio un'iscrizione in piu'
-- che un lettore vero bloccato da un errore di configurazione.
-- ============================================================================

create table if not exists public.rate_limit (
  key          text primary key,
  hits         integer     not null default 0,
  window_start timestamptz not null default now()
);

-- Nessuna policy: la tabella resta invisibile al pubblico. Solo la
-- service_role, che usa la funzione serverless, scavalca la RLS.
alter table public.rate_limit enable row level security;

-- ----------------------------------------------------------------------------
-- rate_hit(chiave, durata_finestra_in_secondi, tetto_massimo)
--
-- Registra un tentativo e dice se e' consentito. Tutto in una sola query
-- atomica: due richieste simultanee non possono scavalcare il limite
-- leggendo entrambe lo stesso contatore prima di scriverlo.
--
-- Ritorna true  -> sotto il limite, si procede
--         false -> limite superato, si rifiuta
-- ----------------------------------------------------------------------------
create or replace function public.rate_hit(
  k               text,
  window_seconds  integer,
  max_hits        integer
) returns boolean
language plpgsql
as $$
declare
  cur_hits integer;
begin
  insert into public.rate_limit as r (key, hits, window_start)
  values (k, 1, now())
  on conflict (key) do update
    set hits = case
                 when r.window_start < now() - make_interval(secs => window_seconds)
                 then 1                 -- finestra scaduta: si riparte da capo
                 else r.hits + 1
               end,
        window_start = case
                 when r.window_start < now() - make_interval(secs => window_seconds)
                 then now()
                 else r.window_start
               end
  returning r.hits into cur_hits;

  -- Pulizia opportunistica: una volta su cento butta via le righe vecchie,
  -- cosi' la tabella non cresce all'infinito senza bisogno di un cron.
  if random() < 0.01 then
    delete from public.rate_limit where window_start < now() - interval '1 day';
  end if;

  return cur_hits <= max_hits;
end;
$$;

-- La funzione la chiama solo il server con la service_role.
revoke all on function public.rate_hit(text, integer, integer) from public, anon, authenticated;
