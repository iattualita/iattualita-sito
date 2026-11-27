// numeri-meta — follower di Facebook e Instagram di IAttualità per la pagina
// /numeri del sito.
//
// Usa il token dell'utente di sistema "agente-commenti" (portafoglio Meta di
// Nicola, dove stanno le pagine), salvato tra i segreti di Supabase come
// META_COMMENTI_TOKEN: lo stesso degli agenti che rispondono ai commenti.
// Un solo token, in un solo posto (27 nov 2026). Il token non esce mai da qui:
// la funzione restituisce solo i due numeri.
//
// La chiama il sito (netlify/functions/_numeri-lib.js) con la chiave di
// servizio di Supabase. Accetta anche l'intestazione x-meteo-cron, la stessa
// chiave con cui pg_cron chiama le funzioni del meteo.

const SB_URL = Deno.env.get("SUPABASE_URL")!;
const SB_SR = Deno.env.get("SUPABASE_SERVICE_ROLE_KEY")!;
const GRAPH = "https://graph.facebook.com/v26.0";
const IG_IATTUALITA = "ia.ttualita";

async function sha(t: string) {
  const b = await crypto.subtle.digest("SHA-256", new TextEncoder().encode(t));
  return [...new Uint8Array(b)].map((x) => x.toString(16).padStart(2, "0")).join("");
}

async function leggeMeteoCron(headers: Record<string, string>, filtro = "") {
  const r = await fetch(`${SB_URL}/rest/v1/meteo_cron?select=hash&limit=1${filtro}`, { headers });
  if (!r.ok) return false;
  const j = await r.json();
  return Array.isArray(j) && j.length > 0;
}

// meteo_cron non ha regole di lettura pubbliche: la vede solo chi ha una
// chiave di servizio. Se la chiave ricevuta la legge, è una chiave di servizio
// del progetto (vale sia per sb_secret_... sia per la vecchia chiave JWT).
async function autorizzato(req: Request) {
  const cron = req.headers.get("x-meteo-cron");
  if (cron) {
    return leggeMeteoCron({ apikey: SB_SR, Authorization: `Bearer ${SB_SR}` }, `&hash=eq.${await sha(cron)}`);
  }
  const k = req.headers.get("apikey") || (req.headers.get("authorization") || "").replace(/^Bearer\s+/i, "");
  if (!k || k.length < 20) return false;
  if (k === SB_SR) return true;
  const h: Record<string, string> = { apikey: k };
  if (k.startsWith("eyJ")) h.Authorization = `Bearer ${k}`;
  return leggeMeteoCron(h);
}

const numero = (x: unknown) => {
  const n = Number(x);
  return Number.isFinite(n) && n >= 0 ? Math.round(n) : null;
};

const normalizza = (s: string) => String(s || "").toLowerCase().normalize("NFD").replace(/[̀-ͯ]/g, "").replace(/\s+/g, "");

Deno.serve(async (req) => {
  if (!(await autorizzato(req))) return Response.json({ error: "auth" }, { status: 401 });

  const token = (Deno.env.get("META_COMMENTI_TOKEN") || "").trim();
  if (!token) return Response.json({ error: "Manca il segreto META_COMMENTI_TOKEN su Supabase" }, { status: 500 });

  // Diagnosi: con {"diagnosi":true} restituisce i permessi del token e le
  // risorse a cui vale (solo nomi e id, mai il token).
  let corpo: any = {};
  try { corpo = await req.json(); } catch (_) { /* corpo vuoto */ }
  if (corpo?.diagnosi) {
    const g = async (u: string) => { try { return await (await fetch(u)).json(); } catch (e) { return { errore: String(e) }; } };
    const dbg = await g(`${GRAPH}/debug_token?input_token=${encodeURIComponent(token)}&access_token=${encodeURIComponent(token)}`);
    const perm = await g(`${GRAPH}/me/permissions?access_token=${encodeURIComponent(token)}`);
    const me = await g(`${GRAPH}/me?fields=id,name&access_token=${encodeURIComponent(token)}`);
    const pag = await g(`${GRAPH}/me/accounts?fields=id,name,tasks,connected_instagram_account,instagram_business_account&access_token=${encodeURIComponent(token)}`);
    return Response.json({
      me,
      token: dbg?.data ? { valido: dbg.data.is_valid, app: dbg.data.application, app_id: dbg.data.app_id, tipo: dbg.data.type, scade: dbg.data.expires_at, permessi: dbg.data.scopes, permessi_per_risorsa: dbg.data.granular_scopes } : dbg,
      permessi: perm?.data ?? perm,
      pagine: pag?.data ?? pag,
    });
  }

  const campi = "id,name,access_token,followers_count,fan_count,instagram_business_account{id,username,followers_count},connected_instagram_account{id,username,followers_count}";
  const r = await fetch(`${GRAPH}/me/accounts?fields=${encodeURIComponent(campi)}&limit=50&access_token=${encodeURIComponent(token)}`);
  let d: any = null;
  try { d = await r.json(); } catch (_) { /* risposta non JSON */ }
  if (!r.ok || d?.error) {
    const m = d?.error?.message || d?.error?.code || `HTTP ${r.status}`;
    return Response.json({ error: String(m).slice(0, 200) }, { status: 502 });
  }

  const pagine: any[] = Array.isArray(d?.data) ? d.data : [];
  const p =
    pagine.find((x) => (x?.instagram_business_account || x?.connected_instagram_account)?.username === IG_IATTUALITA) ||
    pagine.find((x) => normalizza(x?.name) === "iattualita");
  if (!p) {
    return Response.json({
      error: "La pagina IAttualità non risulta tra quelle assegnate all'utente di sistema agente-commenti",
      pagine: pagine.map((x) => x?.name),
    }, { status: 502 });
  }

  // Con l'app "Agente commenti IAttualità" Meta indica l'account Instagram
  // della pagina in connected_instagram_account e lascia vuoto
  // instagram_business_account (verificato il 27 nov 2026): si prova il primo
  // che c'è, e se nell'elenco mancano i follower si chiedono all'account.
  let ig = p.instagram_business_account || p.connected_instagram_account;
  const note: string[] = [];
  if (!ig?.id) note.push("la pagina non risulta collegata a un account Instagram");
  for (const t of [token, p.access_token].filter(Boolean)) {
    if (!ig?.id || ig.followers_count != null) break;
    const ri = await fetch(`${GRAPH}/${ig.id}?fields=username,followers_count&access_token=${encodeURIComponent(t)}`);
    let di: any = null;
    try { di = await ri.json(); } catch (_) { /* */ }
    if (di?.followers_count != null) ig = { ...ig, ...di };
    else note.push(String(di?.error?.message || "follower Instagram non letti").slice(0, 160));
  }

  return Response.json({
    pagina: p.name,
    facebook: { follower: numero(p.followers_count ?? p.fan_count) },
    instagram: ig?.followers_count != null ? { follower: numero(ig.followers_count), username: ig.username } : null,
    ...(ig?.followers_count == null ? { errore_instagram: note.join(" | ") || "account Instagram non trovato" } : {}),
  });
});
