// netlify/functions/accesso-codice.js
// POST { email, newsletter, website }  ->  manda il codice di accesso a 6 cifre.
//
// Primo passo dell'accesso dei lettori (il secondo e' accesso-verifica.js).
// Vale sia per chi si registra sia per chi rientra: non c'e' differenza, ed
// e' voluto. Chi scrive l'email non deve scoprire se quell'indirizzo e' gia'
// registrato da qualcun altro.
//
// Come subscribe.js, manda una mail vera a ogni chiamata: stessi freni.
//   1. honeypot        -> i bot che compilano ogni campo
//   2. tetto per IP    -> chi ripete la richiesta dalla stessa provenienza
//   3. tetto per email -> il bombardamento di una singola casella
const L = require("./_newsletter-lib");
const A = require("./_lettori-lib");

// Tre codici ogni quarto d'ora allo stesso indirizzo: chi ha sbagliato a
// scrivere o non trova la mail riprova; chi molesta non ottiene di piu'.
const EMAIL_WINDOW_S = 15 * 60;
const EMAIL_MAX      = 3;
const EMAIL_DAY_S    = 24 * 60 * 60;
const EMAIL_DAY_MAX  = 10;

// Largo abbastanza per una famiglia o un ufficio dietro lo stesso IP.
const IP_WINDOW_S = 60 * 60;
const IP_MAX      = 12;

exports.handler = async (event) => {
  if (event.httpMethod !== "POST") return A.risposta(405, { error: "method" });
  if (!A.richiestaDalSito(event)) return A.risposta(403, { error: "origine" });
  if (!L.config.SERVICE_ROLE || !L.config.BREVO_API_KEY || !A.config.SECRET)
    return A.risposta(500, { error: "config", message: "Accesso non configurato: mancano chiavi nelle variabili d'ambiente." });

  const body = A.leggiJson(event);
  if (!body) return A.risposta(400, { error: "body" });

  // Honeypot: si finge che sia andato tutto bene, senza scrivere ne' inviare.
  if (String(body.website || "").trim() !== "") return A.risposta(200, { ok: true });

  const email = String(body.email || "").trim().toLowerCase();
  if (!L.validEmail(email) || email.length > 254)
    return A.risposta(400, { error: "email", message: "Controlla l'indirizzo email." });

  const ip = A.chiaveIp(L.clientIp(event));
  if (!(await L.rateHit("acc:ip:" + ip, IP_WINDOW_S, IP_MAX)))
    return A.risposta(429, { error: "rate", message: "Troppe richieste da questa connessione. Riprova tra un'ora." });

  try {
    // Oltre il tetto per indirizzo si risponde "ok" senza mandare nulla: a
    // schermo il lettore vede "ti abbiamo scritto", e il codice mandato poco
    // prima vale ancora. Chi molesta non distingue un invio da un blocco.
    const okBreve  = await L.rateHit("acc:mail:" + email, EMAIL_WINDOW_S, EMAIL_MAX);
    const okGiorno = await L.rateHit("acc:day:"  + email, EMAIL_DAY_S,    EMAIL_DAY_MAX);
    if (!okBreve || !okGiorno) return A.risposta(200, { ok: true });

    const codice = A.nuovoCodice();
    await A.codiceSalva(email, A.impronta(email, codice), body.newsletter === true);

    // Il codice nell'oggetto: sul telefono si legge gia' dalla notifica,
    // senza aprire l'app di posta e perdere la pagina che si stava leggendo.
    await L.brevoSend(email, codice + " è il tuo codice per IAttualità", A.emailCodiceHtml(codice), null, L.confirmSender);
    return A.risposta(200, { ok: true });
  } catch (e) {
    console.error("accesso-codice:", e && e.message);
    return A.risposta(500, { error: "server", message: "Non siamo riusciti a mandarti il codice. Riprova tra poco." });
  }
};
