// netlify/edge-functions/rss.js
// Genera il feed RSS di Iattualità leggendo gli articoli da Supabase.
// Raggiungibile su https://iattualita.it/rss.xml

const SUPABASE_URL = "https://wzkshpgakvasqwrrgkgd.supabase.co";
const SUPABASE_KEY = "sb_publishable_I3s4phA5Be9qnV4pLbWQMQ_8-IGUE-b";
const SITE = "https://iattualita.it";

function esc(s) {
  return (s || "")
    .replace(/&/g, "&amp;")
    .replace(/</g, "&lt;")
    .replace(/>/g, "&gt;")
    .replace(/"/g, "&quot;");
}
function slugify(s) {
  return (s || "")
    .toString().toLowerCase().normalize("NFD")
    .replace(/[\u0300-\u036f]/g, "")
    .replace(/[^a-z0-9]+/g, "-")
    .replace(/^-+|-+$/g, "")
    .slice(0, 60) || "articolo";
}
function stripHtml(h) {
  return (h || "").replace(/<[^>]*>/g, " ").replace(/\s+/g, " ").trim();
}
// URL assoluto passato dalla Netlify Image CDN: i feed reader e gli aggregatori
// scaricano una copia ridotta servita da Netlify, non l'originale da Supabase.
// fm=jpg perche' non tutti gli aggregatori leggono il webp.
function cdnAbs(u, w) {
  if (!u || !/^https?:\/\//.test(u)) return u || "";
  return SITE + "/.netlify/images?url=" + encodeURIComponent(u) + "&w=" + w + "&q=80&fm=jpg";
}

export default async () => {
  let items = [];
  try {
    const r = await fetch(
      SUPABASE_URL + "/rest/v1/news?select=*&order=date.desc.nullslast,created_at.desc&limit=30",
      { headers: { apikey: SUPABASE_KEY } }
    );
    if (r.ok) items = await r.json();
  } catch (e) { /* feed vuoto in caso di errore */ }

  const now = new Date().toUTCString();

  const entries = items.map((it) => {
    const url = SITE + "/articolo/" + it.id + "/" + slugify(it.title);
    const date = it.date || it.created_at;
    let pub = now;
    try { if (date) pub = new Date(date).toUTCString(); } catch (e) {}
    const desc = stripHtml(it.subtitle || it.summary || it.body || "").slice(0, 500);
    return `    <item>
      <title>${esc(it.title)}</title>
      <link>${esc(url)}</link>
      <guid isPermaLink="true">${esc(url)}</guid>
      <pubDate>${pub}</pubDate>${it.category ? `
      <category>${esc(it.category)}</category>` : ""}
      <description>${esc(desc)}</description>${it.image ? `
      <enclosure url="${esc(cdnAbs(it.image, 1200))}" type="image/jpeg"/>` : ""}
    </item>`;
  }).join("\n");

  const xml = `<?xml version="1.0" encoding="UTF-8"?>
<rss version="2.0" xmlns:atom="http://www.w3.org/2005/Atom">
  <channel>
    <title>Iattualità</title>
    <link>${SITE}</link>
    <atom:link href="${SITE}/rss.xml" rel="self" type="application/rss+xml"/>
    <description>Informazione indipendente e in tempo reale, verificata con i dati. Geopolitica, inchieste e attualità.</description>
    <language>it-IT</language>
    <lastBuildDate>${now}</lastBuildDate>
${entries}
  </channel>
</rss>`;

  return new Response(xml, {
    headers: {
      "content-type": "application/rss+xml; charset=utf-8",
      "cache-control": "public, max-age=600",
    },
  });
};

export const config = { path: "/rss.xml" };
