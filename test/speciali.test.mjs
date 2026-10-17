// Esercita gli invii speciali con un finto server al posto di Supabase e
// Brevo: nessuna chiamata esce davvero.
//
// Le proprieta' che contano:
//   - ogni iscritto riceve l'email una volta sola, anche se l'invio riparte
//   - ogni iscritto riceve il proprio link personale
//   - la pagina riservata si apre solo agli iscritti confermati
//   - quello che scrive la redazione non puo' iniettare codice
process.env.SUPABASE_URL = "https://finto.supabase.test";
process.env.SUPABASE_SERVICE_ROLE_KEY = "sb_secret_finta";
process.env.BREVO_API_KEY = "finta";
process.env.SITE_URL = "https://iattualita.test";

import path from "node:path";
import { fileURLToPath } from "node:url";
import { createRequire } from "node:module";

const REPO = path.join(path.dirname(fileURLToPath(import.meta.url)), "..");
const require = createRequire(import.meta.url);
const S = require(path.join(REPO, "netlify/functions/_speciali-lib.js"));
const sendSpecial = require(path.join(REPO, "netlify/functions/send-special.js")).handler;
const riservato = (await import(path.join(REPO, "netlify/functions/riservato.mjs"))).default;

const SUPA = process.env.SUPABASE_URL;
const REST = SUPA + "/rest/v1";
const ID = "11111111-2222-4333-8444-555555555555";

// ---- finto backend ----------------------------------------------------------
let db, spedite, brevoFallisce;
function reset({ special, subscribers, delivered }) {
  db = { special, subscribers, delivered: delivered || [] };
  spedite = [];
  brevoFallisce = false;
}
const iscritto = (n, status) => ({
  id: "00000000-0000-4000-8000-00000000000" + n, email: "lettore" + n + "@esempio.it", token: "tok" + n, status: status || "confirmed"
});
const base = (extra) => Object.assign({
  id: ID, subject: "Un video per voi", intro: "Ciao a tutti.\n\nGuardate qui: https://iattualita.it/x <script>alert(1)</script>",
  video_path: "speciali/abc.mp4", cover_url: SUPA + "/storage/v1/object/public/media/speciali/c.jpg",
  email_image_url: SUPA + "/storage/v1/object/public/media/speciali/e.jpg",
  article_title: "Il retroscena", article_body: "<p>Testo <b>riservato</b>.</p><script>alert(2)</script><img src=x onerror=alert(3)>",
  status: "draft"
}, extra || {});

const ok = (data, status) => ({ ok: true, status: status || 200, json: async () => data, text: async () => JSON.stringify(data) });
const ko = (status, txt) => ({ ok: false, status, json: async () => ({}), text: async () => txt || "" });

global.fetch = async (url, opt = {}) => {
  const u = String(url);
  const met = opt.method || "GET";

  if (u === "https://api.brevo.com/v3/smtp/email") {
    if (brevoFallisce) return ko(402, "quota finita");
    spedite.push(JSON.parse(opt.body));
    return ok({ messageId: "x" });
  }
  if (u.startsWith(SUPA + "/auth/v1/user")) {
    const a = (opt.headers || {}).Authorization || "";
    return a === "Bearer giusto" ? ok({ id: "u1", email: "redazione@iattualita.it" }) : ko(401, "bad jwt");
  }
  if (u.startsWith(SUPA + "/storage/v1/object/sign/riservati/") && met === "POST")
    return ok({ signedURL: "/object/sign/riservati/speciali/abc.mp4?token=firmato" });

  if (u.startsWith(REST + "/newsletter_specials?id=eq.")) {
    const id = u.match(/id=eq\.([^&]+)/)[1];
    if (met === "GET") return ok(db.special && db.special.id === id ? [db.special] : []);
    if (met === "PATCH") { Object.assign(db.special, JSON.parse(opt.body)); return ok({}); }
  }
  if (u.startsWith(REST + "/subscribers?token=eq.")) {
    const tok = decodeURIComponent(u.match(/token=eq\.([^&]+)/)[1]);
    const s = db.subscribers.find((x) => x.token === tok);
    return ok(s ? [{ id: s.id, status: s.status, email: s.email }] : []);
  }
  if (u.startsWith(REST + "/subscribers?status=eq.confirmed")) {
    const off = Number((u.match(/offset=(\d+)/) || [0, 0])[1]);
    return ok(db.subscribers.filter((s) => s.status === "confirmed").slice(off, off + 1000).map(({ id, email, token }) => ({ id, email, token })));
  }
  if (u.startsWith(REST + "/newsletter_special_deliveries")) {
    if (met === "GET") {
      const off = Number((u.match(/offset=(\d+)/) || [0, 0])[1]);
      return ok(db.delivered.slice(off, off + 1000).map((subscriber_id) => ({ subscriber_id })));
    }
    if (met === "POST") {
      const b = JSON.parse(opt.body);
      if (!db.delivered.includes(b.subscriber_id)) db.delivered.push(b.subscriber_id);
      return ok({}, 201);
    }
  }
  throw new Error("chiamata non prevista dal test: " + met + " " + u);
};

// ---- helper -----------------------------------------------------------------
const results = [];
function check(name, cond, extra) {
  results.push(!!cond);
  console.log((cond ? "  PASS  " : "> FAIL <") + name);
  if (!cond && extra !== undefined) console.log("          " + extra);
}
const tre = () => [iscritto(1), iscritto(2), iscritto(3), iscritto(4, "pending"), iscritto(5, "unsubscribed")];
const apri = async (qs) => {
  const r = await riservato(new Request("https://iattualita.test/.netlify/functions/riservato?" + qs));
  return { status: r.status, h: r.headers, body: await r.text() };
};

// --- conteggio --------------------------------------------------------------
reset({ special: base(), subscribers: tre() });
let r = await S.runSpecial({ id: ID, dry: true });
check("anteprima: conta solo i 3 confermati", r.recipients === 3 && r.remaining === 3 && r.problems.length === 0, JSON.stringify(r));
check("  ^ e non spedisce niente", spedite.length === 0);

// --- invio in due blocchi ---------------------------------------------------
r = await S.runSpecial({ id: ID, dry: false, limit: 2 });
check("primo blocco: 2 iscritti serviti, 1 in coda", r.delivered === 2 && r.remaining === 1 && r.done === false, JSON.stringify(r));
check("  ^ lo stato passa a 'in invio', non ancora 'inviato'", db.special.status === "sending");
r = await S.runSpecial({ id: ID, dry: false, limit: 2 });
check("secondo blocco: serve solo l'ultimo", r.delivered === 1 && r.done === true, JSON.stringify(r));
const destinatari = spedite.map((m) => m.to[0].email);
check("  ^ ognuno ha ricevuto una volta sola", destinatari.length === 3 && new Set(destinatari).size === 3, destinatari.join(", "));
check("  ^ niente a chi non ha confermato o si e' disiscritto", !destinatari.includes("lettore4@esempio.it") && !destinatari.includes("lettore5@esempio.it"));
check("  ^ l'invio risulta chiuso, con 3 destinatari", db.special.status === "sent" && db.special.recipients === 3 && !!db.special.sent_at);

const m1 = spedite.find((m) => m.to[0].email === "lettore1@esempio.it");
check("email: oggetto quello scelto in redazione", m1.subject === "Un video per voi");
check("email: link personale al contenuto riservato", m1.htmlContent.includes("/riservato?id=" + ID + "&amp;t=tok1"));
check("email: nessun link personale di altri iscritti", !m1.htmlContent.includes("tok2") && !m1.htmlContent.includes("tok3"));
check("email: link di disiscrizione e header List-Unsubscribe", m1.htmlContent.includes("/unsubscribe?token=tok1") && /unsubscribe\?token=tok1/.test(m1.headers["List-Unsubscribe"]));
check("email: il testo della redazione non inietta HTML", !m1.htmlContent.includes("<script") && m1.htmlContent.includes("&lt;script&gt;"));
check("email: gli indirizzi web diventano link", m1.htmlContent.includes('<a href="https://iattualita.it/x"'));
check("email: miniatura del video e pulsante", m1.htmlContent.includes("speciali/e.jpg") && m1.htmlContent.includes("Guarda il video"));
check("email: anteprima dell'articolo senza codice", m1.htmlContent.includes("Il retroscena") && !/alert\(2\)|onerror/.test(m1.htmlContent));

r = await S.runSpecial({ id: ID, dry: false });
check("un invio gia' spedito non riparte", r.sent === false && spedite.length === 3, JSON.stringify(r));

// --- ripartenza dopo un'interruzione ---------------------------------------
reset({ special: base({ status: "sending" }), subscribers: tre(), delivered: [iscritto(1).id, iscritto(2).id] });
r = await S.runSpecial({ id: ID, dry: false });
check("ripartenza: serve solo chi non aveva ricevuto", r.delivered === 1 && spedite.length === 1 && spedite[0].to[0].email === "lettore3@esempio.it", JSON.stringify(r));

// --- Brevo giu' -------------------------------------------------------------
reset({ special: base(), subscribers: tre() });
brevoFallisce = true;
r = await S.runSpecial({ id: ID, dry: false });
check("Brevo in errore: nessuno registrato come servito", r.delivered === 0 && r.failed === 3 && db.delivered.length === 0 && r.remaining === 3, JSON.stringify(r));

// --- contenuto incompleto ---------------------------------------------------
reset({ special: base({ subject: "  " }), subscribers: tre() });
r = await S.runSpecial({ id: ID, dry: false });
check("senza oggetto non parte", r.sent === false && /oggetto/.test(r.reason) && spedite.length === 0, JSON.stringify(r));
reset({ special: base({ intro: "", video_path: null, article_title: "", article_body: "<br>" }), subscribers: tre() });
r = await S.runSpecial({ id: ID, dry: false });
check("senza contenuto non parte", r.sent === false && /niente da mandare/.test(r.reason), JSON.stringify(r));
reset({ special: base({ article_body: "<p><br></p>" }), subscribers: tre() });
check("articolo con titolo ma senza testo: segnalato", S.problems(db.special).some((p) => /titolo ma non il testo/.test(p)));

// --- prova alla redazione ---------------------------------------------------
reset({ special: base(), subscribers: tre() });
r = await S.sendTest(ID, "redazione@iattualita.it");
const prova = spedite[0];
check("prova: va solo alla redazione", r.ok && spedite.length === 1 && prova.to[0].email === "redazione@iattualita.it");
check("prova: oggetto marcato [PROVA]", prova.subject === "[PROVA] Un video per voi");
check("prova: link di anteprima firmato, nessun token di iscritti", prova.htmlContent.includes("&amp;p=" + S.previewSig(ID)) && !/tok\d/.test(prova.htmlContent));
check("prova: lo stato resta bozza", db.special.status === "draft" && db.delivered.length === 0);

// --- la funzione chiamata dal pulsante --------------------------------------
const chiama = (auth, body) => sendSpecial({ httpMethod: "POST", headers: { authorization: auth }, body: JSON.stringify(body) });
let h = await chiama("Bearer sbagliato", { id: ID, mode: "send" });
check("send-special: senza accesso redazione risponde 401", h.statusCode === 401);
h = await chiama("Bearer giusto", { id: "1; drop table", mode: "send" });
check("send-special: id non valido rifiutato", h.statusCode === 400);
h = await chiama("Bearer giusto", { id: ID, mode: "dry" });
check("send-special: anteprima con accesso valido", h.statusCode === 200 && JSON.parse(h.body).recipients === 3, h.body);
h = await chiama("Bearer giusto", { id: ID, mode: "test" });
check("send-special: prova all'indirizzo di chi e' collegato", h.statusCode === 200 && JSON.parse(h.body).to === "redazione@iattualita.it", h.body);

// --- pagina riservata -------------------------------------------------------
reset({ special: base({ status: "sent" }), subscribers: tre() });
let pg = await apri("id=" + ID + "&t=tok1");
check("pagina: iscritto confermato la vede", pg.status === 200 && pg.body.includes("Un video per voi"), pg.status);
check("pagina: video dal link temporaneo, non da un indirizzo pubblico", pg.body.includes('src="' + SUPA + "/storage/v1/object/sign/riservati/speciali/abc.mp4?token=firmato"), pg.body.match(/<video[^>]*>/));
check("pagina: articolo riservato presente e ripulito", pg.body.includes("<b>riservato</b>") && !/alert\(2\)|onerror/.test(pg.body));
check("pagina: testo della redazione con escape", !pg.body.includes("<script>alert(1)") && pg.body.includes("&lt;script&gt;"));
check("pagina: niente cache, niente indicizzazione, niente referrer",
  /no-store/.test(pg.h.get("cache-control")) && /noindex/.test(pg.h.get("x-robots-tag")) && pg.h.get("referrer-policy") === "no-referrer");
check("pagina: CSP che ammette il video solo da Supabase", /media-src https:\/\/finto\.supabase\.test/.test(pg.h.get("content-security-policy")) && /default-src 'none'/.test(pg.h.get("content-security-policy")));

pg = await apri("id=" + ID + "&t=tok5");
check("pagina: chi si e' disiscritto non la vede", pg.status === 403 && !pg.body.includes("<video") && /disiscritto/.test(pg.body));
pg = await apri("id=" + ID + "&t=tok4");
check("pagina: chi non ha confermato non la vede", pg.status === 403 && !pg.body.includes("<video"));
pg = await apri("id=" + ID + "&t=inventato");
check("pagina: token inventato respinto", pg.status === 403 && !pg.body.includes("Il retroscena"));
pg = await apri("id=" + ID);
check("pagina: senza token respinta", pg.status === 403);
pg = await apri("id=" + ID + "&p=" + "0".repeat(32));
check("pagina: firma di anteprima falsa respinta", pg.status === 403 && !pg.body.includes("<video"));
pg = await apri("id=" + ID + "&p=" + S.previewSig(ID));
check("pagina: anteprima della redazione funziona", pg.status === 200 && pg.body.includes("Anteprima della redazione") && pg.body.includes("<video"));
pg = await apri("id=nonuuid&t=tok1");
check("pagina: id non valido -> 404", pg.status === 404);

reset({ special: base({ status: "draft" }), subscribers: tre() });
pg = await apri("id=" + ID + "&t=tok1");
check("pagina: una bozza non si apre con il link di un iscritto", pg.status === 404 && !pg.body.includes("<video"));
pg = await apri("id=" + ID + "&p=" + S.previewSig(ID));
check("pagina: la bozza si apre in anteprima", pg.status === 200);

const falliti = results.filter((x) => !x).length;
console.log("\n" + results.length + " controlli, " + falliti + " falliti");
process.exit(falliti ? 1 : 0);
