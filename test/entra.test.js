// Accesso diretto dai link della newsletter (entra.js + linkEntra).
process.env.LETTORI_SECRET = "segreto-di-prova-abbastanza-lungo";
process.env.SUPABASE_SERVICE_ROLE_KEY = "sb_secret_prova";
process.env.BREVO_API_KEY = "brevo-prova";

const path = require("path");
const FN = path.join(__dirname, "..", "netlify", "functions");

const SUB = "aaaaaaaa-aaaa-4aaa-8aaa-aaaaaaaaaaaa";
let iscritti, lettori;
const risp = (status, data) => ({ ok: status < 300, status, json: async () => data, text: async () => JSON.stringify(data) });
global.fetch = async (url, opt = {}) => {
  const u = String(url);
  if (u.includes("/subscribers?id=eq.")) { const id = u.match(/id=eq\.([^&]+)/)[1]; return risp(200, iscritti[id] ? [iscritti[id]] : []); }
  if (u.includes("/lettori")) {
    const b = JSON.parse(opt.body);
    lettori[b.email] = lettori[b.email] || { id: "bbbbbbbb-bbbb-4bbb-8bbb-bbbbbbbbbbbb", email: b.email };
    return risp(201, [lettori[b.email]]);
  }
  throw new Error("chiamata inattesa " + u);
};

const L = require(path.join(FN, "_newsletter-lib.js"));
const entra = require(path.join(FN, "entra.js")).handler;

const risultati = [];
function check(nome, cond, extra) {
  risultati.push(cond);
  console.log((cond ? "  PASS  " : "> FAIL <") + nome);
  if (!cond && extra !== undefined) console.log("          " + JSON.stringify(extra).slice(0, 300));
}
const parametri = (link) => Object.fromEntries(new URL(link).searchParams);
const apri = (qs) => entra({ httpMethod: "GET", headers: {}, queryStringParameters: qs });
const sessione = (r) => ((r.multiValueHeaders || {})["Set-Cookie"] || []).some((c) => /^iatt_sessione=v1\./.test(c));

(async () => {
  iscritti = { [SUB]: { id: SUB, email: "iscritto@esempio.it", status: "confirmed" } };
  lettori = {};
  const percorso = "/articolo/42/titolo";
  const link = L.linkEntra(SUB, percorso);
  check("il link della newsletter passa da entra, firmato", /\/\.netlify\/functions\/entra\?s=.+&e=\d+&f=.+&a=/.test(link), link);

  let r = await apri(parametri(link));
  check("link valido: porta all'articolo", r.statusCode === 302 && r.headers.Location === "https://iattualita.it" + percorso, r.headers);
  check("  ^ ed entra gia' riconosciuto (cookie di sessione)", sessione(r));
  check("  ^ crea l'account di lettura con l'email dell'iscritto", !!lettori["iscritto@esempio.it"]);
  check("  ^ niente referrer, niente cache", r.headers["Referrer-Policy"] === "no-referrer" && r.headers["Cache-Control"] === "private, no-store");

  const p = parametri(link);
  r = await apri({ ...p, s: "cccccccc-cccc-4ccc-8ccc-cccccccccccc" });
  check("id cambiato: va all'articolo ma senza accesso", r.statusCode === 302 && !sessione(r) && r.headers.Location.endsWith(percorso));
  r = await apri({ ...p, e: String(Number(p.e) + 86400) });
  check("scadenza allungata a mano: senza accesso", !sessione(r));
  r = await apri(parametri(L.linkEntra(SUB, percorso, Math.floor(Date.now() / 1000) - 61 * 86400)));
  check("link di piu' di 60 giorni fa: senza accesso", !sessione(r));
  r = await apri({ ...p, a: "https://sito-malevolo.example/" });
  check("destinazione esterna: si resta su iattualita.it", r.headers.Location === "https://iattualita.it/", r.headers.Location);
  r = await apri({ ...p, a: "//sito-malevolo.example/articolo/1" });
  check("destinazione con doppia barra: si resta su iattualita.it", r.headers.Location === "https://iattualita.it/", r.headers.Location);

  iscritti[SUB].status = "unsubscribed";
  r = await apri(p);
  check("chi si e' disiscritto: il link non fa piu' entrare", !sessione(r) && r.headers.Location.endsWith(percorso));
  iscritti[SUB].status = "confirmed";

  const html = L.digestHtml([{ id: 42, title: "Titolo", category: "Economia" }], "https://x/unsub", (a) => L.linkEntra(SUB, L.articlePath(a)));
  check("nel digest i link agli articoli sono quelli personali", (html.match(/functions\/entra\?s=/g) || []).length === 2);
  check("  ^ e la mail avverte di non inoltrarla", html.includes("meglio non inoltrare"));

  console.log("\n" + risultati.length + " controlli, " + risultati.filter((x) => !x).length + " falliti");
  if (risultati.some((x) => !x)) process.exit(1);
})();
