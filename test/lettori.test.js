// Esercita l'accesso dei lettori (codice a 6 cifre, sessione, testo integrale)
// contro un finto Supabase e un finto Brevo tenuti in memoria: nessuna
// chiamata esce davvero.
process.env.LETTORI_SECRET = "segreto-di-prova-abbastanza-lungo";
process.env.SUPABASE_SERVICE_ROLE_KEY = "sb_secret_prova";
process.env.BREVO_API_KEY = "brevo-prova";

const path = require("path");
const FN = path.join(__dirname, "..", "netlify", "functions");

// ---------- finto Supabase + Brevo ----------
let db, mail, limiteOk;
function reset() {
  db = {
    codici: new Map(),       // email -> riga
    lettori: new Map(),      // id -> riga
    subscribers: new Map(),  // email -> riga
    news: new Map([["11111111-1111-4111-8111-111111111111", { id: "11111111-1111-4111-8111-111111111111", body: "<p>TESTO-INTEGRALE</p>", summary: "x" }]])
  };
  mail = [];
  limiteOk = () => true;
}
const uuid = () => require("crypto").randomUUID();
const risp = (status, data) => ({ ok: status < 300, status, json: async () => data, text: async () => JSON.stringify(data) });
const param = (u, k) => { const m = u.match(new RegExp("[?&]" + k + "=eq\\.([^&]+)")); return m ? decodeURIComponent(m[1]) : null; };

global.fetch = async (url, opt = {}) => {
  const u = String(url);
  const metodo = opt.method || "GET";
  const corpo = opt.body ? JSON.parse(opt.body) : null;

  if (u.includes("api.brevo.com")) { mail.push(corpo); return risp(201, {}); }
  if (u.includes("/rpc/rate_hit")) return risp(200, limiteOk(corpo.k));

  if (u.includes("/codici_accesso")) {
    const e = param(u, "email");
    if (metodo === "POST") { db.codici.set(corpo.email, { ...corpo }); return risp(201, null); }
    if (metodo === "GET") return risp(200, e && db.codici.has(e) ? [db.codici.get(e)] : []);
    if (metodo === "PATCH") { Object.assign(db.codici.get(e), corpo); return risp(204, null); }
    if (metodo === "DELETE") { if (e) db.codici.delete(e); return risp(204, null); }
  }
  if (u.includes("/lettori")) {
    const id = param(u, "id");
    if (metodo === "POST") {
      let l = [...db.lettori.values()].find((x) => x.email === corpo.email);
      if (!l) { l = { id: uuid(), email: corpo.email }; db.lettori.set(l.id, l); }
      l.last_login_at = corpo.last_login_at;
      return risp(201, [{ id: l.id, email: l.email }]);
    }
    if (metodo === "GET") return risp(200, db.lettori.has(id) ? [db.lettori.get(id)] : []);
    if (metodo === "DELETE") { db.lettori.delete(id); return risp(204, null); }
  }
  if (u.includes("/subscribers")) {
    if (metodo === "GET") { const e = param(u, "email"); return risp(200, db.subscribers.has(e) ? [db.subscribers.get(e)] : []); }
    if (metodo === "POST") { db.subscribers.set(corpo.email, { id: uuid(), ...corpo }); return risp(201, null); }
    if (metodo === "PATCH") {
      const id = param(u, "id");
      const s = [...db.subscribers.values()].find((x) => x.id === id);
      Object.assign(s, corpo); return risp(204, null);
    }
  }
  if (u.includes("/news")) { const id = param(u, "id"); return risp(200, db.news.has(id) ? [db.news.get(id)] : []); }
  throw new Error("chiamata inattesa: " + metodo + " " + u);
};

const A = require(path.join(FN, "_lettori-lib.js"));
const codice = require(path.join(FN, "accesso-codice.js")).handler;
const verifica = require(path.join(FN, "accesso-verifica.js")).handler;
const lettore = require(path.join(FN, "lettore.js")).handler;
const completo = require(path.join(FN, "articolo-completo.js")).handler;
const ART = "11111111-1111-4111-8111-111111111111";

const JSONH = { "content-type": "application/json", "sec-fetch-site": "same-origin" };
const post = (fn, body, headers) => fn({ httpMethod: "POST", headers: { ...JSONH, ...(headers || {}) }, body: JSON.stringify(body) });
const get = (fn, qs, cookie) => fn({ httpMethod: "GET", headers: cookie ? { cookie } : {}, queryStringParameters: qs || {} });
const cookieDa = (res) => ((res.multiValueHeaders || {})["Set-Cookie"] || []).map((c) => c.split(";")[0]).join("; ");
const codiceInviato = () => (mail[mail.length - 1].subject.match(/^(\d{6}) /) || [])[1];

const risultati = [];
function check(nome, cond, extra) {
  risultati.push(cond);
  console.log((cond ? "  PASS  " : "> FAIL <") + nome);
  if (!cond && extra !== undefined) console.log("          " + JSON.stringify(extra).slice(0, 300));
}

(async () => {
  // ---- richiesta del codice ----
  reset();
  let r = await post(codice, { email: "Lettrice@Esempio.it", newsletter: false });
  check("richiesta codice: 200 e una mail partita", r.statusCode === 200 && mail.length === 1, r);
  check("  ^ il codice sta nell'oggetto, a 6 cifre", /^\d{6} è il tuo codice/.test(mail[0].subject), mail[0].subject);
  check("  ^ l'indirizzo e' normalizzato in minuscolo", mail[0].to[0].email === "lettrice@esempio.it");
  const riga = db.codici.get("lettrice@esempio.it");
  check("  ^ nel database c'e' l'impronta, non il codice", riga && riga.code_hash.length === 64 && riga.code_hash !== codiceInviato());
  check("  ^ newsletter non spuntata resta false", riga.newsletter === false);

  reset();
  r = await post(codice, { email: "bot@esempio.it", website: "http://spam" });
  check("honeypot pieno: finge successo e non manda nulla", r.statusCode === 200 && mail.length === 0);

  r = await post(codice, { email: "x@esempio.it" }, { "sec-fetch-site": "cross-site" });
  check("richiesta da un altro sito: rifiutata", r.statusCode === 403 && mail.length === 0, r.statusCode);
  r = await codice({ httpMethod: "POST", headers: { "content-type": "application/x-www-form-urlencoded" }, body: "email=x@esempio.it" });
  check("modulo HTML (non JSON): rifiutato", r.statusCode === 403 && mail.length === 0, r.statusCode);
  r = await post(codice, { email: "non-una-email" });
  check("email non valida: 400", r.statusCode === 400);

  reset();
  limiteOk = (k) => !k.startsWith("acc:mail:");
  r = await post(codice, { email: "molestata@esempio.it" });
  check("oltre il limite per indirizzo: risponde ok ma non manda nulla", r.statusCode === 200 && mail.length === 0);
  limiteOk = (k) => !k.startsWith("acc:ip:");
  r = await post(codice, { email: "a@esempio.it" });
  check("oltre il limite per IP: 429", r.statusCode === 429);

  // ---- verifica ----
  reset();
  await post(codice, { email: "l@esempio.it", newsletter: true });
  let giusto = codiceInviato();
  let sbagliato = giusto === "000000" ? "111111" : "000000";
  r = await post(verifica, { email: "l@esempio.it", codice: sbagliato });
  check("codice sbagliato: 400 e tentativo contato", r.statusCode === 400 && db.codici.get("l@esempio.it").tentativi === 1, r);
  check("  ^ nessun lettore creato, nessuna iscrizione", db.lettori.size === 0 && db.subscribers.size === 0);

  r = await post(verifica, { email: "l@esempio.it", codice: giusto });
  check("codice giusto: 200", r.statusCode === 200, r);
  const cookies = (r.multiValueHeaders || {})["Set-Cookie"] || [];
  check("  ^ due cookie: sessione HttpOnly e segnale leggibile",
    cookies.some((c) => /^iatt_sessione=v1\./.test(c) && /HttpOnly/.test(c) && /Secure/.test(c) && /SameSite=Lax/.test(c)) &&
    cookies.some((c) => /^iatt_lettore=1;/.test(c) && !/HttpOnly/.test(c)), cookies);
  check("  ^ lettore creato", db.lettori.size === 1);
  check("  ^ newsletter spuntata: iscritto e GIA' confermato",
    db.subscribers.get("l@esempio.it") && db.subscribers.get("l@esempio.it").status === "confirmed" && !!db.subscribers.get("l@esempio.it").token,
    db.subscribers.get("l@esempio.it"));
  check("  ^ la risposta lo dice", JSON.parse(r.body).newsletter === "iscritto");
  const sessione = cookieDa(r);

  r = await post(verifica, { email: "l@esempio.it", codice: giusto });
  check("lo stesso codice non si usa due volte", r.statusCode === 400);

  reset();
  await post(codice, { email: "n@esempio.it", newsletter: false });
  r = await post(verifica, { email: "n@esempio.it", codice: codiceInviato() });
  check("newsletter NON spuntata: accesso si', iscrizione no", r.statusCode === 200 && db.subscribers.size === 0 && JSON.parse(r.body).newsletter === null);

  reset();
  db.subscribers.set("ex@esempio.it", { id: "s1", email: "ex@esempio.it", status: "unsubscribed", token: "t-vecchio" });
  await post(codice, { email: "ex@esempio.it", newsletter: true });
  await post(verifica, { email: "ex@esempio.it", codice: codiceInviato() });
  const ex = db.subscribers.get("ex@esempio.it");
  check("chi si era disiscritto e rispunta la casella torna confermato, stesso token",
    ex.status === "confirmed" && ex.token === "t-vecchio" && ex.unsubscribed_at === null, ex);

  reset();
  await post(codice, { email: "f@esempio.it" });
  giusto = codiceInviato();
  sbagliato = giusto === "000000" ? "111111" : "000000";
  for (let i = 0; i < 5; i++) r = await post(verifica, { email: "f@esempio.it", codice: sbagliato });
  check("cinque errori: codice bruciato", !db.codici.has("f@esempio.it"), [...db.codici.keys()]);
  r = await post(verifica, { email: "f@esempio.it", codice: giusto });
  check("  ^ e poi neanche quello giusto funziona", r.statusCode === 400 && db.lettori.size === 0);

  reset();
  await post(codice, { email: "s@esempio.it" });
  giusto = codiceInviato();
  db.codici.get("s@esempio.it").expires_at = new Date(Date.now() - 1000).toISOString();
  r = await post(verifica, { email: "s@esempio.it", codice: giusto });
  check("codice scaduto: rifiutato", r.statusCode === 400 && JSON.parse(r.body).error === "scaduto");

  // ---- testo integrale ----
  reset();
  await post(codice, { email: "t@esempio.it" });
  r = await post(verifica, { email: "t@esempio.it", codice: codiceInviato() });
  const sess = cookieDa(r);

  r = await get(completo, { id: ART });
  check("articolo completo senza cookie: 401", r.statusCode === 401 && !r.body.includes("TESTO-INTEGRALE"));
  r = await get(completo, { id: ART }, sess);
  check("articolo completo con sessione: 200 e testo", r.statusCode === 200 && JSON.parse(r.body).body.includes("TESTO-INTEGRALE"), r);
  check("  ^ nessuna cache condivisa", r.headers["Cache-Control"] === "private, no-store");
  check("  ^ sessione nuova: nessun rinnovo del cookie", !r.multiValueHeaders);

  const falso = sess.replace(/iatt_sessione=v1\.([0-9a-f-]{36})/, "iatt_sessione=v1.22222222-2222-4222-8222-222222222222");
  r = await get(completo, { id: ART }, falso);
  check("cookie con un altro id (firma che non torna): 401", r.statusCode === 401);

  const v = sess.match(/iatt_sessione=([^;]+)/)[1].split(".");
  r = await get(completo, { id: ART }, "iatt_sessione=" + [v[0], v[1], String(Number(v[2]) + 999999), v[3]].join("."));
  check("scadenza allungata a mano: 401", r.statusCode === 401);

  const id = v[1];
  const scaduta = A.creaSessione(id, Math.floor(Date.now() / 1000) - A.SESSIONE_S - 10);
  r = await get(completo, { id: ART }, "iatt_sessione=" + scaduta);
  check("sessione scaduta: 401", r.statusCode === 401);

  const vecchia = A.creaSessione(id, Math.floor(Date.now() / 1000) - (A.SESSIONE_S - 30 * 86400));
  r = await get(completo, { id: ART }, "iatt_sessione=" + vecchia);
  check("sessione a un mese dalla scadenza: valida e rinnovata", r.statusCode === 200 && (r.multiValueHeaders || {})["Set-Cookie"].length === 2);

  r = await get(completo, { id: "non-un-uuid" }, sess);
  check("id non valido: 404", r.statusCode === 404);

  // ---- sessione ----
  r = await get(lettore, {}, sess);
  check("lettore GET: chi sono", r.statusCode === 200 && JSON.parse(r.body).email === "t@esempio.it");
  r = await post(lettore, { azione: "newsletter" }, { cookie: sess });
  check("lettore: iscrizione alla newsletter con un clic", r.statusCode === 200 && db.subscribers.get("t@esempio.it").status === "confirmed");
  r = await post(lettore, { azione: "esci" });
  check("esci: cancella i due cookie anche senza sessione",
    r.statusCode === 200 && r.multiValueHeaders["Set-Cookie"].every((c) => /Max-Age=0/.test(c)));
  r = await post(lettore, { azione: "elimina" }, { cookie: sess, "sec-fetch-site": "cross-site" });
  check("elimina da un altro sito: rifiutato, account intatto", r.statusCode === 403 && db.lettori.size === 1);
  r = await post(lettore, { azione: "elimina" }, { cookie: sess });
  check("elimina: account cancellato", r.statusCode === 200 && db.lettori.size === 0);
  check("  ^ la newsletter resta (si gestisce dal link nelle email)", db.subscribers.get("t@esempio.it").status === "confirmed");
  r = await get(completo, { id: ART }, sess);
  check("  ^ e il vecchio cookie non apre piu' gli articoli", r.statusCode === 401);

  console.log("\n" + risultati.length + " controlli, " + risultati.filter((x) => !x).length + " falliti");
  if (risultati.some((x) => !x)) process.exit(1);
})();
