// netlify/functions/confirm.js
// GET ?token=...  ->  segna l'iscritto come confermato e mostra una pagina di esito.
const L = require("./_newsletter-lib");

exports.handler = async (event) => {
  const token = (event.queryStringParameters || {}).token || "";
  if (!token)
    return L.html(400, L.page("Link non valido", "Manca il codice di conferma. Prova a iscriverti di nuovo dal sito."));

  try {
    const sub = await L.sbSelectByToken(token);
    if (!sub)
      return L.html(404, L.page("Link non valido o scaduto", "Non troviamo questa iscrizione. Prova a iscriverti di nuovo dal sito."));

    if (sub.status === "confirmed")
      return L.html(200, L.page("Sei già iscritto", "La tua iscrizione era già confermata. Riceverai la newsletter di Iattualità."));

    await L.sbPatch(sub.id, { status: "confirmed", confirmed_at: new Date().toISOString(), unsubscribed_at: null });
    return L.html(200, L.page("Iscrizione confermata", "Ci sei. Da ora riceverai la newsletter di Iattualità: gli articoli nuovi, raccolti una volta a settimana."));
  } catch (e) {
    return L.html(500, L.page("Qualcosa è andato storto", "Riprova tra poco. Se il problema resta, scrivici."));
  }
};
