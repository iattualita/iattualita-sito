// netlify/functions/confirm.js
// Conferma l'iscrizione (doppio opt-in).
//
//   GET  ?token=...  ->  mostra la pagina con il pulsante di conferma
//   POST ?token=...  ->  conferma davvero
//
// La conferma sta sulla POST e non sulla GET perche' i filtri antivirus
// aziendali e i precaricatori dei client di posta aprono da soli i link delle
// email. Se bastasse la GET, quei programmi confermerebbero iscrizioni che
// nessuno ha voluto: il doppio consenso diventerebbe finto, e con lui la base
// giuridica dichiarata nella privacy policy.
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

    if (event.httpMethod !== "POST")
      return L.html(200, L.page(
        "Conferma l'iscrizione",
        "Manca solo un passaggio: premi il pulsante qui sotto e sarai iscritto alla newsletter di Iattualità.",
        { url: L.SITE_URL + "/.netlify/functions/confirm?token=" + encodeURIComponent(token), label: "Confermo l'iscrizione" }
      ));

    await L.sbPatch(sub.id, { status: "confirmed", confirmed_at: new Date().toISOString(), unsubscribed_at: null });
    return L.html(200, L.page("Iscrizione confermata", "Benvenuto tra i lettori di Iattualità. Ogni settimana ti arriverà il meglio, raccolto in una sola email."));
  } catch (e) {
    return L.html(500, L.page("Qualcosa è andato storto", "Riprova tra poco. Se il problema resta, scrivici."));
  }
};
