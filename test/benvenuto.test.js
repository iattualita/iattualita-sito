// Mail di benvenuto: una sola, solo ai nuovi iscritti confermati.
process.env.SUPABASE_SERVICE_ROLE_KEY = "sb_secret_prova";
process.env.BREVO_API_KEY = "brevo-prova";
process.env.LETTORI_SECRET = "segreto-di-prova-abbastanza-lungo";

const path = require("path");
const FN = path.join(__dirname, "..", "netlify", "functions");

let subs, mail, colonnaMancante, seq;
const risp = (status, data) => ({ ok: status < 300, status, json: async () => data, text: async () => JSON.stringify(data), headers: { get: () => null } });
const param = (u, k) => { const m = u.match(new RegExp("[?&]" + k + "=eq\\.([^&]+)")); return m ? decodeURIComponent(m[1]) : null; };
global.fetch = async (url, opt = {}) => {
  const u = String(url);
  const metodo = opt.method || "GET";
  if (u.includes("api.brevo.com")) { mail.push(JSON.parse(opt.body)); return risp(201, {}); }
  if (u.includes("/lettori")) return risp(201, [{ id: "bbbbbbbb-bbbb-4bbb-8bbb-bbbbbbbbbbbb", email: JSON.parse(opt.body).email }]);
  if (u.includes("/subscribers")) {
    if (metodo === "GET") {
      const e = param(u, "email"), t = param(u, "token");
      return risp(200, subs.filter((s) => (e && s.email === e) || (t && s.token === t)));
    }
    if (metodo === "POST") { const b = JSON.parse(opt.body); subs.push({ id: "n" + (++seq), benvenuto_at: null, ...b }); return risp(201, null); }
    if (metodo === "PATCH") {
      const b = JSON.parse(opt.body);
      if ("benvenuto_at" in b) {
        if (colonnaMancante) return risp(400, { message: "column benvenuto_at does not exist" });
        const e = param(u, "email");
        const hit = subs.filter((s) => s.email === e && s.status === "confirmed" && !s.benvenuto_at);
        hit.forEach((s) => (s.benvenuto_at = b.benvenuto_at));
        return risp(200, hit.map((s) => ({ id: s.id, email: s.email, token: s.token })));
      }
      const id = param(u, "id");
      Object.assign(subs.find((s) => s.id === id), b);
      return risp(204, null);
    }
  }
  throw new Error("inattesa " + metodo + " " + u);
};

const A = require(path.join(FN, "_lettori-lib.js"));
const confirm = require(path.join(FN, "confirm.js")).handler;

const risultati = [];
function check(nome, cond, extra) {
  risultati.push(cond);
  console.log((cond ? "  PASS  " : "> FAIL <") + nome);
  if (!cond && extra !== undefined) console.log("          " + JSON.stringify(extra).slice(0, 300));
}
const reset = () => {
  mail = []; colonnaMancante = false; seq = 0;
  subs = [
    { id: "vecchio", email: "vecchio@esempio.it", token: "tv", status: "confirmed", benvenuto_at: "2026-10-01T00:00:00Z" },
    { id: "andato", email: "andato@esempio.it", token: "ta", status: "unsubscribed", benvenuto_at: "2026-09-01T00:00:00Z" },
    { id: "attesa", email: "attesa@esempio.it", token: "tp", status: "pending", benvenuto_at: null }
  ];
};

(async () => {
  reset();
  await A.newsletterIscrivi("nuova@esempio.it");
  check("nuovo iscritto dal sito: una mail di benvenuto", mail.length === 1 && mail[0].to[0].email === "nuova@esempio.it" && mail[0].subject === "Benvenuto in IAttualità", mail.map((m) => m.subject));
  check("  ^ con la testata, il pulsante che fa entrare e la disiscrizione", /email-testata\.png/.test(mail[0].htmlContent) && /functions\/entra\?s=/.test(mail[0].htmlContent) && /unsubscribe\?token=/.test(mail[0].htmlContent));
  check("  ^ con gli header di disiscrizione in un clic", !!(mail[0].headers && mail[0].headers["List-Unsubscribe"]));
  await A.newsletterIscrivi("nuova@esempio.it");
  check("iscriversi di nuovo: nessun secondo benvenuto", mail.length === 1);

  reset();
  await A.newsletterIscrivi("vecchio@esempio.it");
  check("chi era gia' iscritto: niente benvenuto", mail.length === 0);
  await A.newsletterIscrivi("andato@esempio.it");
  check("chi si reiscrive dopo essersene andato: niente benvenuto", mail.length === 0 && subs.find((s) => s.id === "andato").status === "confirmed");

  reset();
  await confirm({ httpMethod: "POST", headers: {}, queryStringParameters: { token: "tp" } });
  check("conferma dal link (vecchio modulo): benvenuto", mail.length === 1 && mail[0].to[0].email === "attesa@esempio.it");
  await confirm({ httpMethod: "GET", headers: {}, queryStringParameters: { token: "tp" } });
  check("  ^ riaprire il link non ne manda un altro", mail.length === 1);

  reset(); colonnaMancante = true;
  const esito = await A.newsletterIscrivi("senza009@esempio.it");
  check("migrazione 009 mancante: l'iscrizione riesce lo stesso, senza benvenuto", esito === "iscritto" && mail.length === 0);

  console.log("\n" + risultati.length + " controlli, " + risultati.filter((x) => !x).length + " falliti");
  if (risultati.some((x) => !x)) process.exit(1);
})();
