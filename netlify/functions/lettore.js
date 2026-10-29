// netlify/functions/lettore.js
// La sessione del lettore.
//
//   GET                              -> { ok, email, newsletter } oppure 401
//   POST { azione: "esci" }          -> chiude la sessione su questo browser
//   POST { azione: "newsletter" }    -> iscrive alla newsletter l'email del lettore
//   POST { azione: "elimina" }       -> cancella l'account (non la newsletter)
//
// "elimina" e' il diritto alla cancellazione esercitato con un clic, senza
// dover scrivere alla redazione. La newsletter resta separata: ha il suo
// link di disiscrizione in ogni email, e chi cancella l'account non deve
// perderla per sbaglio, ne' tenerla per sbaglio senza saperlo (glielo si dice).
const A = require("./_lettori-lib");
const L = require("./_newsletter-lib");

exports.handler = async (event) => {
  if (!L.config.SERVICE_ROLE || !A.config.SECRET)
    return A.risposta(500, { error: "config" });

  const sessione = A.sessioneDaRichiesta(event);

  if (event.httpMethod === "POST") {
    if (!A.richiestaDalSito(event)) return A.risposta(403, { error: "origine" });
    const body = A.leggiJson(event) || {};
    const azione = String(body.azione || "");

    // Uscire funziona sempre, anche con un cookie rovinato o scaduto.
    if (azione === "esci") return A.risposta(200, { ok: true }, A.cookieUscita());

    if (!sessione) return A.risposta(401, { error: "sessione" }, A.cookieUscita());

    try {
      const lettore = await A.lettorePerId(sessione.id);
      if (!lettore) return A.risposta(401, { error: "sessione" }, A.cookieUscita());

      if (azione === "newsletter") {
        const stato = await A.newsletterIscrivi(lettore.email);
        return A.risposta(200, { ok: true, newsletter: stato });
      }
      if (azione === "elimina") {
        await A.lettoreCancella(lettore.id);
        return A.risposta(200, { ok: true }, A.cookieUscita());
      }
      return A.risposta(400, { error: "azione" });
    } catch (e) {
      console.error("lettore POST:", e && e.message);
      return A.risposta(500, { error: "server", message: "Qualcosa è andato storto. Riprova tra poco." });
    }
  }

  if (event.httpMethod !== "GET") return A.risposta(405, { error: "method" });
  if (!sessione) return A.risposta(401, { error: "sessione" }, A.cookieUscita());

  try {
    const lettore = await A.lettorePerId(sessione.id);
    if (!lettore) return A.risposta(401, { error: "sessione" }, A.cookieUscita());
    const newsletter = await A.newsletterStato(lettore.email);
    return A.risposta(200, { ok: true, email: lettore.email, newsletter });
  } catch (e) {
    console.error("lettore GET:", e && e.message);
    return A.risposta(500, { error: "server" });
  }
};
