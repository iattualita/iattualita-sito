// netlify/edge-functions/rss.js
// Genera il feed RSS di Iattualità leggendo gli articoli da Supabase.
// Raggiungibile su https://iattualita.it/rss.xml

import { slugify } from "../../shared/site-pages.js";

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
  // Solo colonne pubbliche: il testo integrale (body, summary) e' riservato
  // ai lettori registrati e dopo la migrazione 006 la chiave pubblica non lo
  // legge piu'. Nel feed va il sottotitolo o l'inizio dell'anteprima.
  // Se la colonna anteprima non esiste ancora (005 non eseguita) Supabase
  // risponde 400 e si riprova con i campi di prima, finche' sono leggibili.
  const q = (cols) => fetch(
    SUPABASE_URL + "/rest/v1/news?select=" + cols + "&order=date.desc.nullslast,created_at.desc&limit=30",
    { headers: { apikey: SUPABASE_KEY } }
  );
  try {
    let r = await q("id,title,subtitle,anteprima,category,date,created_at,image");
    if (r.status === 400) r = await q("id,title,subtitle,category,date,created_at,image");
    if (r.ok) items = await r.json();
  } catch (e) { /* feed vuoto in caso di errore */ }

  const now = new Date().toUTCString();

  const entries = items.map((it) => {
    const url = SITE + "/articolo/" + it.id + "/" + slugify(it.title);
    const date = it.date || it.created_at;
    let pub = now;
    try { if (date) pub = new Date(date).toUTCString(); } catch (e) {}
    const desc = stripHtml(it.subtitle || it.anteprima || "").slice(0, 300);
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
