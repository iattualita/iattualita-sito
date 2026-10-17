-- ============================================================================
-- Invii speciali: email decise dalla redazione, fuori dal digest settimanale,
-- con contenuti che sul sito non ci sono (un video caricato, un articolo
-- riservato, un messaggio agli iscritti).
--
-- DA ESEGUIRE UNA VOLTA SOLA nel SQL Editor di Supabase.
-- (Dashboard Supabase -> SQL Editor -> New query -> incolla -> Run)
--
-- Crea tre cose:
--   1. newsletter_specials            -> i singoli invii (bozze e inviati)
--   2. newsletter_special_deliveries  -> chi ha gia' ricevuto quale invio
--   3. il bucket privato "riservati"  -> dove stanno i video
--
-- Si puo' rieseguire senza danni: ogni istruzione controlla prima se
-- l'oggetto esiste gia'.
-- ============================================================================

-- ---------------------------------------------------------------------------
-- 1. Gli invii speciali
-- ---------------------------------------------------------------------------
create table if not exists public.newsletter_specials (
  id               uuid primary key default gen_random_uuid(),
  created_at       timestamptz not null default now(),
  updated_at       timestamptz not null default now(),
  subject          text not null default '',   -- oggetto dell'email
  intro            text not null default '',   -- messaggio agli iscritti, testo semplice
  video_path       text,                       -- percorso del video nel bucket privato "riservati"
  cover_url        text,                       -- fotogramma del video, pulito: copertina del lettore
  email_image_url  text,                       -- stesso fotogramma con il tasto play disegnato sopra: va nell'email
  article_title    text,                       -- articolo riservato, opzionale
  article_body     text,                       -- HTML dell'editor; viene sanificato quando si mostra
  status           text not null default 'draft'
                   check (status in ('draft', 'sending', 'sent')),
  sent_at          timestamptz,
  recipients       integer
);

alter table public.newsletter_specials enable row level security;

-- La redazione accede con il proprio account Supabase, come per gli articoli.
-- Chi visita il sito non vede nulla: la pagina riservata legge questa
-- tabella dal server, con la service_role, dopo aver controllato l'iscritto.
drop policy if exists "redazione gestisce gli invii speciali" on public.newsletter_specials;
create policy "redazione gestisce gli invii speciali"
  on public.newsletter_specials
  for all
  to authenticated
  using (true)
  with check (true);

-- ---------------------------------------------------------------------------
-- 2. Registro delle consegne
--
-- Una riga per ogni iscritto servito. E' cio' che rende l'invio ripartibile:
-- se si interrompe a meta', alla ripresa chi e' gia' nel registro viene
-- saltato e nessuno riceve la stessa email due volte.
-- ---------------------------------------------------------------------------
create table if not exists public.newsletter_special_deliveries (
  special_id     uuid not null references public.newsletter_specials(id) on delete cascade,
  subscriber_id  uuid not null references public.subscribers(id) on delete cascade,
  sent_at        timestamptz not null default now(),
  primary key (special_id, subscriber_id)
);

-- Nessuna policy: solo il server (service_role) legge e scrive.
alter table public.newsletter_special_deliveries enable row level security;

-- ---------------------------------------------------------------------------
-- Permessi sulle tabelle
--
-- La RLS dice QUALI righe si vedono; i GRANT dicono se il ruolo puo'
-- toccare la tabella. Su questo progetto le tabelle nuove non ricevono
-- i permessi in automatico: senza queste righe la redazione riceve
-- "permission denied for table newsletter_specials" (42501).
-- ---------------------------------------------------------------------------
grant select, insert, update, delete on public.newsletter_specials           to authenticated, service_role;
grant select, insert, update, delete on public.newsletter_special_deliveries to service_role;

-- Fa rileggere a Supabase l'elenco delle tabelle, cosi' le vede subito.
notify pgrst, 'reload schema';

-- ---------------------------------------------------------------------------
-- 3. Bucket privato per i video
--
-- Privato vuol dire che non esiste un indirizzo pubblico del file. Il video
-- si vede solo dalla pagina riservata, che lo apre con un link temporaneo
-- (scade dopo qualche ora) e solo a chi risulta iscritto.
--
-- 50 MB e' il tetto per file del piano gratuito di Supabase. Passando al
-- piano Pro si puo' alzare qui (file_size_limit, in byte).
-- ---------------------------------------------------------------------------
insert into storage.buckets (id, name, public, file_size_limit, allowed_mime_types)
values ('riservati', 'riservati', false, 52428800,
        array['video/mp4', 'video/quicktime', 'video/webm'])
on conflict (id) do nothing;

drop policy if exists "redazione carica i video riservati"   on storage.objects;
drop policy if exists "redazione legge i video riservati"    on storage.objects;
drop policy if exists "redazione modifica i video riservati" on storage.objects;
drop policy if exists "redazione elimina i video riservati"  on storage.objects;

create policy "redazione carica i video riservati"
  on storage.objects for insert to authenticated
  with check (bucket_id = 'riservati');

create policy "redazione legge i video riservati"
  on storage.objects for select to authenticated
  using (bucket_id = 'riservati');

create policy "redazione modifica i video riservati"
  on storage.objects for update to authenticated
  using (bucket_id = 'riservati');

create policy "redazione elimina i video riservati"
  on storage.objects for delete to authenticated
  using (bucket_id = 'riservati');
