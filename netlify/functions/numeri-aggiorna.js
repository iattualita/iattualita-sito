// netlify/functions/numeri-aggiorna.js
// POST con Authorization: Bearer <token redazione>.
// Aggiorna subito i numeri automatici, senza aspettare la notte: serve dopo
// aver configurato le chiavi, per vedere se funzionano.
const L = require("./_newsletter-lib");
const N = require("./_numeri-lib");

exports.handler = async (event) => {
  if (event.httpMethod !== "POST") return L.json(405, { error: "method" });
  if (!L.config.SERVICE_ROLE) return L.json(500, { error: "config", message: "Manca la chiave di Supabase nelle variabili d'ambiente." });

  const auth = (event.headers && (event.headers.authorization || event.headers.Authorization)) || "";
  const user = await L.redazioneUser(auth.replace(/^Bearer\s+/i, ""));
  if (!user) return L.json(401, { error: "auth", message: "Sessione scaduta: rifai l'accesso in redazione." });
  if (L.isGiornalista(user)) return L.json(403, { error: "ruolo", message: "I numeri li aggiornano i soci." });

  try {
    return L.json(200, { ok: true, esito: await N.aggiornaTutto() });
  } catch (e) {
    return L.json(500, { error: "server", message: String(e.message || e) });
  }
};
