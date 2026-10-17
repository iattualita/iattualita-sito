// shared/safe-body.js
//
// Sanificazione per allowlist dell'HTML scritto in redazione.
// Usata dal prerender (corpo degli articoli) e dalla pagina riservata agli
// iscritti (articoli degli invii speciali): un solo filtro, cosi' una
// correzione vale ovunque e nessuno dei due resta indietro.

// ---------- sanificazione del corpo degli articoli ----------
//
// Il corpo arriva dal database e viene iniettato tale e quale nella pagina:
// e' l'unico punto in cui un contenuto memorizzato diventa HTML per ogni
// visitatore, quindi merita di essere trattato con sospetto anche se a
// scriverlo e' la redazione.
//
// Prima si elencava cio' che era VIETATO (<script>, <iframe>, gli attributi
// on*, "javascript:"). E' un approccio che perde: <img/onerror=...> sfugge
// perche' la barra non e' uno spazio, e "javascript:" si scrive anche
// &#106;avascript: — il browser decodifica, l'espressione regolare no.
//
// Ora si elenca cio' che e' PERMESSO. Ogni tag viene riscritto da zero
// tenendo solo gli attributi in lista: un gestore di eventi non passa piu'
// per costruzione, comunque lo si mascheri, perche' non e' in elenco.
//
// La lista viene dai 131 articoli davvero pubblicati: p, span, br, li, h3,
// div, ul, h2, b, a, blockquote, font, hr, piu' quelli che potrebbero
// servire in futuro. Nessun articolo esistente perde formattazione.
const ATTR_COMUNI = ["style", "dir", "class", "id", "title", "lang", "role"];
const TAG_AMMESSI = {
  p: [], br: [], span: [], div: [], hr: [],
  h2: [], h3: [], h4: [], h5: [], h6: [],
  ul: [], ol: [], li: [],
  b: [], strong: [], i: [], em: [], u: [], s: [], sub: [], sup: [], small: [], mark: [],
  blockquote: [], code: [], pre: [], figure: [], figcaption: [],
  table: [], thead: [], tbody: [], tfoot: [], tr: [], th: [], td: [],
  a: ["href", "target", "rel"],
  img: ["src", "alt", "width", "height", "loading"],
  font: ["color", "size"]
};
// Elementi il cui CONTENUTO va buttato, non solo il tag: lasciare il testo
// di uno <script> dentro la pagina non e' pericoloso, ma e' spazzatura che
// il crawler leggerebbe come parte dell'articolo.
const TAG_CON_CONTENUTO_DA_BUTTARE = "script|style|iframe|object|embed|svg|math|form|template|noscript|title";

// Un indirizzo e' accettabile solo se punta al web, alla posta o al sito
// stesso. Prima di deciderlo si decodificano le entita' e si tolgono spazi e
// caratteri di controllo, che sono il modo classico di nascondere
// "javascript:" a un controllo fatto sulla stringa grezza.
function urlSicuro(u) {
  const pulito = String(u)
    .replace(/&#x([0-9a-f]+);?/gi, (_, h) => String.fromCharCode(parseInt(h, 16)))
    .replace(/&#(\d+);?/g, (_, d) => String.fromCharCode(Number(d)))
    .replace(/[\s\u0000-\u001F\u007F]/g, "")
    .toLowerCase();
  return /^(https?:\/\/|mailto:|tel:|\/|#)/.test(pulito);
}

// Nel valore di style restano pericolosi solo due costrutti storici, e
// url() che punti altrove. Il resto e' formattazione.
function styleSicuro(v) {
  const s = String(v);
  if (/expression\s*\(|javascript\s*:|@import|behavior\s*:/i.test(s)) return null;
  const urls = s.match(/url\s*\(([^)]*)\)/gi) || [];
  for (const u of urls) {
    if (!urlSicuro(u.replace(/^url\s*\(\s*['"]?|['"]?\s*\)$/gi, ""))) return null;
  }
  return s;
}

function safeBody(html) {
  let s = String(html ?? "");

  // 1. Via gli elementi vietati, contenuto compreso.
  s = s.replace(new RegExp("<(" + TAG_CON_CONTENUTO_DA_BUTTARE + ")\\b[\\s\\S]*?</\\1\\s*>", "gi"), "");
  // 2. E le loro versioni lasciate aperte, piu' quelle senza chiusura.
  s = s.replace(new RegExp("</?(" + TAG_CON_CONTENUTO_DA_BUTTARE + "|base|link|meta)\\b[^>]*>", "gi"), "");
  // 3. I commenti HTML: possono nascondere markup e confondere il parser.
  s = s.replace(/<!--[\s\S]*?-->/g, "");

  // 4. Ogni tag rimasto viene ricostruito da zero.
  s = s.replace(/<(\/?)\s*([a-zA-Z][a-zA-Z0-9]*)\b([^>]*)>/g, (_tutto, chiusura, nome, attrs) => {
    const tag = nome.toLowerCase();
    if (!Object.prototype.hasOwnProperty.call(TAG_AMMESSI, tag)) return "";
    if (chiusura) return "</" + tag + ">";

    const ammessi = ATTR_COMUNI.concat(TAG_AMMESSI[tag]);
    let out = "<" + tag;
    const re = /([a-zA-Z][a-zA-Z0-9-]*)\s*=\s*("([^"]*)"|'([^']*)'|([^\s"'>]+))/g;
    let m;
    while ((m = re.exec(attrs)) !== null) {
      const an = m[1].toLowerCase();
      // aria-* passa: serve agli screen reader e non puo' eseguire nulla.
      if (!ammessi.includes(an) && !an.startsWith("aria-")) continue;
      let av = m[3] !== undefined ? m[3] : m[4] !== undefined ? m[4] : m[5] || "";
      if ((an === "href" || an === "src") && !urlSicuro(av)) continue;
      if (an === "style") {
        const pulito = styleSicuro(av);
        if (pulito === null) continue;
        av = pulito;
      }
      out += " " + an + '="' + av.replace(/&/g, "&amp;").replace(/"/g, "&quot;").replace(/</g, "&lt;").replace(/>/g, "&gt;") + '"';
    }
    // I link esterni non devono poter manipolare la pagina che li ha aperti.
    if (tag === "a" && / target="/.test(out) && !/ rel="/.test(out)) out += ' rel="noopener noreferrer"';
    return out + ">";
  });

  return s;
}

export { safeBody, urlSicuro };
