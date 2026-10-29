// netlify/functions/entra.js
// GET ?s=<iscritto>&e=<scadenza>&f=<firma>&a=<articolo>
//
// Il link degli articoli dentro la newsletter. Chi lo apre entra sul sito
// gia' riconosciuto, senza codice, e finisce sull'articolo.
//
// Se il link non e' valido (scaduto, firma sbagliata, iscritto che si e'
// disiscritto) non c'e' nessun errore: si va all'articolo come chiunque, e
// li' il modulo di accesso chiede il codice. Chi ha cliccato da una mail non
// deve mai trovarsi davanti a una pagina di errore.
//
// Gli antivirus delle email aprono da soli i link per controllarli: qui non
// fa danni, apre una sessione in un browser che nessuno usa.
const L = require("./_newsletter-lib");
const A = require("./_lettori-lib");

// Solo indirizzi interni di articoli: un parametro "a" scelto da altri non
// deve poter mandare il lettore su un altro sito.
function destinazione(a) {
  const p = String(a || "");
  return /^\/articolo\/[A-Za-z0-9-]+(\/[A-Za-z0-9-]*)?$/.test(p) ? p : "/";
}

exports.handler = async (event) => {
  const q = event.queryStringParameters || {};
  const vai = (cookies) => {
    const r = {
      statusCode: 302,
      headers: {
        Location: L.SITE_URL + destinazione(q.a),
        "Cache-Control": "private, no-store",
        // Il link contiene la firma personale: non deve finire nel referrer.
        "Referrer-Policy": "no-referrer",
        "X-Robots-Tag": "noindex"
      },
      body: ""
    };
    if (cookies) r.multiValueHeaders = { "Set-Cookie": cookies };
    return r;
  };

  if (!L.config.SERVICE_ROLE || !A.config.SECRET) return vai();
  if (!L.verificaEntra(q.s, q.e, q.f)) return vai();

  try {
    const sub = await L.sbSubscriberById(q.s);
    if (!sub || sub.status !== "confirmed") return vai();
    const lettore = await A.lettoreAccesso(sub.email);
    if (!lettore || !lettore.id) return vai();
    return vai(A.cookieAccesso(lettore.id));
  } catch (e) {
    console.error("entra:", e && e.message);
    return vai();
  }
};
