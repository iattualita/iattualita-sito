// netlify/functions/send-promemoria.js
// POST {dry:true|false} con Authorization: Bearer <token redazione>.
//
// Manda UN promemoria a chi si e' iscritto alla newsletter ma non ha mai
// confermato (status 'pending'). Chi non ha confermato non ha dato il
// consenso: gli si scrive una volta sola, solo per ricordargli di confermare.
// promemoria_at (migrazione 008) registra l'invio, cosi' nessuno lo riceve
// due volte, qualunque cosa succeda.
//
//   dry=true  -> conta soltanto quanti lo riceverebbero
//   dry=false -> spedisce al massimo BATCH promemoria e dice quanti restano
//
// Solo i soci: il giornalista non lo vede e non lo puo' usare.
const L = require("./_newsletter-lib");

const BATCH = 25;

async function inAttesa(limit) {
  const r = await fetch(L.REST + "/subscribers?status=eq.pending&promemoria_at=is.null&select=id,email,token&order=id&limit=" + limit, { headers: L.sbHeaders() });
  if (r.status === 400) {
    const e = new Error("Manca la colonna promemoria_at: esegui supabase/migrations/008_promemoria_conferma.sql nel SQL Editor di Supabase.");
    e.config = true;
    throw e;
  }
  if (!r.ok) throw await L.sbError("db select", r);
  return r.json();
}

async function conta() {
  const r = await fetch(L.REST + "/subscribers?status=eq.pending&promemoria_at=is.null&select=id", {
    headers: L.sbHeaders({ Prefer: "count=exact", Range: "0-0" })
  });
  if (r.status === 400) return null;
  const cr = r.headers.get("content-range") || "";
  const n = Number(cr.split("/")[1]);
  return Number.isFinite(n) ? n : (await r.json()).length;
}

async function segna(id) {
  const r = await fetch(L.REST + "/subscribers?id=eq." + id + "&status=eq.pending", {
    method: "PATCH", headers: L.sbHeaders({ Prefer: "return=minimal" }),
    body: JSON.stringify({ promemoria_at: new Date().toISOString() })
  });
  if (!r.ok) throw await L.sbError("db patch", r);
}

exports.handler = async (event) => {
  if (event.httpMethod !== "POST") return L.json(405, { error: "method" });
  if (!L.config.SERVICE_ROLE || !L.config.BREVO_API_KEY)
    return L.json(500, { error: "config", message: "Chiavi mancanti nelle variabili d'ambiente." });

  const auth = (event.headers && (event.headers.authorization || event.headers.Authorization)) || "";
  const user = await L.redazioneUser(auth.replace(/^Bearer\s+/i, ""));
  if (!user) return L.json(401, { error: "auth", message: "Sessione scaduta: rifai l'accesso in redazione." });
  if (L.isGiornalista(user)) return L.json(403, { error: "ruolo", message: "Il promemoria lo mandano i soci." });

  let dry = true;
  try { dry = JSON.parse(event.body || "{}").dry !== false; } catch (e) {}

  try {
    if (dry) {
      await inAttesa(1); // verifica che la migrazione 008 ci sia
      return L.json(200, { dry: true, daServire: await conta() });
    }

    const lista = await inAttesa(BATCH);
    let delivered = 0, failed = 0;
    await L.inPool(lista, L.CONCURRENCY, async (s) => {
      try {
        // Prima si segna, poi si spedisce: se l'invio si interrompe a meta',
        // al massimo qualcuno resta senza promemoria, mai con due.
        await segna(s.id);
        await L.brevoSend(s.email, "Manca un clic per la tua iscrizione", L.promemoriaEmailHtml(s.token), null, L.confirmSender);
        delivered++;
      } catch (e) {
        failed++;
        console.warn("promemoria, invio fallito:", e && e.message);
      }
    });
    const remaining = await conta();
    return L.json(200, { sent: true, delivered, failed, remaining, done: !remaining });
  } catch (e) {
    return L.json(e.config ? 409 : 500, { error: e.config ? "config" : "server", message: String(e.message || e) });
  }
};
