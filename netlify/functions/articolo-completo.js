// netlify/functions/articolo-completo.js
// GET ?id=<articolo>  ->  { id, body } per chi ha fatto l'accesso, altrimenti 401.
// Eccezione: le rubriche libere (TG e meteo) si consegnano a tutti.
//
// Dopo la migrazione 006 il testo integrale degli articoli (body e summary)
// non e' piu' leggibile con la chiave pubblica del sito: lo legge solo il
// server, e questa funzione lo consegna a chi ha una sessione valida.
//
// La redazione non passa di qui: legge il testo direttamente da Supabase con
// il proprio accesso, come prima.
const A = require("./_lettori-lib");
const L = require("./_newsletter-lib");

const esc = (s) => String(s || "").replace(/&/g, "&amp;").replace(/</g, "&lt;").replace(/>/g, "&gt;");

exports.handler = async (event) => {
  if (event.httpMethod !== "GET") return A.risposta(405, { error: "method" });
  if (!L.config.SERVICE_ROLE || !A.config.SECRET) return A.risposta(500, { error: "config" });

  const id = String((event.queryStringParameters || {}).id || "");
  if (!A.isUuid(id)) return A.risposta(404, { error: "articolo" });

  const sessione = A.sessioneDaRichiesta(event);

  // Gli articoli piu' vecchi possono avere solo summary, senza HTML.
  const corpo = (articolo) =>
    String(articolo.body || "").trim()
      ? articolo.body
      : esc(articolo.summary).split(/\n+/).filter(Boolean).map((p) => "<p>" + p + "</p>").join("");

  try {
    // Senza accesso: si consegna il testo solo delle rubriche libere (TG e
    // meteo, vedi RUBRICHE in shared/site-pages.js). Per tutto il resto 401
    // come sempre, e nessun cookie viene toccato oltre a quello di uscita.
    if (!sessione) {
      const articolo = await A.articoloCompleto(id);
      if (articolo && A.serieLibera(articolo.serie)) return A.risposta(200, { id: articolo.id, body: corpo(articolo) });
      return A.risposta(401, { error: "sessione" }, A.cookieUscita());
    }

    const [lettore, articolo] = await Promise.all([A.lettorePerId(sessione.id), A.articoloCompleto(id)]);
    // Account cancellato: il cookie era valido, ma la persona non c'e' piu'.
    if (!lettore) return A.risposta(401, { error: "sessione" }, A.cookieUscita());
    if (!articolo) return A.risposta(404, { error: "articolo" });

    const body = corpo(articolo);

    // Chi torna a leggere non deve rifare l'accesso: a meno di due mesi
    // dalla scadenza il cookie si rinnova per altri sei.
    const rinnova = sessione.exp - Math.floor(Date.now() / 1000) < A.RINNOVA_SOTTO_S;
    return A.risposta(200, { id: articolo.id, body }, rinnova ? A.cookieAccesso(lettore.id) : null);
  } catch (e) {
    console.error("articolo-completo:", e && e.message);
    return A.risposta(500, { error: "server" });
  }
};
