// netlify/functions/unsubscribe.js
// GET ?token=...  ->  disiscrive e mostra una pagina di esito.
const L = require("./_newsletter-lib");

exports.handler = async (event) => {
  const token = (event.queryStringParameters || {}).token || "";
  if (!token)
    return L.html(400, L.page("Link non valido", "Manca il codice. Apri il link direttamente dall'email che hai ricevuto."));

  try {
    const sub = await L.sbSelectByToken(token);
    if (!sub)
      return L.html(404, L.page("Link non valido", "Non troviamo questa iscrizione. Forse eri già disiscritto."));

    if (sub.status === "unsubscribed")
      return L.html(200, L.page("Già disiscritto", "Non riceverai più la newsletter. Puoi tornare quando vuoi."));

    await L.sbPatch(sub.id, { status: "unsubscribed", unsubscribed_at: new Date().toISOString() });
    return L.html(200, L.page("Disiscrizione completata", "Non riceverai più la newsletter di Iattualità. Ci dispiace vederti andare: puoi re-iscriverti quando vuoi dal sito."));
  } catch (e) {
    return L.html(500, L.page("Qualcosa è andato storto", "Riprova tra poco."));
  }
};
