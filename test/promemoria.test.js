// Promemoria a chi non ha confermato (send-promemoria.js) e accesso
// automatico dopo la conferma (confirm.js), con Supabase e Brevo finti.
process.env.SUPABASE_SERVICE_ROLE_KEY = "sb_secret_prova";
process.env.BREVO_API_KEY = "brevo-prova";
process.env.LETTORI_SECRET = "segreto-di-prova-abbastanza-lungo";

const path = require("path");
const FN = path.join(__dirname, "..", "netlify", "functions");

let subs, mail, colonnaMancante, ruolo, lettori;
const risp = (status, data, headers) => ({
  ok: status < 300, status,
  json: async () => data, text: async () => JSON.stringify(data),
  headers: { get: (k) => (headers || {})[k.toLowerCase()] || null }
});
global.fetch = async (url, opt = {}) => {
  const u = decodeURIComponent(String(url));
  const metodo = opt.method || "GET";
  if (u.includes("api.brevo.com")) { mail.push(JSON.parse(opt.body)); return risp(201, {}); }
  if (u.includes("/auth/v1/user")) return risp(200, { id: "u1", app_metadata: ruolo ? { ruolo } : {} });
  if (u.includes("/lettori")) { const b = JSON.parse(opt.body); lettori.push(b.email); return risp(201, [{ id: "bbbbbbbb-bbbb-4bbb-8bbb-bbbbbbbbbbbb", email: b.email }]); }
  if (u.includes("/subscribers")) {
    if (u.includes("promemoria_at") && colonnaMancante) return risp(400, { message: "column promemoria_at does not exist" });
    if (metodo === "PATCH") {
      const id = u.match(/id=eq\.([^&]+)/)[1];
      const s = subs.find((x) => x.id === id);
      Object.assign(s, JSON.parse(opt.body));
      return risp(204, null);
    }
    if (u.includes("token=eq.")) { const t = u.match(/token=eq\.([^&]+)/)[1]; return risp(200, subs.filter((s) => s.token === t)); }
    const attesa = subs.filter((s) => s.status === "pending" && !s.promemoria_at);
    if (opt.headers && opt.headers.Prefer === "count=exact") return risp(206, [], { "content-range": "0-0/" + attesa.length });
    const lim = Number((u.match(/limit=(\d+)/) || [])[1] || 1000);
    return risp(200, attesa.slice(0, lim));
  }
  throw new Error("inattesa " + metodo + " " + u);
};

const promemoria = require(path.join(FN, "send-promemoria.js")).handler;
const confirm = require(path.join(FN, "confirm.js")).handler;
const chiama = (dry) => promemoria({ httpMethod: "POST", headers: { authorization: "Bearer tok" }, body: JSON.stringify({ dry }) });

const risultati = [];
function check(nome, cond, extra) {
  risultati.push(cond);
  console.log((cond ? "  PASS  " : "> FAIL <") + nome);
  if (!cond && extra !== undefined) console.log("          " + JSON.stringify(extra).slice(0, 300));
}

(async () => {
  const reset = () => {
    mail = []; colonnaMancante = false; ruolo = ""; lettori = [];
    subs = Array.from({ length: 30 }, (_, i) => ({ id: "id" + i, email: "p" + i + "@esempio.it", token: "t" + i, status: "pending" }))
      .concat([{ id: "c1", email: "conf@esempio.it", token: "tc", status: "confirmed" }, { id: "u1x", email: "via@esempio.it", token: "tu", status: "unsubscribed" }]);
  };

  reset();
  let r = await chiama(true); let d = JSON.parse(r.body);
  check("anteprima: conta solo chi e' in attesa (30), nessuna mail", r.statusCode === 200 && d.daServire === 30 && mail.length === 0, d);

  r = await chiama(false); d = JSON.parse(r.body);
  check("primo blocco: 25 promemoria, ne restano 5", d.delivered === 25 && d.remaining === 5 && !d.done, d);
  r = await chiama(false); d = JSON.parse(r.body);
  check("secondo blocco: gli ultimi 5, fatto", d.delivered === 5 && d.done, d);
  check("in tutto 30 mail, una per indirizzo", mail.length === 30 && new Set(mail.map((m) => m.to[0].email)).size === 30);
  check("nessuna mail a confermati o disiscritti", !mail.some((m) => /conf@|via@/.test(m.to[0].email)));
  check("la mail ha il link di conferma personale", mail[0].htmlContent.includes("/confirm?token=t0"));
  r = await chiama(false); d = JSON.parse(r.body);
  check("ripremere il pulsante non manda niente a nessuno", mail.length === 30 && d.done, d);

  reset(); ruolo = "giornalista";
  r = await chiama(true);
  check("il giornalista non puo' usarlo", r.statusCode === 403);

  reset(); colonnaMancante = true;
  r = await chiama(true); d = JSON.parse(r.body);
  check("migrazione 008 mancante: messaggio chiaro, nessun invio", r.statusCode === 409 && /008_promemoria_conferma/.test(d.message) && mail.length === 0, d);

  // ---- conferma: iscrizione + accesso agli articoli ----
  reset();
  r = await confirm({ httpMethod: "POST", headers: {}, queryStringParameters: { token: "t3" } });
  const cookies = (r.multiValueHeaders || {})["Set-Cookie"] || [];
  check("conferma: iscritto e dentro il sito (cookie di sessione)", subs[3].status === "confirmed" && cookies.some((c) => /^iatt_sessione=v1\./.test(c)) && lettori[0] === "p3@esempio.it", cookies);
  r = await confirm({ httpMethod: "GET", headers: {}, queryStringParameters: { token: "t4" } });
  check("la GET (antivirus delle email) non conferma e non fa entrare", subs[4].status === "pending" && !r.multiValueHeaders);

  console.log("\n" + risultati.length + " controlli, " + risultati.filter((x) => !x).length + " falliti");
  if (risultati.some((x) => !x)) process.exit(1);
})();
