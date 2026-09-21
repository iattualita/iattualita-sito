// Esercita runDigest() con un finto server al posto di Supabase e Brevo:
// nessuna chiamata esce davvero. Serve soprattutto a dimostrare la proprieta'
// che conta: un invio interrotto a meta' non spedisce doppioni quando riparte.
process.env.SUPABASE_URL = "https://finto.supabase.test";
process.env.SUPABASE_SERVICE_ROLE_KEY = "sb_secret_finta";
process.env.BREVO_API_KEY = "finta";
process.env.SITE_URL = "https://iattualita.test";

const path = require("path");
const L = require(path.join(__dirname, "..", "netlify/functions/_newsletter-lib.js"));
const REST = process.env.SUPABASE_URL + "/rest/v1";

// ---- finto backend ----------------------------------------------------------
let db, spedite, brevoFallisce;

function reset({ subscribers, articles, lastSend }) {
  db = { subscribers, articles, lastSend, log: [] };
  spedite = [];
  brevoFallisce = false;
}

global.fetch = async (url, opt = {}) => {
  const u = String(url);
  const met = opt.method || "GET";
  const ok = (data) => ({ ok: true, status: 200, json: async () => data, text: async () => JSON.stringify(data) });

  if (u.startsWith("https://api.brevo.com")) {
    if (brevoFallisce) return { ok: false, status: 402, json: async () => ({}), text: async () => "quota finita" };
    spedite.push(JSON.parse(opt.body).to[0].email);
    return ok({ messageId: "x" });
  }
  if (u.startsWith(REST + "/newsletter_log") && met === "GET")
    return ok(db.lastSend ? [{ sent_at: db.lastSend }] : []);
  if (u.startsWith(REST + "/newsletter_log") && met === "POST") {
    db.log.push(JSON.parse(opt.body));
    return ok({});
  }
  if (u.startsWith(REST + "/news")) return ok(db.articles);
  if (u.startsWith(REST + "/subscribers") && met === "GET") return ok(db.subscribers);
  if (u.startsWith(REST + "/subscribers") && met === "PATCH") {
    const id = Number(u.match(/id=eq\.(\d+)/)[1]);
    Object.assign(db.subscribers.find((s) => s.id === id), JSON.parse(opt.body));
    return ok({});
  }
  throw new Error("chiamata non prevista dal test: " + met + " " + u);
};

// ---- helper -----------------------------------------------------------------
const results = [];
function check(name, cond, extra) {
  results.push(cond);
  console.log((cond ? "  PASS  " : "> FAIL <") + name);
  if (!cond && extra) console.log("          " + extra);
}

const iscritti = (n) =>
  Array.from({ length: n }, (_, i) => ({ id: i + 1, email: "lettore" + (i + 1) + "@esempio.it", token: "t" + (i + 1), last_digest_at: null }));
const UN_ARTICOLO = [{ id: 10, title: "Titolo", subtitle: "Occhiello", category: "Cronaca", image: null }];
const SETTIMANA_SCORSA = new Date(Date.now() - 7 * 864e5).toISOString();

(async () => {
  // --- invio completo in piu' blocchi ---------------------------------------
  reset({ subscribers: iscritti(3), articles: UN_ARTICOLO, lastSend: SETTIMANA_SCORSA });

  let r = await L.runDigest({ dry: false, limit: 2 });
  check("primo blocco: serve 2 iscritti su 3", r.delivered === 2 && r.remaining === 1, JSON.stringify(r));
  check("  ^ e non chiude ancora il registro", r.done === false && db.log.length === 0);

  r = await L.runDigest({ dry: false, limit: 2 });
  check("secondo blocco: serve solo l'ultimo, non i primi due", r.delivered === 1 && r.done === true, JSON.stringify(r));
  check("  ^ ogni iscritto ha ricevuto una volta sola", spedite.length === 3 && new Set(spedite).size === 3, spedite.join(", "));
  check("  ^ e ora il registro e' scritto, una volta sola", db.log.length === 1);

  // --- la proprieta' che conta: ripartenza dopo un'interruzione --------------
  // Il registro NON e' stato scritto (invio troncato), ma due iscritti erano
  // gia' stati serviti. Riprendendo, quei due non devono ricevere di nuovo.
  const subs = iscritti(3);
  subs[0].last_digest_at = new Date().toISOString();
  subs[1].last_digest_at = new Date().toISOString();
  reset({ subscribers: subs, articles: UN_ARTICOLO, lastSend: SETTIMANA_SCORSA });

  r = await L.runDigest({ dry: false, limit: 25 });
  check("dopo un'interruzione: riprende solo da chi mancava", spedite.length === 1 && spedite[0] === "lettore3@esempio.it", spedite.join(", "));
  check("  ^ e chiude il registro", r.done === true && db.log.length === 1);

  // --- invio troncato proprio sul finale ------------------------------------
  const tutti = iscritti(2).map((s) => ({ ...s, last_digest_at: new Date().toISOString() }));
  reset({ subscribers: tutti, articles: UN_ARTICOLO, lastSend: SETTIMANA_SCORSA });
  r = await L.runDigest({ dry: false, limit: 25 });
  check("tutti gia' serviti ma registro vuoto: chiude senza rispedire", spedite.length === 0 && r.done === true && db.log.length === 1, JSON.stringify(r));

  // --- un invio fallito resta in coda ---------------------------------------
  reset({ subscribers: iscritti(2), articles: UN_ARTICOLO, lastSend: SETTIMANA_SCORSA });
  brevoFallisce = true;
  r = await L.runDigest({ dry: false, limit: 25 });
  check("se Brevo rifiuta: nessuno viene marcato come servito", r.delivered === 0 && r.failed === 2 && db.subscribers.every((s) => !s.last_digest_at));
  check("  ^ e il registro resta vuoto, cosi' si puo' ritentare", db.log.length === 0 && r.done === false);
  brevoFallisce = false;
  r = await L.runDigest({ dry: false, limit: 25 });
  check("  ^ al ritentativo partono entrambi", r.delivered === 2 && r.done === true);

  // --- casi di stop ----------------------------------------------------------
  reset({ subscribers: iscritti(2), articles: [], lastSend: SETTIMANA_SCORSA });
  r = await L.runDigest({ dry: false });
  check("nessun articolo nuovo: non parte niente", r.sent === false && spedite.length === 0 && db.log.length === 0);

  reset({ subscribers: [], articles: UN_ARTICOLO, lastSend: SETTIMANA_SCORSA });
  r = await L.runDigest({ dry: false });
  check("nessun iscritto: non parte niente", r.sent === false && spedite.length === 0);

  // --- anteprima -------------------------------------------------------------
  reset({ subscribers: iscritti(5), articles: UN_ARTICOLO, lastSend: SETTIMANA_SCORSA });
  r = await L.runDigest({ dry: true });
  check("anteprima: conta senza spedire", r.dry === true && r.recipients === 5 && r.remaining === 5 && spedite.length === 0);

  // --- header di disiscrizione in un clic ------------------------------------
  reset({ subscribers: iscritti(1), articles: UN_ARTICOLO, lastSend: SETTIMANA_SCORSA });
  let inviato = null;
  const veroFetch = global.fetch;
  global.fetch = async (url, opt) => {
    if (String(url).startsWith("https://api.brevo.com")) inviato = JSON.parse(opt.body);
    return veroFetch(url, opt);
  };
  await L.runDigest({ dry: false });
  global.fetch = veroFetch;
  check("il digest parte con List-Unsubscribe",
    !!(inviato && inviato.headers && /^<https:\/\/iattualita\.test\/\.netlify\/functions\/unsubscribe\?token=t1>$/.test(inviato.headers["List-Unsubscribe"])),
    JSON.stringify(inviato && inviato.headers));
  check("  ^ e dichiara la disiscrizione in un clic",
    !!(inviato && inviato.headers && inviato.headers["List-Unsubscribe-Post"] === "List-Unsubscribe=One-Click"));
  check("  ^ e il link nel corpo e' quello dell'iscritto, non un segnaposto",
    !!(inviato && inviato.htmlContent.includes("unsubscribe?token=t1") && !inviato.htmlContent.includes("{{UNSUB}}")));

  const falliti = results.filter((x) => !x).length;
  console.log("\n" + results.length + " controlli, " + falliti + " falliti");
  process.exit(falliti ? 1 : 0);
})();
