// netlify/edge-functions/prerender.js
//
// SOSTITUISCE la Edge Function OG attuale.
// (Cancella la vecchia, altrimenti girano entrambe sullo stesso path.)
//
// Cosa fa:
//  1. Riscrive il blocco OG_START/OG_END con i meta dell'articolo (come prima)
//  2. Inietta il CORPO dell'articolo nell'HTML grezzo, dentro #root
//  3. Aggiunge JSON-LD NewsArticle
//  4. Restituisce un vero 404 se l'articolo non esiste
//  5. In home, inietta i link ai 30 articoli piu' recenti (link crawlabili)
//
// React sovrascrive il contenuto di #root al mount: l'utente non vede
// differenza, il crawler riceve il testo gia' pronto. Stesso contenuto,
// nessun cloaking.

import { slugify, SERIE_ALIAS, SOCIALS, STATIC_PAGES as PAGES } from "../../shared/site-pages.js";

const SUPABASE_URL = "https://wzkshpgakvasqwrrgkgd.supabase.co";
const SUPABASE_KEY = "sb_publishable_I3s4phA5Be9qnV4pLbWQMQ_8-IGUE-b";
const SITE = "https://iattualita.it";
const OG_DEFAULT = SITE + "/og-default.jpg";

// Se le anteprime social si rompessero, metti false e rideploya: si torna
// a servire og:image direttamente da Supabase, senza toccare altro codice.
const OG_VIA_CDN = true;

// ---------- Netlify Image CDN ----------
// Senza questo, l'HTML pre-renderizzato faceva scaricare al browser la cover
// ORIGINALE da Supabase a OGNI apertura di articolo: imgCDN() di app.jsx entra
// in gioco solo dopo il mount di React, troppo tardi per evitare il download.
// Il dominio Supabase e' gia' in allowlist nel blocco [images] di netlify.toml.
// w=900 e' lo stesso valore usato da ArticlePage in app.jsx: stessa variante,
// una sola richiesta di origine verso Supabase invece di due.
const cdn = (u, w) =>
  !u || !/^https?:\/\//.test(u)
    ? u || ""
    : "/.netlify/images?url=" + encodeURIComponent(u) + "&w=" + w + "&q=72&fm=webp";

// Variante assoluta per gli scraper social, che non hanno una <base> e non
// rispettano la cache del browser: ogni condivisione riscarica l'immagine.
// fm=jpg perche' non tutti gli scraper leggono il webp.
const cdnAbs = (u, w) =>
  OG_VIA_CDN && /^https?:\/\//.test(u || "") && u.indexOf(SITE) !== 0
    ? SITE + "/.netlify/images?url=" + encodeURIComponent(u) + "&w=" + w + "&q=80&fm=jpg"
    : u;

// ---------- utility ----------

const esc = (s) =>
  String(s ?? "")
    .replace(/&/g, "&amp;")
    .replace(/</g, "&lt;")
    .replace(/>/g, "&gt;")
    .replace(/"/g, "&quot;")
    .replace(/'/g, "&#39;");

const stripTags = (html) =>
  String(html ?? "")
    .replace(/<[^>]*>/g, " ")
    .replace(/&nbsp;/gi, " ")
    .replace(/\s+/g, " ")
    .trim();

// Taglia a ~155 caratteri senza spezzare le parole
function clip(text, max = 155) {
  const t = stripTags(text);
  if (t.length <= max) return t;
  const cut = t.slice(0, max);
  const sp = cut.lastIndexOf(" ");
  return (sp > 60 ? cut.slice(0, sp) : cut).replace(/[,;:.\-\s]+$/, "") + "…";
}

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

// Data in formato ISO 8601 con orario: Google News vuole il timestamp
function isoDate(d, created) {
  const raw = d || created;
  if (!raw) return "";
  const dt = new Date(raw);
  if (isNaN(dt.getTime())) return "";
  return dt.toISOString();
}

const fmtDateIt = (d) => {
  try {
    return new Date(d).toLocaleDateString("it-IT", {
      day: "2-digit",
      month: "long",
      year: "numeric",
    });
  } catch {
    return "";
  }
};

async function sb(path) {
  const res = await fetch(SUPABASE_URL + "/rest/v1/" + path, {
    headers: { apikey: SUPABASE_KEY },
  });
  if (!res.ok) throw new Error("supabase " + res.status);
  return res.json();
}



const ALIAS_TO_SERIE = Object.fromEntries(
  Object.entries(SERIE_ALIAS).map(([s, p]) => [p.replace(/^\//, ""), s])
);

// ---------- costruzione dei blocchi ----------

function ogBlock(a) {
  const url = SITE + "/articolo/" + a.id + "/" + slugify(a.title);
  const desc = clip(a.subtitle || a.summary || a.body);
  // og_image (orizzontale 1200×630) ha la precedenza sulla cover verticale
  const hasOg = !!a.og_image;
  const img = a.og_image || a.image || OG_DEFAULT;
  const published = isoDate(a.date, a.created_at);
  const modified = isoDate(a.updated_at) || published;

  // Dimensioni dichiarate solo quando le conosciamo davvero: og_image esce
  // sempre da make_og.py (1200×630), e og-default.jpg e' anch'essa 1200×630.
  // Sulla cover caricata a mano non sappiamo la misura: meglio tacere che
  // mentire, altrimenti lo scraper costruisce un'anteprima sbagliata.
  const imgOg = cdnAbs(img, 1200);
  const knownSize = hasOg || img === OG_DEFAULT;
  const imgMeta = knownSize
    ? `<meta property="og:image:width" content="1200">
<meta property="og:image:height" content="630">
<meta property="og:image:type" content="image/jpeg">`
    : "";

  return `<title>${esc(a.title)} · Iattualità</title>
<meta name="description" content="${esc(desc)}">
<link rel="canonical" href="${esc(url)}">
<meta property="og:type" content="article">
<meta property="og:site_name" content="Iattualità">
<meta property="og:locale" content="it_IT">
<meta property="og:title" content="${esc(a.title)}">
<meta property="og:description" content="${esc(desc)}">
<meta property="og:url" content="${esc(url)}">
<meta property="og:image" content="${esc(imgOg)}">
<meta property="og:image:secure_url" content="${esc(imgOg)}">
<meta property="og:image:alt" content="${esc(a.title)}">
${imgMeta}
${published ? `<meta property="article:published_time" content="${esc(published)}">` : ""}
${modified ? `<meta property="article:modified_time" content="${esc(modified)}">` : ""}
${a.author_name ? `<meta property="article:author" content="${esc(a.author_name)}">` : ""}
${a.category ? `<meta property="article:section" content="${esc(a.category)}">` : ""}
<meta name="twitter:card" content="summary_large_image">
<meta name="twitter:title" content="${esc(a.title)}">
<meta name="twitter:description" content="${esc(desc)}">
<meta name="twitter:image" content="${esc(imgOg)}">
<script type="application/ld+json">${ld(newsArticleLd(a, url, imgOg, published, modified, desc))}</script>
<script type="application/ld+json">${ld(breadcrumbLd(a, url))}</script>`;
}

// JSON-LD serializzato in modo che un "<" nel testo non chiuda lo <script>
const ld = (obj) => JSON.stringify(obj).replace(/</g, "\\u003c");

function breadcrumbLd(a, url) {
  const items = [{ "@type": "ListItem", position: 1, name: "Home", item: SITE }];
  if (a.category)
    items.push({
      "@type": "ListItem",
      position: 2,
      name: a.category,
      item: SITE + "/argomento/" + encodeURIComponent(a.category),
    });
  items.push({
    "@type": "ListItem",
    position: items.length + 1,
    name: a.title,
  });
  return {
    "@context": "https://schema.org",
    "@type": "BreadcrumbList",
    itemListElement: items,
  };
}

function newsArticleLd(a, url, img, published, modified, desc) {
  return {
    "@context": "https://schema.org",
    "@type": "NewsArticle",
    mainEntityOfPage: { "@type": "WebPage", "@id": url },
    headline: String(a.title || "").slice(0, 110),
    description: desc,
    image: [img],
    datePublished: published || undefined,
    dateModified: modified || published || undefined,
    articleSection: a.category || undefined,
    inLanguage: "it-IT",
    isAccessibleForFree: true,
    author: a.author_name
      ? { "@type": "Person", name: a.author_name }
      : { "@type": "Organization", name: "Iattualità", url: SITE },
    publisher: {
      "@type": "NewsMediaOrganization",
      name: "Iattualità",
      url: SITE,
      logo: {
        "@type": "ImageObject",
        url: SITE + "/favicon-192.png",
        width: 192,
        height: 192,
      },
    },
  };
}

function articleHtml(a) {
  const body =
    a.body && a.body.trim()
      ? safeBody(a.body)
      : "<p>" + esc(a.summary || "").replace(/\n/g, "<br>") + "</p>";

  // La cover passa dalla Image CDN: e' la riga che pesava di piu' sull'egress.
  const cover = a.image
    ? `<img src="${esc(cdn(a.image, 900))}" alt="${esc(a.title)}" width="760" height="428" decoding="async" style="width:100%;height:auto;border-radius:16px;margin:0 0 18px">`
    : "";

  return `<article style="max-width:760px;margin:0 auto;padding:18px 16px;font-family:Barlow,system-ui,sans-serif;color:#2A3A57;line-height:1.7">
<p style="font-size:12px;color:#7A8499;margin:0 0 10px">
<a href="/" style="color:#2C5AA0">Iattualità</a>
${a.category ? ` · <a href="/argomento/${encodeURIComponent(a.category)}" style="color:#2C5AA0">${esc(a.category)}</a>` : ""}
${a.author_name ? ` · di <span rel="author">${esc(a.author_name)}</span>` : ""}
${a.date ? ` · <time datetime="${esc(String(a.date).slice(0, 10))}">${esc(fmtDateIt(a.date))}</time>` : ""}
</p>
<h1 style="font-family:Anton,sans-serif;font-weight:400;font-size:34px;line-height:1.08;color:#16243F;margin:0 0 12px">${esc(a.title)}</h1>
${a.subtitle ? `<p style="font-size:19px;font-weight:700;color:#16243F;margin:0 0 16px">${esc(a.subtitle)}</p>` : ""}
${cover}
<div style="font-size:17px">${body}</div>
${a.category ? `<p style="margin-top:24px"><a href="/argomento/${encodeURIComponent(a.category)}" style="color:#2C5AA0;font-weight:700">Altri articoli in ${esc(a.category)}</a></p>` : ""}
</article>`;
}

// La home pre-renderizzata deve occupare lo STESSO spazio che occupera'
// React, altrimenti quando React monta la pagina si allunga di colpo e tutto
// cio' che sta sotto salta. Era esattamente il difetto misurato: il
// contenitore passava da 1009 a 6797 pixel a un secondo dal caricamento, per
// un Cumulative Layout Shift di 0,939 (oltre nove volte la soglia di 0,1).
//
// Quindi qui si replica la geometria delle schede di app.jsx: stesso numero
// di articoli (10), stesse proporzioni dell'immagine (16/9 per la scheda
// grande, 16/10 per le altre), stessi caratteri, margini e spaziature.
// aspect-ratio fa il lavoro pesante: lo spazio dell'immagine e' riservato
// prima ancora che l'immagine arrivi, a qualunque larghezza di schermo.
//
// Le proporzioni e i valori qui sotto devono restare allineati a NewsCard in
// app.jsx. Se cambi il taglio delle immagini li', cambialo anche qui,
// altrimenti il salto torna.
function homeHtml(list) {
  const card = (a, grande) => {
    const url = "/articolo/" + esc(a.id) + "/" + slugify(a.title);
    const img = a.image
      ? `<img src="${esc(cdn(a.image, grande ? 900 : 600))}" alt="${esc(a.title)}" ${grande ? 'fetchpriority="high"' : 'loading="lazy"'} decoding="async" style="width:100%;height:100%;object-fit:cover">`
      : '<div style="width:100%;height:100%;background:linear-gradient(135deg,#16243F,#2C5AA0)"></div>';

    if (grande) {
      // Scheda in evidenza: il titolo sta sopra l'immagine, quindi l'altezza
      // e' quella dell'immagine e basta.
      return `<div style="background:#FFFFFF;border-radius:16px;overflow:hidden;border:1px solid #E3DFD6;margin:0 0 16px">
  <div style="position:relative;aspect-ratio:16/9;background:#16243F">${img}
    <div style="position:absolute;inset:0;background:linear-gradient(to top,rgba(14,17,23,.85),transparent 60%)"></div>
    <div style="position:absolute;bottom:14px;left:16px;right:16px">
      <h2 style="font-family:Anton,sans-serif;font-weight:400;font-size:clamp(20px,5vw,30px);margin:0;line-height:1.05">
        <a href="${url}" style="color:#F5F5F5;text-decoration:none">${esc(a.title)}</a>
      </h2>
    </div>
  </div>
</div>`;
    }

    return `<div style="background:#FFFFFF;border-radius:14px;overflow:hidden;border:1px solid #E3DFD6;display:flex;flex-direction:column">
  <div style="position:relative;aspect-ratio:16/10;background:#16243F">${img}</div>
  <div style="padding:12px 14px;flex:1;display:flex;flex-direction:column">
    <h3 style="font-family:Anton,sans-serif;font-weight:400;font-size:18px;margin:0 0 6px;line-height:1.1">
      <a href="${url}" style="color:#16243F;text-decoration:none">${esc(a.title)}</a>
    </h3>
    ${a.subtitle ? `<p style="margin:0 0 10px;font-size:13.5px;color:#2A3A57;line-height:1.4;font-weight:600">${esc(a.subtitle)}</p>` : ""}
    <div style="margin-top:auto;font-size:11.5px;color:#7A8499">${a.category ? esc(a.category) : ""}</div>
  </div>
</div>`;
  };

  const cats = [...new Set(list.map((a) => a.category).filter(Boolean))].sort();
  const catLinks = cats
    .map((c) => `<a href="/argomento/${encodeURIComponent(c)}" style="color:#2C5AA0;margin-right:12px;font-weight:600">${esc(c)}</a>`)
    .join("");

  const [primo, ...altri] = list;

  return `<div style="max-width:980px;margin:0 auto;padding:16px;font-family:Barlow,system-ui,sans-serif">
<h1 style="font-family:Anton,sans-serif;font-weight:400;color:#16243F;font-size:clamp(22px,5vw,30px);margin:0 0 10px">Iattualità — L'informazione intelligente e in tempo reale</h1>
<nav style="margin:0 0 16px;font-size:14px">${catLinks}</nav>
${primo ? card(primo, true) : ""}
<div style="display:grid;grid-template-columns:repeat(auto-fit,minmax(260px,1fr));gap:14px">
${altri.map((a) => card(a, false)).join("\n")}
</div>
<p style="margin:22px 0 0"><a href="/archivio" style="color:#2C5AA0;font-weight:700">Tutti gli articoli</a></p>
</div>`;
}

// ---------- blocchi delle pagine non-articolo ----------

// Blocco <head> generico: titolo, descrizione, canonical, og. Nessun
// article:* perche' queste non sono notizie: sono pagine stabili.
function pageOgBlock(title, desc, url, ldObj) {
  return `<title>${esc(title)}</title>
<meta name="description" content="${esc(desc)}">
<link rel="canonical" href="${esc(url)}">
<meta property="og:type" content="website">
<meta property="og:site_name" content="Iattualità">
<meta property="og:locale" content="it_IT">
<meta property="og:title" content="${esc(title)}">
<meta property="og:description" content="${esc(desc)}">
<meta property="og:url" content="${esc(url)}">
<meta property="og:image" content="${esc(OG_DEFAULT)}">
<meta property="og:image:width" content="1200">
<meta property="og:image:height" content="630">
<meta name="twitter:card" content="summary_large_image">
<meta name="twitter:title" content="${esc(title)}">
<meta name="twitter:description" content="${esc(desc)}">
<meta name="twitter:image" content="${esc(OG_DEFAULT)}">
${ldObj ? `<script type="application/ld+json">${ld(ldObj)}</script>` : ""}`;
}

const WRAP_OPEN =
  '<div style="max-width:760px;margin:0 auto;padding:18px 16px;font-family:Barlow,system-ui,sans-serif;color:#2A3A57;line-height:1.7">';
const H1 =
  'style="font-family:Anton,sans-serif;font-weight:400;font-size:32px;line-height:1.1;color:#16243F;margin:0 0 12px"';

// Pagina istituzionale: h1, intro, sezioni. Stesso testo che vede il lettore.
function staticPageHtml(p) {
  const blocks = (p.blocks || [])
    .map(
      (b) =>
        `<h2 style="font-family:Anton,sans-serif;font-weight:400;font-size:22px;color:#16243F;margin:22px 0 8px">${esc(
          b.h
        )}</h2>` + (b.p || []).map((t) => `<p>${esc(t)}</p>`).join("")
    )
    .join("");
  return `${WRAP_OPEN}
<p style="font-size:12px;color:#7A8499;margin:0 0 10px"><a href="/" style="color:#2C5AA0">Iattualità</a></p>
<h1 ${H1}>${esc(p.h1)}</h1>
<p style="font-size:19px;font-weight:700;color:#16243F">${esc(p.intro || "")}</p>
${blocks}
</div>`;
}

// Lista di articoli riusata da /argomento, /serie e /archivio.
function listHtml(title, intro, list, extra) {
  const items = list
    .map(
      (a) =>
        `<li style="margin:0 0 14px"><a href="/articolo/${esc(a.id)}/${slugify(
          a.title
        )}" style="color:#16243F;font-weight:700;text-decoration:none">${esc(a.title)}</a>${
          a.subtitle
            ? `<br><span style="color:#2A3A57;font-size:14px">${esc(a.subtitle)}</span>`
            : ""
        }</li>`
    )
    .join("\n");
  return `${WRAP_OPEN}
<p style="font-size:12px;color:#7A8499;margin:0 0 10px"><a href="/" style="color:#2C5AA0">Iattualità</a></p>
<h1 ${H1}>${esc(title)}</h1>
${intro ? `<p style="font-size:17px;color:#2A3A57">${esc(intro)}</p>` : ""}
<ul style="list-style:none;padding:0;margin:18px 0 0">${items}</ul>
${extra || ""}
</div>`;
}

// CollectionPage con ItemList: dice a Google che la pagina e' un indice,
// non un articolo. Evita che venga valutata come contenuto povero.
function collectionLd(name, url, list) {
  return {
    "@context": "https://schema.org",
    "@type": "CollectionPage",
    name,
    url,
    isPartOf: { "@type": "WebSite", name: "Iattualità", url: SITE },
    mainEntity: {
      "@type": "ItemList",
      numberOfItems: list.length,
      itemListElement: list.slice(0, 30).map((a, i) => ({
        "@type": "ListItem",
        position: i + 1,
        url: SITE + "/articolo/" + a.id + "/" + slugify(a.title),
        name: String(a.title || "").slice(0, 110),
      })),
    },
  };
}

function webPageLd(name, desc, url) {
  return {
    "@context": "https://schema.org",
    "@type": "WebPage",
    name,
    description: desc,
    url,
    isPartOf: { "@type": "WebSite", name: "Iattualità", url: SITE },
    publisher: { "@type": "NewsMediaOrganization", name: "Iattualità", url: SITE },
  };
}

// Le risposte costruite qui sostituiscono quella originale, e con essa
// tutti gli header impostati in _headers. Senza questo passaggio le pagine
// HTML uscivano SENZA Content-Security-Policy, X-Frame-Options,
// X-Content-Type-Options e Referrer-Policy: restavano solo sui file statici,
// cioe' esattamente dove non servono. Qui si riparte dagli header originali
// e si sovrascrivono solo i due che ci riguardano.
//
// content-length e content-encoding vanno tolti: descrivono il corpo di
// prima, non quello nuovo.
function intestazioni(res, cacheControl) {
  const h = new Headers(res.headers);
  h.set("content-type", "text/html; charset=utf-8");
  if (cacheControl) h.set("cache-control", cacheControl);
  h.delete("content-length");
  h.delete("content-encoding");
  return h;
}

// Serve la shell non modificata. Serve nei casi di errore del database:
// il corpo della risposta originale e' gia' stato consumato da res.text(),
// quindi restituire "res" non funziona — la richiesta finisce in errore 500.
// E' esattamente cio' che succedeva: un id di articolo malformato mandava
// Supabase in errore e il lettore si prendeva un 500 invece di un 404.
// no-store perche' un guasto momentaneo non va messo in cache.
function shell(res, html) {
  return new Response(html, { status: 200, headers: intestazioni(res, "no-store") });
}

// Pagina non esistente: 404 vero + noindex. Senza questo, il rewrite
// "/* -> /index.html 200" di netlify.toml trasforma ogni URL sbagliato
// in una copia della home con stato 200 (soft 404).
function notFound(res, html) {
  const nf =
    "<!--OG_START-->\n<title>Pagina non trovata · Iattualità</title>\n" +
    '<meta name="robots" content="noindex">\n<!--OG_END-->';
  const out = html
    .replace(/<!--OG_START-->[\s\S]*?<!--OG_END-->/, () => nf)
    .replace(/<meta name="robots" content="index, follow[^"]*">/, () => "");
  return new Response(out, { status: 404, headers: intestazioni(res, "no-store") });
}

// ---------- handler ----------

export default async function handler(request, context) {
  const res = await context.next();
  const ct = res.headers.get("content-type") || "";
  if (!ct.includes("text/html")) return res;

  const url = new URL(request.url);
  const path = decodeURIComponent(url.pathname);
  let html = await res.text();

  // NB: la replace con stringa interpreta $&, $', $` e $1 come pattern.
  // Il corpo di un articolo puo' contenerli ("costa 5$" seguito da un
  // apostrofo). Si usa sempre una funzione come sostituto.
  const inject = (markup) =>
    html.replace('<div id="root"></div>', () => '<div id="root">' + markup + "</div>");

  // ---- HOME ----
  if (path === "/") {
    try {
      const list = await sb(
        "news?select=id,title,subtitle,category,image&order=date.desc.nullslast,created_at.desc&limit=10"
      );
      if (list.length) html = inject(homeHtml(list));
    } catch {
      /* in caso di errore si serve la shell originale */
    }
    return new Response(html, { status: 200, headers: intestazioni(res, "public, max-age=0, s-maxage=300") });
  }

  // ---- PAGINE ISTITUZIONALI ----
  // Sono le pagine che Google News guarda per capire chi c'e' dietro la
  // testata. Finora arrivavano al crawler come guscio vuoto.
  const segRaw = path.replace(/^\/+|\/+$/g, "");
  if (PAGES[segRaw]) {
    const p = PAGES[segRaw];
    const u = SITE + "/" + segRaw;
    const blk =
      "<!--OG_START-->\n" +
      pageOgBlock(p.title, p.desc, u, webPageLd(p.h1, p.desc, u)) +
      "\n<!--OG_END-->";
    html = html.replace(/<!--OG_START-->[\s\S]*?<!--OG_END-->/, () => blk);
    html = inject(staticPageHtml(p));
    return new Response(html, { status: 200, headers: intestazioni(res, "public, max-age=0, s-maxage=3600") });
  }

  // ---- NEWSLETTER ----
  if (segRaw === "newsletter") {
    const u = SITE + "/newsletter";
    const t = "Newsletter · Iattualità";
    const d =
      "Iscriviti alla newsletter di Iattualità: il riepilogo delle notizie verificate con i dati, senza appartenenze politiche.";
    const blk = "<!--OG_START-->\n" + pageOgBlock(t, d, u, webPageLd("Newsletter", d, u)) + "\n<!--OG_END-->";
    html = html.replace(/<!--OG_START-->[\s\S]*?<!--OG_END-->/, () => blk);
    html = inject(
      `${WRAP_OPEN}
<p style="font-size:12px;color:#7A8499;margin:0 0 10px"><a href="/" style="color:#2C5AA0">Iattualità</a></p>
<h1 ${H1}>Newsletter</h1>
<p style="font-size:19px;font-weight:700;color:#16243F">${esc(d)}</p>
</div>`
    );
    return new Response(html, { status: 200, headers: intestazioni(res, "public, max-age=0, s-maxage=3600") });
  }

  // ---- CONTATTI E SOCIAL ----
  // Per una testata la pagina contatti e' un segnale di affidabilita': dice a
  // chi legge (e a Google News) che dietro il sito c'e' qualcuno di
  // raggiungibile. Finora nessuna delle due aveva un indirizzo proprio.
  if (segRaw === "contatti" || segRaw === "social") {
    let info = {};
    try {
      const rows = await sb("site_info?id=eq.1&select=*");
      info = rows[0] || {};
    } catch {
      /* senza recapiti la pagina esce comunque, solo piu' scarna */
    }
    const social = SOCIALS.filter((s) => info[s.k]);
    const socialHtml = social.length
      ? `<p style="margin-top:18px">${social
          .map(
            (s) =>
              `<a href="${esc(info[s.k])}" rel="noopener" style="color:#2C5AA0;font-weight:700;margin-right:14px">${esc(s.n)}</a>`
          )
          .join("")}</p>`
      : "";

    const isContatti = segRaw === "contatti";
    const u = SITE + "/" + segRaw;
    const t = isContatti ? "Contatti · Iattualità" : "Seguici · Iattualità";
    const d = isContatti
      ? "Come contattare la redazione di Iattualità: segnalazioni, collaborazioni, rettifiche e richieste."
      : "Tutti i canali di Iattualità in un posto solo: TikTok, Instagram, Facebook, YouTube, Threads.";

    const recapiti = isContatti
      ? (info.email ? `<p><strong>Email:</strong> <a href="mailto:${esc(info.email)}" style="color:#2C5AA0">${esc(info.email)}</a></p>` : "") +
        (info.phone ? `<p><strong>Telefono:</strong> ${esc(info.phone)}</p>` : "")
      : "";

    const ldObj = isContatti
      ? {
          "@context": "https://schema.org",
          "@type": "ContactPage",
          name: "Contatti",
          description: d,
          url: u,
          isPartOf: { "@type": "WebSite", name: "Iattualità", url: SITE },
          mainEntity: {
            "@type": "NewsMediaOrganization",
            name: "Iattualità",
            url: SITE,
            email: info.email || undefined,
            telephone: info.phone || undefined,
            sameAs: social.map((s) => info[s.k])
          }
        }
      : webPageLd("Seguici", d, u);

    const blk = "<!--OG_START-->\n" + pageOgBlock(t, d, u, ldObj) + "\n<!--OG_END-->";
    html = html.replace(/<!--OG_START-->[\s\S]*?<!--OG_END-->/, () => blk);
    html = inject(`${WRAP_OPEN}
<p style="font-size:12px;color:#7A8499;margin:0 0 10px"><a href="/" style="color:#2C5AA0">Iattualità</a></p>
<h1 ${H1}>${isContatti ? "Contatti" : "Seguici"}</h1>
<p style="font-size:19px;font-weight:700;color:#16243F">${esc(
      isContatti
        ? "Segnalazioni, collaborazioni o richieste: scrivici. Leggiamo tutto."
        : "Tutti i nostri canali in un posto solo. Resta aggiornato dove preferisci."
    )}</p>
${recapiti}
${socialHtml}
</div>`);
    return new Response(html, { status: 200, headers: intestazioni(res, "public, max-age=0, s-maxage=3600") });
  }

  // ---- ARCHIVIO ----
  if (segRaw === "archivio") {
    let list = [];
    try {
      list = await sb("news?select=id,title,subtitle&order=date.desc.nullslast,created_at.desc&limit=100");
    } catch {
      return shell(res, html); // errore DB: shell originale, mai un 404 inventato
    }
    const u = SITE + "/archivio";
    const t = "Archivio · Iattualità";
    const d = "Tutti gli articoli di Iattualità, dal piu' recente.";
    const blk = "<!--OG_START-->\n" + pageOgBlock(t, d, u, collectionLd("Archivio", u, list)) + "\n<!--OG_END-->";
    html = html.replace(/<!--OG_START-->[\s\S]*?<!--OG_END-->/, () => blk);
    html = inject(listHtml("Archivio", d, list));
    return new Response(html, { status: 200, headers: intestazioni(res, "public, max-age=0, s-maxage=900") });
  }

  // ---- ARGOMENTO ----
  const mc = path.match(/^\/argomento\/([^/]+)/);
  if (mc) {
    const cat = decodeURIComponent(mc[1]);
    let list = [];
    try {
      list = await sb(
        "news?select=id,title,subtitle&category=eq." +
          encodeURIComponent(cat) +
          "&order=date.desc.nullslast,created_at.desc&limit=60"
      );
    } catch {
      return shell(res, html);
    }
    // Categoria senza articoli: non esiste. 404 vero invece di pagina vuota.
    if (!list.length) return notFound(res, html);
    const u = SITE + "/argomento/" + encodeURIComponent(cat);
    const t = cat + " · Iattualità";
    const d = "Tutti gli articoli di Iattualità nella categoria " + cat + ", verificati con i dati.";
    const blk = "<!--OG_START-->\n" + pageOgBlock(t, d, u, collectionLd(cat, u, list)) + "\n<!--OG_END-->";
    html = html.replace(/<!--OG_START-->[\s\S]*?<!--OG_END-->/, () => blk);
    html = inject(listHtml(cat, d, list));
    return new Response(html, { status: 200, headers: intestazioni(res, "public, max-age=0, s-maxage=900") });
  }

  // ---- SERIE (compreso l'alias /podcast) ----
  const ms = path.match(/^\/serie\/([^/]+)/);
  const serieWanted = ms ? decodeURIComponent(ms[1]) : ALIAS_TO_SERIE[segRaw] ? "" : null;
  if (ms || ALIAS_TO_SERIE[segRaw]) {
    let rows = [];
    try {
      rows = await sb(
        "news?serie=not.is.null&select=id,title,subtitle,serie&order=date.desc.nullslast,created_at.desc&limit=200"
      );
    } catch {
      return shell(res, html);
    }
    const target = ms
      ? (rows.find((r) => slugify(r.serie) === slugify(serieWanted)) || {}).serie
      : ALIAS_TO_SERIE[segRaw];
    const list = target ? rows.filter((r) => r.serie === target) : [];
    if (!list.length) return notFound(res, html);
    const u = SITE + (SERIE_ALIAS[target] || "/serie/" + slugify(target));
    const t = target + " · Iattualità";
    const d = "Tutte le puntate della serie " + target + " di Iattualità.";
    const blk = "<!--OG_START-->\n" + pageOgBlock(t, d, u, collectionLd(target, u, list)) + "\n<!--OG_END-->";
    html = html.replace(/<!--OG_START-->[\s\S]*?<!--OG_END-->/, () => blk);
    html = inject(listHtml(target, d, list));
    return new Response(html, { status: 200, headers: intestazioni(res, "public, max-age=0, s-maxage=900") });
  }

  // ---- ARTICOLO ----
  const m = path.match(/^\/articolo\/([^/]+)/);
  if (!m) return notFound(res, html);
  const id = m[1];

  let a = null;
  try {
    const rows = await sb("news?id=eq." + encodeURIComponent(id) + "&select=*&limit=1");
    a = rows[0] || null;
  } catch (e) {
    // Due casi diversi, che prima finivano insieme nello stesso ramo.
    //
    // 4xx = l'id non e' valido per la colonna (gli id sono UUID, quindi
    // "/articolo/999999/x" fa rispondere errore a Supabase). Quell'articolo
    // non esiste e non esistera' mai: e' un 404, non un guasto.
    //
    // Tutto il resto (5xx, rete, timeout) e' un problema temporaneo nostro:
    // li' un 404 sarebbe una bugia a Google, che potrebbe deindicizzare un
    // articolo valido. Si serve la shell e React ritentera'.
    const stato = Number(String(e && e.message).match(/supabase (\d+)/)?.[1] || 0);
    if (stato >= 400 && stato < 500) return notFound(res, html);
    return shell(res, html);
  }

  // Articolo inesistente: 404 vero, non un 200 con "Articolo non trovato"
  if (!a) {
    const nf =
      "<!--OG_START-->\n<title>Articolo non trovato · Iattualità</title>\n" +
      '<meta name="robots" content="noindex">\n<!--OG_END-->';
    html = html
      .replace(/<!--OG_START-->[\s\S]*?<!--OG_END-->/, () => nf)
      .replace(/<meta name="robots" content="index, follow[^"]*">/, () => "");
    return new Response(html, { status: 404, headers: intestazioni(res, "no-store") });
  }

  const block = "<!--OG_START-->\n" + ogBlock(a) + "\n<!--OG_END-->";
  html = html.replace(/<!--OG_START-->[\s\S]*?<!--OG_END-->/, () => block);
  html = inject(articleHtml(a));

  return new Response(html, { status: 200, headers: intestazioni(res, "public, max-age=0, s-maxage=600") });
}

// path "/*" serve per restituire un 404 vero sugli URL inesistenti: senza,
// il rewrite di netlify.toml li trasforma tutti in una home con stato 200.
// excludedPath tiene la funzione fuori dalle risorse statiche, che non devono
// nemmeno farla partire.
// L'elenco e' volutamente NOMINATIVO e non per estensione.
//
// Prima diceva "salta tutti i .js, tutti i .json, tutti i .txt". Il risultato
// era che qualunque file con quelle estensioni presente nella cartella
// pubblicata veniva servito: verificato sul sito dal vivo che
// /node_modules/esbuild/package.json, /package-lock.json e
// /shared/site-pages.js fossero scaricabili da chiunque.
//
// La cartella pubblicata dovrebbe essere dist/, che contiene solo i file
// qui sotto, ma Netlify continua a pubblicare la radice del repository
// malgrado netlify.toml: /dist/app.js risponde ancora 200. Finche' quella
// impostazione non viene rispettata, l'elenco nominativo e' cio' che tiene
// chiuso il sito: tutto quello che non e' elencato passa dal prerender, che
// non lo riconosce come pagina e risponde 404.
//
// Se aggiungi un file statico al sito, aggiungilo anche qui, altrimenti
// risultera' inesistente.
export const config = {
  path: "/*",
  excludedPath: [
    "/app.js",
    "/vendor/*",
    "/favicon.ico",
    "/favicon-192.png",
    "/apple-touch-icon.png",
    "/og-default.jpg",
    "/robots.txt",
    "/llms.txt",
    "/*.xml",        // sitemap.xml, news-sitemap.xml, rss.xml: edge function proprie
    "/.netlify/*",   // Image CDN e funzioni serverless
  ],
};
