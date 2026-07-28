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

// Identica alla slugify() di index.html e sitemap.js
const slugify = (s) =>
  (s || "")
    .toString()
    .toLowerCase()
    .normalize("NFD")
    .replace(/[\u0300-\u036f]/g, "")
    .replace(/[^a-z0-9]+/g, "-")
    .replace(/^-+|-+$/g, "")
    .slice(0, 60) || "articolo";

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

// Rimuove cio' che non deve finire nell'HTML servito ai crawler
function safeBody(html) {
  return String(html ?? "")
    .replace(/<script[\s\S]*?<\/script>/gi, "")
    .replace(/<iframe[\s\S]*?<\/iframe>/gi, "")
    .replace(/<(style|link|meta|object|embed)[\s\S]*?>/gi, "")
    .replace(/\son\w+\s*=\s*("[^"]*"|'[^']*'|[^\s>]+)/gi, "")
    .replace(/javascript:/gi, "");
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

function homeHtml(list) {
  const items = list
    .map(
      (a) =>
        `<li style="margin:0 0 14px"><a href="/articolo/${esc(a.id)}/${slugify(a.title)}" style="color:#16243F;font-weight:700;text-decoration:none">${esc(a.title)}</a>${
          a.subtitle ? `<br><span style="color:#2A3A57;font-size:14px">${esc(a.subtitle)}</span>` : ""
        }</li>`
    )
    .join("\n");

  const cats = [...new Set(list.map((a) => a.category).filter(Boolean))].sort();
  const catLinks = cats
    .map(
      (c) =>
        `<a href="/argomento/${encodeURIComponent(c)}" style="color:#2C5AA0;margin-right:12px">${esc(c)}</a>`
    )
    .join("");

  return `<div style="max-width:980px;margin:0 auto;padding:16px;font-family:Barlow,system-ui,sans-serif">
<h1 style="font-family:Anton,sans-serif;font-weight:400;color:#16243F">Iattualità — L'informazione intelligente e in tempo reale</h1>
<nav style="margin:0 0 18px">${catLinks}</nav>
<ul style="list-style:none;padding:0">${items}</ul>
</div>`;
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
        "news?select=id,title,subtitle,category&order=date.desc.nullslast,created_at.desc&limit=30"
      );
      if (list.length) html = inject(homeHtml(list));
    } catch {
      /* in caso di errore si serve la shell originale */
    }
    return new Response(html, {
      status: 200,
      headers: {
        "content-type": "text/html; charset=utf-8",
        "cache-control": "public, max-age=0, s-maxage=300",
      },
    });
  }

  // ---- ARTICOLO ----
  const m = path.match(/^\/articolo\/([^/]+)/);
  if (!m) return res;
  const id = m[1];

  let a = null;
  try {
    const rows = await sb("news?id=eq." + encodeURIComponent(id) + "&select=*&limit=1");
    a = rows[0] || null;
  } catch {
    // errore DB: non mentire a Google con un 404, servi la shell
    return res;
  }

  // Articolo inesistente: 404 vero, non un 200 con "Articolo non trovato"
  if (!a) {
    const nf =
      "<!--OG_START-->\n<title>Articolo non trovato · Iattualità</title>\n" +
      '<meta name="robots" content="noindex">\n<!--OG_END-->';
    html = html
      .replace(/<!--OG_START-->[\s\S]*?<!--OG_END-->/, () => nf)
      .replace(/<meta name="robots" content="index, follow[^"]*">/, () => "");
    return new Response(html, {
      status: 404,
      headers: { "content-type": "text/html; charset=utf-8" },
    });
  }

  const block = "<!--OG_START-->\n" + ogBlock(a) + "\n<!--OG_END-->";
  html = html.replace(/<!--OG_START-->[\s\S]*?<!--OG_END-->/, () => block);
  html = inject(articleHtml(a));

  return new Response(html, {
    status: 200,
    headers: {
      "content-type": "text/html; charset=utf-8",
      "cache-control": "public, max-age=0, s-maxage=600",
    },
  });
}

export const config = { path: ["/", "/articolo/*"] };
