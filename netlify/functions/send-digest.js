// netlify/functions/send-digest.js
// POST {dry:true|false} con Authorization: Bearer <token redazione>.
// dry=true: risponde con conteggi (anteprima). dry=false: invia davvero.
const L = require("./_newsletter-lib");

exports.handler = async (event) => {
  if (event.httpMethod !== "POST") return L.json(405, { error: "method" });
  if (!L.config.SERVICE_ROLE || !L.config.BREVO_API_KEY)
    return L.json(500, { error: "config", message: "Chiavi mancanti nelle variabili d'ambiente." });

  const auth = (event.headers && (event.headers.authorization || event.headers.Authorization)) || "";
  const bearer = auth.replace(/^Bearer\s+/i, "");
  if (!(await L.verifyRedazione(bearer)))
    return L.json(401, { error: "auth", message: "JWT non valido o scaduto: rifai l'accesso in redazione." });

  let dry = true;
  try { dry = JSON.parse(event.body || "{}").dry !== false; } catch (e) {}

  try {
    const out = await L.runDigest({ dry });
    return L.json(200, out);
  } catch (e) {
    return L.json(500, { error: "server", message: String(e.message || e) });
  }
};
