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

// Pagina non esistente: 404 vero + noindex. Senza questo, il rewrite
// "/* -> /index.html 200" di netlify.toml trasforma ogni URL sbagliato
// in una copia della home con stato 200 (soft 404).
function notFound(html) {
  const nf =
    "<!--OG_START-->\n<title>Pagina non trovata · Iattualità</title>\n" +
    '<meta name="robots" content="noindex">\n<!--OG_END-->';
  const out = html
    .replace(/<!--OG_START-->[\s\S]*?<!--OG_END-->/, () => nf)
    .replace(/<meta name="robots" content="index, follow[^"]*">/, () => "");
  return new Response(out, {
    status: 404,
    headers: { "content-type": "text/html; charset=utf-8" },
  });
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
    return new Response(html, {
      status: 200,
      headers: {
        "content-type": "text/html; charset=utf-8",
        "cache-control": "public, max-age=0, s-maxage=3600",
      },
    });
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
    return new Response(html, {
      status: 200,
      headers: { "content-type": "text/html; charset=utf-8", "cache-control": "public, max-age=0, s-maxage=3600" },
    });
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
    return new Response(html, {
      status: 200,
      headers: { "content-type": "text/html; charset=utf-8", "cache-control": "public, max-age=0, s-maxage=3600" }
    });
  }

  // ---- ARCHIVIO ----
  if (segRaw === "archivio") {
    let list = [];
    try {
      list = await sb("news?select=id,title,subtitle&order=date.desc.nullslast,created_at.desc&limit=100");
    } catch {
      return res; // errore DB: shell originale, mai un 404 inventato
    }
    const u = SITE + "/archivio";
    const t = "Archivio · Iattualità";
    const d = "Tutti gli articoli di Iattualità, dal piu' recente.";
    const blk = "<!--OG_START-->\n" + pageOgBlock(t, d, u, collectionLd("Archivio", u, list)) + "\n<!--OG_END-->";
    html = html.replace(/<!--OG_START-->[\s\S]*?<!--OG_END-->/, () => blk);
    html = inject(listHtml("Archivio", d, list));
    return new Response(html, {
      status: 200,
      headers: { "content-type": "text/html; charset=utf-8", "cache-control": "public, max-age=0, s-maxage=900" },
    });
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
      return res;
    }
    // Categoria senza articoli: non esiste. 404 vero invece di pagina vuota.
    if (!list.length) return notFound(html);
    const u = SITE + "/argomento/" + encodeURIComponent(cat);
    const t = cat + " · Iattualità";
    const d = "Tutti gli articoli di Iattualità nella categoria " + cat + ", verificati con i dati.";
    const blk = "<!--OG_START-->\n" + pageOgBlock(t, d, u, collectionLd(cat, u, list)) + "\n<!--OG_END-->";
    html = html.replace(/<!--OG_START-->[\s\S]*?<!--OG_END-->/, () => blk);
    html = inject(listHtml(cat, d, list));
    return new Response(html, {
      status: 200,
      headers: { "content-type": "text/html; charset=utf-8", "cache-control": "public, max-age=0, s-maxage=900" },
    });
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
      return res;
    }
    const target = ms
      ? (rows.find((r) => slugify(r.serie) === slugify(serieWanted)) || {}).serie
      : ALIAS_TO_SERIE[segRaw];
    const list = target ? rows.filter((r) => r.serie === target) : [];
    if (!list.length) return notFound(html);
    const u = SITE + (SERIE_ALIAS[target] || "/serie/" + slugify(target));
    const t = target + " · Iattualità";
    const d = "Tutte le puntate della serie " + target + " di Iattualità.";
    const blk = "<!--OG_START-->\n" + pageOgBlock(t, d, u, collectionLd(target, u, list)) + "\n<!--OG_END-->";
    html = html.replace(/<!--OG_START-->[\s\S]*?<!--OG_END-->/, () => blk);
    html = inject(listHtml(target, d, list));
    return new Response(html, {
      status: 200,
      headers: { "content-type": "text/html; charset=utf-8", "cache-control": "public, max-age=0, s-maxage=900" },
    });
  }

  // ---- ARTICOLO ----
  const m = path.match(/^\/articolo\/([^/]+)/);
  if (!m) return notFound(html);
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

// path "/*" serve per restituire un 404 vero sugli URL inesistenti: senza,
// il rewrite di netlify.toml li trasforma tutti in una home con stato 200.
// excludedPath tiene la funzione fuori dalle risorse statiche, che non devono
// nemmeno farla partire.
export const config = {
  path: "/*",
  excludedPath: [
    "/*.js",
    "/*.css",
    "/*.png",
    "/*.jpg",
    "/*.jpeg",
    "/*.webp",
    "/*.gif",
    "/*.svg",
    "/*.ico",
    "/*.xml",
    "/*.txt",
    "/*.json",
    "/*.mp3",
    "/.netlify/*",
  ],
};
