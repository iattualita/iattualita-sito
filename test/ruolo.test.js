// Ruolo "giornalista": send-digest deve rifiutarlo prima di toccare la lista
// iscritti, e lasciar passare i soci. Finto Supabase, nessuna chiamata esce.
process.env.SUPABASE_URL = "https://finto.supabase.test";
process.env.SUPABASE_SERVICE_ROLE_KEY = "sb_secret_finta";
process.env.BREVO_API_KEY = "finta";
process.env.SITE_URL = "https://iattualita.test";

const path = require("path");
const L = require(path.join(__dirname, "..", "netlify/functions/_newsletter-lib.js"));
const { handler } = require(path.join(__dirname, "..", "netlify/functions/send-digest.js"));

const utenti = {
  socio:       { id: "u-socio", email: "socio@test", app_metadata: { provider: "email" } },
  giornalista: { id: "u-giorn", email: "giorn@test", app_metadata: { provider: "email", ruolo: "giornalista" } },
};
let chiamateRest = 0;
global.fetch = async (url, opt = {}) => {
  const u = String(url);
  const ok = (data) => ({ ok: true, status: 200, json: async () => data, text: async () => JSON.stringify(data) });
  if (u.endsWith("/auth/v1/user")) {
    const tok = String((opt.headers || {}).Authorization || "").replace(/^Bearer\s+/, "");
    const user = utenti[tok];
    return user ? ok(user) : { ok: false, status: 401, json: async () => ({}), text: async () => "" };
  }
  chiamateRest++;
  if (u.includes("/newsletter_log")) return ok([]);
  return ok([]);
};

let falliti = 0, controlli = 0;
function check(nome, cond) { controlli++; if (cond) console.log("  PASS  " + nome); else { falliti++; console.log("  FAIL  " + nome); } }

(async () => {
  check("isGiornalista: ruolo giornalista", L.isGiornalista(utenti.giornalista) === true);
  check("isGiornalista: socio senza ruolo", L.isGiornalista(utenti.socio) === false);
  check("isGiornalista: utente nullo", L.isGiornalista(null) === false);

  const ev = (tok) => ({ httpMethod: "POST", headers: { authorization: "Bearer " + tok }, body: JSON.stringify({ dry: true }) });

  chiamateRest = 0;
  let r = await handler(ev("giornalista"));
  check("send-digest: giornalista -> 403", r.statusCode === 403);
  check("send-digest: giornalista non tocca il database", chiamateRest === 0);

  r = await handler(ev("socio"));
  check("send-digest: socio passa", r.statusCode === 200);

  r = await handler(ev("sconosciuto"));
  check("send-digest: token non valido -> 401", r.statusCode === 401);

  console.log("\n" + controlli + " controlli, " + falliti + " falliti");
  if (falliti) process.exit(1);
})();
