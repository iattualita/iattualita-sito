// netlify/functions/subscribe.js
// POST { email }  ->  crea/aggiorna iscritto 'pending' e invia la mail di conferma.
//
// Questa funzione manda una mail vera a ogni chiamata, quindi e' il punto piu'
// esposto del sito: senza freni chiunque puo' usarla per intasare la casella di
// un'altra persona o per bruciare la quota Brevo. I freni sono tre:
//   1. honeypot   -> ferma i bot che compilano tutti i campi del form
//   2. tetto per IP    -> ferma chi ripete la richiesta dalla stessa provenienza
//   3. tetto per email -> ferma il bombardamento di una singola casella
// I contatori stanno su Supabase (vedi supabase/migrations/001_rate_limit.sql).
const L = require("./_newsletter-lib");

// Una mail di conferma ogni 15 minuti allo stesso indirizzo. Chi non l'ha
// ricevuta la riprova dopo; chi vuole molestarlo non ottiene di meglio.
const EMAIL_WINDOW_S = 15 * 60;
const EMAIL_MAX      = 1;

// E comunque non piu' di 4 al giorno allo stesso indirizzo, altrimenti bastava
// aspettare il quarto d'ora per riprendere a bombardare.
const EMAIL_DAY_S    = 24 * 60 * 60;
const EMAIL_DAY_MAX  = 4;

// Tetto per provenienza: ferma chi genera indirizzi inventati a raffica per
// riempire la tabella e consumare la quota Brevo. Largo abbastanza da non
// disturbare una famiglia o un ufficio dietro lo stesso IP.
const IP_WINDOW_S = 60 * 60;
const IP_MAX      = 8;

exports.handler = async (event) => {
  if (event.httpMethod !== "POST") return L.json(405, { error: "method" });
  if (!L.config.SERVICE_ROLE || !L.config.BREVO_API_KEY)
    return L.json(500, { error: "config", message: "Chiavi mancanti nelle variabili d'ambiente." });

  let body = {};
  try { body = JSON.parse(event.body || "{}"); }
  catch (e) { return L.json(400, { error: "body" }); }

  // 1. Honeypot: campo invisibile ai lettori, irresistibile per i bot che
  // compilano ogni input del form. Se e' pieno rispondiamo come se tutto
  // fosse andato bene, senza scrivere nulla e senza inviare nulla: il bot
  // non impara di essere stato scoperto e non riprova con altri trucchi.
  if (String(body.website || "").trim() !== "")
    return L.json(200, { ok: true, state: "sent" });

  const email = String(body.email || "").trim().toLowerCase();
  if (!L.validEmail(email)) return L.json(400, { error: "email", message: "Indirizzo non valido." });

  // 2. Tetto per provenienza.
  const ip = L.clientIp(event);
  if (!(await L.rateHit("sub:ip:" + ip, IP_WINDOW_S, IP_MAX)))
    return L.json(429, {
      error: "rate",
      message: "Troppe richieste da questa connessione. Riprova tra un'ora."
    });

  try {
    const existing = await L.sbSelectByEmail(email);

    // Già confermato: non re-inviamo nulla, lo diciamo e basta.
    // Sta prima dei limiti per email perche' qui non parte nessun messaggio:
    // non ha senso consumare il contatore di chi e' gia' a posto.
    if (existing && existing.status === "confirmed")
      return L.json(200, { ok: true, state: "already_confirmed" });

    // 3. Tetto per indirizzo: la difesa vera contro il bombardamento, perche'
    // vale anche se l'attaccante cambia IP a ogni richiesta.
    //
    // Quando scatta rispondiamo "ok" invece di un errore: per chi si e'
    // appena iscritto e ha ricambiato idea sul pulsante, la mail e' gia'
    // partita, quindi il messaggio a schermo e' corretto. Per chi sta
    // molestando qualcuno, non c'e' modo di distinguere un invio riuscito da
    // uno bloccato, e quindi nemmeno di capire ogni quanto ritentare.
    const okMinute = await L.rateHit("sub:mail:" + email, EMAIL_WINDOW_S, EMAIL_MAX);
    const okDay    = await L.rateHit("sub:day:"  + email, EMAIL_DAY_S,    EMAIL_DAY_MAX);
    if (!okMinute || !okDay)
      return L.json(200, { ok: true, state: existing ? "resent" : "sent" });

    const token = L.newToken();

    if (!existing) {
      await L.sbInsert(email, token);
    } else {
      // pending o unsubscribed -> rimettiamo pending con un token nuovo
      await L.sbPatch(existing.id, { status: "pending", token, confirmed_at: null, unsubscribed_at: null });
    }

    // Oggetto corto e senza nome del brand + mittente dedicato: entrambi
    // riducono la probabilita' che Gmail smisti la conferma in Promozioni.
    await L.brevoSend(email, "Conferma il tuo indirizzo", L.confirmEmailHtml(token), null, L.confirmSender);
    return L.json(200, { ok: true, state: existing ? "resent" : "sent" });
  } catch (e) {
    return L.json(500, { error: "server", message: String(e.message || e) });
  }
};
