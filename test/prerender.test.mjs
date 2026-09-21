// Esegue davvero le edge function con un finto Supabase al posto di quello
// vero. Serve a verificare che dopo l'estrazione dei testi in
// shared/site-pages.js il crawler riceva ancora pagine complete, e che gli
// indirizzi inesistenti rispondano 404 invece di una copia della home.
import fs from "node:fs";
import path from "node:path";
import { fileURLToPath } from "node:url";

const REPO = path.join(path.dirname(fileURLToPath(import.meta.url)), "..");
const SHELL = fs.readFileSync(path.join(REPO, "index.html"), "utf8");

const ARTICOLO = {
  id: 42,
  title: "Titolo dell'articolo",
  subtitle: "Occhiello",
  body: "<p>Corpo con un $& e un apostrofo d'esempio.</p><script>alert(1)</script>",
  category: "Geopolitica",
  author_name: "Lorenzo",
  date: "2026-09-20",
  image: "https://wzkshpgakvasqwrrgkgd.supabase.co/x/cover.png"
};

// Finto Supabase: risponde secondo la tabella richiesta.
global.fetch = async (url) => {
  const u = String(url);
  const ok = (d) => new Response(JSON.stringify(d), { status: 200, headers: { "content-type": "application/json" } });
  if (u.includes("/site_info")) return ok([{ id: 1, email: "redazione@iattualita.it", phone: "+39 000", instagram: "https://instagram.com/iattualita" }]);
  if (u.includes("/news?id=eq.42")) return ok([ARTICOLO]);
  if (u.includes("/news?id=eq.")) return ok([]);                 // articolo inesistente
  if (u.includes("category=eq.Vuota")) return ok([]);            // categoria senza articoli
  if (u.includes("/news")) return ok([ARTICOLO]);
  return ok([]);
};

const prerender = (await import(path.join(REPO, "netlify/edge-functions/prerender.js"))).default;
const sitemap = (await import(path.join(REPO, "netlify/edge-functions/sitemap.js"))).default;
const newsSitemap = (await import(path.join(REPO, "netlify/edge-functions/news-sitemap.js"))).default;

const contesto = { next: async () => new Response(SHELL, { status: 200, headers: { "content-type": "text/html; charset=utf-8" } }) };
const chiedi = (p) => prerender(new Request("https://iattualita.it" + p), contesto);

const results = [];
function check(name, cond, extra) {
  results.push(cond);
  console.log((cond ? "  PASS  " : "> FAIL <") + name);
  if (!cond && extra) console.log("          " + String(extra).slice(0, 300));
}

// ---- home ----
let r = await chiedi("/");
let h = await r.text();
// Il titolo esce con l'apostrofo convertito in entita': e' corretto, ed e'
// anche cio' che impedisce a un titolo contenente virgolette di spezzare
// l'HTML servito al crawler.
check("home: 200 e link agli articoli nell'HTML grezzo",
  r.status === 200 && h.includes('href="/articolo/42/titolo-dell-articolo"'), r.status);
check("  ^ e il titolo e' presente, con l'apostrofo messo in sicurezza",
  h.includes("Titolo dell&#39;articolo") && !h.includes("Titolo dell'articolo"));

// ---- pagina istituzionale (il testo ora arriva dal modulo condiviso) ----
r = await chiedi("/chi-siamo");
h = await r.text();
check("chi-siamo: 200, h1 e testo dal modulo condiviso",
  r.status === 200 && h.includes("<h1") && h.includes("La nostra missione") && h.includes("Chi siamo · Iattualità"), r.status);

r = await chiedi("/standard-editoriali");
h = await r.text();
check("standard-editoriali: presunzione di innocenza nel testo servito",
  r.status === 200 && h.includes("Presunzione di innocenza"));

// ---- contatti e social ----
r = await chiedi("/contatti");
h = await r.text();
check("contatti: 200, recapiti dal database e JSON-LD ContactPage",
  r.status === 200 && h.includes("redazione@iattualita.it") && h.includes('"@type":"ContactPage"'), r.status);
check("  ^ e i canali social finiscono in sameAs", h.includes("instagram.com/iattualita"));

r = await chiedi("/social");
h = await r.text();
check("social: 200 e h1 Seguici", r.status === 200 && h.includes(">Seguici<"), r.status);

// ---- articolo ----
r = await chiedi("/articolo/42/titolo-dell-articolo");
h = await r.text();
check("articolo: 200, corpo iniettato e JSON-LD NewsArticle",
  r.status === 200 && h.includes("Corpo con un") && h.includes('"@type":"NewsArticle"'), r.status);
check("  ^ lo <script> dentro il corpo viene rimosso",
  !h.includes("alert(1)"));
check("  ^ il $& del testo non viene interpretato come pattern",
  h.includes("$&"));
check("  ^ la cover passa dalla Image CDN, non da Supabase diretto",
  h.includes("/.netlify/images?url=") && !h.includes('src="https://wzkshpgakvasqwrrgkgd'));

// ---- 404 veri ----
r = await chiedi("/articolo/999/inesistente");
check("articolo inesistente: 404 vero, non una home con stato 200", r.status === 404, r.status);
h = await r.text();
check("  ^ e con noindex", h.includes('name="robots" content="noindex"'));

r = await chiedi("/questa-pagina-non-esiste");
check("indirizzo inventato: 404 vero", r.status === 404, r.status);

r = await chiedi("/argomento/Vuota");
check("categoria senza articoli: 404 vero", r.status === 404, r.status);

// ---- sitemap ----
const xml = await (await sitemap()).text();
for (const p of ["/chi-siamo", "/standard-editoriali", "/rettifiche", "/trasparenza-ia", "/privacy", "/contatti", "/social", "/newsletter", "/archivio"]) {
  check("sitemap contiene " + p, xml.includes("<loc>https://iattualita.it" + p + "</loc>"));
}
check("sitemap: l'articolo ha lo stesso slug del link in home",
  xml.includes("<loc>https://iattualita.it/articolo/42/titolo-dell-articolo</loc>"),
  xml.match(/articolo\/42\/[a-z-]+/));

// ---- news sitemap ----
const nxml = await (await newsSitemap()).text();
check("news-sitemap: l'articolo di ieri c'e', con lo stesso slug",
  nxml.includes("/articolo/42/titolo-dell-articolo") && nxml.includes("<news:publication_date>"));

const falliti = results.filter((x) => !x).length;
console.log("\n" + results.length + " controlli, " + falliti + " falliti");
process.exit(falliti ? 1 : 0);
