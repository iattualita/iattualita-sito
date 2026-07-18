// netlify/functions/subscribe.js
// POST { email }  ->  crea/aggiorna iscritto 'pending' e invia la mail di conferma.
const L = require("./_newsletter-lib");

exports.handler = async (event) => {
  if (event.httpMethod !== "POST") return L.json(405, { error: "method" });
  if (!L.config.SERVICE_ROLE || !L.config.BREVO_API_KEY)
    return L.json(500, { error: "config", message: "Chiavi mancanti nelle variabili d'ambiente." });

  let email = "";
  try { email = (JSON.parse(event.body || "{}").email || "").trim().toLowerCase(); }
  catch (e) { return L.json(400, { error: "body" }); }

  if (!L.validEmail(email)) return L.json(400, { error: "email", message: "Indirizzo non valido." });

  try {
    const existing = await L.sbSelectByEmail(email);

    // Già confermato: non re-inviamo nulla, lo diciamo e basta.
    if (existing && existing.status === "confirmed")
      return L.json(200, { ok: true, state: "already_confirmed" });

    const token = L.newToken();

    if (!existing) {
      await L.sbInsert(email, token);
    } else {
      // pending o unsubscribed -> rimettiamo pending con un token nuovo
      await L.sbPatch(existing.id, { status: "pending", token, confirmed_at: null, unsubscribed_at: null });
    }

    await L.brevoSend(email, "Conferma la tua iscrizione a Iattualità", L.confirmEmailHtml(token));
    return L.json(200, { ok: true, state: existing ? "resent" : "sent" });
  } catch (e) {
    return L.json(500, { error: "server", message: String(e.message || e) });
  }
};
