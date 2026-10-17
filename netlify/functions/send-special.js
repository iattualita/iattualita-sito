// netlify/functions/send-special.js
// Invio speciale agli iscritti, comandato dalla redazione.
//
// POST { id, mode } con Authorization: Bearer <token redazione>
//   mode "test" -> manda una prova all'indirizzo di chi e' collegato
//   mode "dry"  -> conta iscritti e controlla che l'invio sia completo
//   mode "send" -> spedisce un blocco di iscritti e dice quanti ne restano
//
// L'invio vero e proprio va richiamato finche' non risponde done:true,
// esattamente come il digest: lo fa il pulsante in redazione.
const L = require("./_newsletter-lib");
const S = require("./_speciali-lib");

exports.handler = async (event) => {
  if (event.httpMethod !== "POST") return L.json(405, { error: "method" });
  if (!L.config.SERVICE_ROLE || !L.config.BREVO_API_KEY)
    return L.json(500, { error: "config", message: "Chiavi mancanti nelle variabili d'ambiente." });

  const auth = (event.headers && (event.headers.authorization || event.headers.Authorization)) || "";
  const user = await L.redazioneUser(auth.replace(/^Bearer\s+/i, ""));
  if (!user) return L.json(401, { error: "auth", message: "JWT non valido o scaduto: rifai l'accesso in redazione." });

  let body = {};
  try { body = JSON.parse(event.body || "{}"); } catch (e) { return L.json(400, { error: "body" }); }
  if (!S.isUuid(body.id)) return L.json(400, { error: "id", message: "Invio speciale non indicato: salvalo prima." });

  try {
    if (body.mode === "test") {
      const out = await S.sendTest(body.id, user.email);
      if (out.notFound) return L.json(404, { error: "not_found", message: "Invio speciale non trovato." });
      return L.json(out.ok ? 200 : 400, out.ok ? out : { error: "content", message: out.reason });
    }
    const out = await S.runSpecial({ id: body.id, dry: body.mode !== "send" });
    if (out.notFound) return L.json(404, { error: "not_found", message: "Invio speciale non trovato." });
    return L.json(200, out);
  } catch (e) {
    return L.json(500, { error: "server", message: String(e.message || e) });
  }
};
