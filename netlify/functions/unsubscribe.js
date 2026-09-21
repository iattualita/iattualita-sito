// netlify/functions/unsubscribe.js
// Disiscrizione dalla newsletter.
//
//   GET  ?token=...  ->  mostra la pagina con il pulsante di conferma
//   POST ?token=...  ->  disiscrive davvero
//
// Perche' la GET non disiscrive: i filtri antivirus aziendali e i
// precaricatori dei client di posta aprono da soli i link delle email. Con la
// disiscrizione sulla GET, un lettore poteva ritrovarsi fuori dalla lista
// senza aver cliccato niente.
//
// La POST invece non serve solo al pulsante: e' anche la richiesta che Gmail
// e Yahoo inviano da soli quando il lettore usa "Annulla iscrizione" accanto
// al mittente, grazie agli header List-Unsubscribe che brevoSend allega al
// digest. In quel caso la conferma l'ha gia' chiesta il gestore di posta, e
// infatti la disiscrizione parte subito (RFC 8058).
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

    if (event.httpMethod !== "POST")
      return L.html(200, L.page(
        "Vuoi disiscriverti?",
        "Premi il pulsante per non ricevere più la newsletter di Iattualità. Se sei finito qui per sbaglio, puoi semplicemente chiudere questa pagina.",
        { url: L.SITE_URL + "/.netlify/functions/unsubscribe?token=" + encodeURIComponent(token), label: "Sì, disiscrivimi" }
      ));

    await L.sbPatch(sub.id, { status: "unsubscribed", unsubscribed_at: new Date().toISOString() });
    return L.html(200, L.page("Disiscrizione completata", "Non riceverai più la newsletter di Iattualità. Ci dispiace vederti andare: puoi re-iscriverti quando vuoi dal sito."));
  } catch (e) {
    return L.html(500, L.page("Qualcosa è andato storto", "Riprova tra poco."));
  }
};
