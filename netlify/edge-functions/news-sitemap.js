// netlify/edge-functions/news-sitemap.js
// Google News sitemap: SOLO gli articoli delle ultime 48 ore, con i tag <news:news>.
// Raggiungibile su https://iattualita.it/news-sitemap.xml
// Da inviare in Google Search Console tra le Sitemap.

const SUPABASE_URL = "https://wzkshpgakvasqwrrgkgd.supabase.co";
const SUPABASE_KEY = "sb_publishable_I3s4phA5Be9qnV4pLbWQMQ_8-IGUE-b";
const SITE = "https://iattualita.it";
const PUB_NAME = "Iattualità";
const LANG = "it";
const WINDOW_MS = 48 * 60 * 60 * 1000; // 48 ore

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

export default async () => {
  let items = [];
  try {
    const r = await fetch(
      SUPABASE_URL + "/rest/v1/news?select=id,title,date,created_at&order=date.desc.nullslast,created_at.desc&limit=100",
      { headers: { apikey: SUPABASE_KEY } }
    );
    if (r.ok) items = await r.json();
  } catch (e) { /* sitemap vuota in caso di errore */ }

  const now = Date.now();
  const rows = items
    .map((it) => {
      const d = it.date || it.created_at;
      let ts = null;
      try { ts = d ? new Date(d).getTime() : null; } catch (e) {}
      return { it, ts };
    })
    .filter((x) => x.ts && (now - x.ts) <= WINDOW_MS)
    .slice(0, 1000);

  const urls = rows.map(({ it, ts }) => {
    const url = SITE + "/articolo/" + it.id + "/" + slugify(it.title);
    const iso = new Date(ts).toISOString();
    return `  <url>
    <loc>${esc(url)}</loc>
    <news:news>
      <news:publication>
        <news:name>${esc(PUB_NAME)}</news:name>
        <news:language>${LANG}</news:language>
      </news:publication>
      <news:publication_date>${iso}</news:publication_date>
      <news:title>${esc(it.title)}</news:title>
    </news:news>
  </url>`;
  }).join("\n");

  const xml = `<?xml version="1.0" encoding="UTF-8"?>
<urlset xmlns="http://www.sitemaps.org/schemas/sitemap/0.9" xmlns:news="http://www.google.com/schemas/sitemap-news/0.9">
${urls}
</urlset>`;

  return new Response(xml, {
    headers: {
      "content-type": "application/xml; charset=utf-8",
      "cache-control": "public, max-age=300",
    },
  });
};

export const config = { path: "/news-sitemap.xml" };
