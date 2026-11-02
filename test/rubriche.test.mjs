// Rubriche video (TG del venerdi', meteo del lunedi'): pagine /tg e /meteo,
// testo libero per tutti, player verticale e VideoObject. Le funzioni girano
// davvero, con un finto Supabase al posto di quello vero.
import fs from "node:fs";
import path from "node:path";
import { createRequire } from "node:module";
import { fileURLToPath } from "node:url";

const REPO = path.join(path.dirname(fileURLToPath(import.meta.url)), "..");
const require = createRequire(import.meta.url);
const SHELL = fs.readFileSync(path.join(REPO, "index.html"), "utf8");

process.env.LETTORI_SECRET = "segreto-di-prova-abbastanza-lungo";
process.env.SUPABASE_SERVICE_ROLE_KEY = "sb_secret_prova";
globalThis.Netlify = { env: { get: (k) => (k === "SUPABASE_SERVICE_ROLE_KEY" ? "sb_secret_prova" : undefined) } };

const TG_ID = "22222222-2222-4222-8222-222222222222";
const ART_ID = "33333333-3333-4333-8333-333333333333";
const IERI = new Date(Date.now() - 864e5).toISOString().slice(0, 10);
const TG = {
  id: TG_ID, title: "TG di venerdì: le cinque notizie", subtitle: "Manovra, Ucraina, scuola",
  category: "Attualità", serie: "TG", date: IERI, author_name: "Lorenzo",
  video: "https://youtube.com/shorts/AbCdEfGhIjK", anteprima: "Buongiorno da Iattualità. Partiamo dalla manovra"
};
const ARTICOLO = { id: ART_ID, title: "Articolo riservato", category: "Economia", serie: null, date: IERI, anteprima: "Inizio" };
const TESTI = {
  [TG_ID]: { id: TG_ID, body: "<p>COPIONE-DEL-TG</p>", summary: "", serie: "TG" },
  [ART_ID]: { id: ART_ID, body: "<p>TESTO-RISERVATO</p>", summary: "", serie: null }
};

const ok = (d) => new Response(JSON.stringify(d), { status: 200, headers: { "content-type": "application/json" } });
global.fetch = async (url) => {
  const u = String(url);
  if (u.includes("googlebot.json") || u.includes("bingbot.json")) return ok({ prefixes: [] });
  const id = (u.match(/id=eq\.([0-9a-f-]+)/) || [])[1];
  // Testo integrale: prerender (select=body,summary) e articolo-completo (con serie)
  if (u.includes("select=body,summary") || u.includes("select=id,body,summary")) return ok(TESTI[id] ? [TESTI[id]] : []);
  if (id) return ok(id === TG_ID ? [TG] : id === ART_ID ? [ARTICOLO] : []);
  if (u.includes("serie=not.is.null")) return ok([{ id: TG_ID, title: TG.title, subtitle: TG.subtitle, serie: "TG" }]);
  if (u.includes("/news")) return ok([TG, ARTICOLO]);
  return ok([]);
};

const risultati = [];
function check(nome, cond, extra) {
  risultati.push(cond);
  console.log((cond ? "  PASS  " : "> FAIL <") + nome);
  if (!cond && extra !== undefined) console.log("          " + String(extra).slice(0, 300));
}

// ---- le due liste delle rubriche libere coincidono ----
const { RUBRICHE, SERIE_ALIAS, youtubeId } = await import(path.join(REPO, "shared/site-pages.js"));
const A = require(path.join(REPO, "netlify/functions/_lettori-lib.js"));
check("RUBRICHE (site-pages) e RUBRICHE_LIBERE (_lettori-lib) coincidono",
  JSON.stringify(Object.keys(RUBRICHE).sort()) === JSON.stringify([...A.RUBRICHE_LIBERE].sort()),
  Object.keys(RUBRICHE) + " / " + A.RUBRICHE_LIBERE);
check("ogni rubrica ha un indirizzo breve (/tg, /meteo)",
  Object.keys(RUBRICHE).every((k) => SERIE_ALIAS[k]) && SERIE_ALIAS.TG === "/tg" && SERIE_ALIAS.Meteo === "/meteo");
check("youtubeId riconosce gli Shorts", youtubeId("https://youtube.com/shorts/AbCdEfGhIjK?feature=share") === "AbCdEfGhIjK");

// ---- articolo-completo: testo libero solo per le rubriche ----
const completo = require(path.join(REPO, "netlify/functions/articolo-completo.js")).handler;
const get = (id) => completo({ httpMethod: "GET", headers: {}, queryStringParameters: { id } });
let r = await get(TG_ID);
check("articolo-completo senza accesso, edizione del TG: 200 con il testo",
  r.statusCode === 200 && JSON.parse(r.body).body.includes("COPIONE-DEL-TG"), r.statusCode + " " + r.body);
r = await get(ART_ID);
check("articolo-completo senza accesso, articolo normale: 401 come prima",
  r.statusCode === 401 && !String(r.body).includes("TESTO-RISERVATO"), r.statusCode);

// ---- prerender ----
const prerender = (await import(path.join(REPO, "netlify/edge-functions/prerender.js"))).default;
const contesto = { next: async () => new Response(SHELL, { status: 200, headers: { "content-type": "text/html; charset=utf-8" } }), ip: "93.40.1.1" };
const chiedi = (p) => prerender(new Request("https://iattualita.it" + p), contesto);

r = await chiedi("/articolo/" + TG_ID + "/tg");
let h = await r.text();
check("edizione del TG, visitatore qualunque: testo completo nell'HTML", r.status === 200 && h.includes("COPIONE-DEL-TG"), r.status);
check("  ^ senza blocco di registrazione e senza classe .paywall",
  !h.includes("Continua a leggere") && !h.includes('class="paywall"') && h.includes('class="article-body" data-corpo-completo'));
check("  ^ dichiarata libera a Google (isAccessibleForFree true, niente cssSelector)",
  h.includes('"isAccessibleForFree":true') && !h.includes('"cssSelector":".paywall"'));
check("  ^ VideoObject con embed e miniatura dello Short",
  h.includes('"@type":"VideoObject"') && h.includes("youtube.com/embed/AbCdEfGhIjK") && h.includes("img.youtube.com/vi/AbCdEfGhIjK"));
check("  ^ anteprima del video 9:16 al posto della copertina",
  h.includes("aspect-ratio:9/16") && h.includes("youtube.com/shorts/AbCdEfGhIjK"));
check("  ^ link a tutte le edizioni (/tg)", h.includes('href="/tg"'));
check("  ^ cache condivisa ammessa: il testo e' uguale per tutti",
  (r.headers.get("cache-control") || "").includes("public"), r.headers.get("cache-control"));

r = await chiedi("/articolo/" + ART_ID + "/articolo-riservato");
h = await r.text();
check("articolo normale, visitatore qualunque: resta riservato",
  !h.includes("TESTO-RISERVATO") && h.includes("Continua a leggere") && h.includes('"isAccessibleForFree":false'));

r = await chiedi("/tg");
h = await r.text();
check("/tg: 200, titolo e descrizione della rubrica, link all'edizione",
  r.status === 200 && h.includes("TG Iattualità · Il telegiornale del venerdì") && h.includes(TG_ID), r.status);

r = await chiedi("/meteo");
h = await r.text();
check("/meteo senza edizioni: 200 (ci porta il menu), non 404", r.status === 200, r.status);
check("  ^ con noindex finche' e' vuota, e il messaggio d'attesa",
  h.includes('name="robots" content="noindex"') && !h.includes('content="index, follow') && h.includes("La prima edizione è in arrivo"));

r = await chiedi("/serie/inesistente");
check("serie che non esiste: resta un 404 vero", r.status === 404, r.status);

console.log("\n" + risultati.length + " controlli, " + risultati.filter((x) => !x).length + " falliti");
if (risultati.some((x) => !x)) process.exit(1);
