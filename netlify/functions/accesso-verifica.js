// netlify/functions/accesso-verifica.js
// POST { email, codice }  ->  se il codice e' giusto, apre la sessione.
//
// Secondo passo dell'accesso (il primo e' accesso-codice.js). Se il codice
// combacia:
//   - crea il lettore, o aggiorna l'ultimo accesso se esiste gia'
//   - se nella richiesta del codice era spuntata la newsletter, iscrive
//     l'indirizzo come CONFERMATO: aver digitato il codice ricevuto a
//     quell'indirizzo prova che e' suo, esattamente come il click sul link
//     del doppio opt-in
//   - imposta il cookie di sessione
const L = require("./_newsletter-lib");
const A = require("./_lettori-lib");

// Contro chi prova codici a raffica su tanti indirizzi diversi: il limite
// per indirizzo (5 tentativi per codice) non basterebbe da solo.
const IP_WINDOW_S = 60 * 60;
const IP_MAX      = 40;

const SCADUTO = "Il codice è scaduto o non è più valido. Chiedine uno nuovo.";

exports.handler = async (event) => {
  if (event.httpMethod !== "POST") return A.risposta(405, { error: "method" });
  if (!A.richiestaDalSito(event)) return A.risposta(403, { error: "origine" });
  if (!L.config.SERVICE_ROLE || !A.config.SECRET)
    return A.risposta(500, { error: "config", message: "Accesso non configurato: mancano chiavi nelle variabili d'ambiente." });

  const body = A.leggiJson(event);
  if (!body) return A.risposta(400, { error: "body" });

  const email = String(body.email || "").trim().toLowerCase();
  const codice = String(body.codice || "").replace(/\D/g, "");
  if (!L.validEmail(email) || codice.length !== 6)
    return A.risposta(400, { error: "codice", message: "Il codice è di 6 cifre." });

  const ip = A.chiaveIp(L.clientIp(event));
  if (!(await L.rateHit("ver:ip:" + ip, IP_WINDOW_S, IP_MAX)))
    return A.risposta(429, { error: "rate", message: "Troppi tentativi da questa connessione. Riprova tra un'ora." });

  try {
    if (Math.random() < 0.05) await A.codiciPulizia();

    // Il tentativo si conta PRIMA del confronto, in modo atomico: anche
    // decine di richieste in parallelo ne consumano uno ciascuna.
    const riga = await A.codiceTentativo(email);
    if (!riga) {
      await A.codiceCancella(email);   // scaduto o esaurito: via, se c'e' ancora
      return A.risposta(400, { error: "scaduto", message: SCADUTO });
    }

    const hash = A.impronta(email, codice);
    if (!A.confrontaImpronta(riga.code_hash, hash)) {
      const restanti = A.CODICE_TENTATIVI - riga.tentativi;
      if (restanti <= 0) {
        await A.codiceCancella(email);
        return A.risposta(400, { error: "scaduto", message: "Codice sbagliato troppe volte. Chiedine uno nuovo." });
      }
      return A.risposta(400, {
        error: "codice",
        message: "Codice sbagliato. Controlla l'ultima email che ti abbiamo mandato" + (restanti <= 2 ? " (ancora " + restanti + (restanti === 1 ? " tentativo)." : " tentativi).") : "."),
        restanti
      });
    }

    // Il codice si usa una volta sola, anche con due richieste simultanee.
    if (!(await A.codiceConsuma(email, hash)))
      return A.risposta(400, { error: "scaduto", message: SCADUTO });

    const lettore = await A.lettoreAccesso(email);
    if (!lettore || !lettore.id) throw new Error("lettore non creato");

    // La newsletter e' un di piu': se l'iscrizione fallisce, l'accesso resta
    // valido e lo si dice, invece di bloccare la lettura per questo.
    let newsletter = null;
    if (riga.newsletter) {
      try { newsletter = await A.newsletterIscrivi(email); }
      catch (e) { console.error("accesso-verifica, newsletter:", e && e.message); newsletter = "errore"; }
    }

    return A.risposta(200, { ok: true, newsletter }, A.cookieAccesso(lettore.id));
  } catch (e) {
    console.error("accesso-verifica:", e && e.message);
    return A.risposta(500, { error: "server", message: "Qualcosa è andato storto. Riprova tra poco." });
  }
};
