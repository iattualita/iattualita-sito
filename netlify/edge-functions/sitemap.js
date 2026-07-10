// netlify/edge-functions/sitemap.js
// Sitemap dinamica: le categorie vengono lette dal database, non da una lista fissa.
// Aggiungendo una nuova categoria alle news, la sitemap si aggiorna da sola.

const SUPABASE_URL = "https://wzkshpgakvasqwrrgkgd.supabase.co";
const SUPABASE_KEY = "sb_publishable_I3s4phA5Be9qnV4pLbWQMQ_8-IGUE-b";
const SITE = "https://iattualita.it";

// Deve restare identica alla slugify() dentro index.html
function slugify(s) {
  return (s || "")
    .toString()
    .toLowerCase()
    .normalize("NFD")
    .replace(/[\u0300-\u036f]/g, "")
    .replace(/[^a-z0-9]+/g, "-")
    .replace(/^-+|-+$/g, "")
    .slice(0, 60) || "articolo";
}

function esc(s) {
  return String(s)
    .replace(/&/g, "&amp;")
    .replace(/</g, "&lt;")
    .replace(/>/g, "&gt;")
    .replace(/"/g, "&quot;")
    .replace(/'/g, "&apos;");
}

function iso(d) {
  if (!d) return "";
  const s = String(d).slice(0, 10);
  return /^\d{4}-\d{2}-\d{2}$/.test(s) ? s : "";
}

export default async function handler() {
  let news = [];
  try {
    const res = await fetch(
      SUPABASE_URL +
        "/rest/v1/news?select=id,title,category,date,created_at&order=date.desc.nullslast,created_at.desc",
      { headers: { apikey: SUPABASE_KEY } }
    );
    if (res.ok) news = await res.json();
  } catch (_) {
    // in caso di errore si genera comunque una sitemap minima con la home
  }

  const urls = [];

  // Home
  urls.push({ loc: SITE + "/", changefreq: "hourly", priority: "1.0" });

  // Pagine argomento — dedotte dalle categorie realmente presenti in archivio
  const cats = [...new Set(news.map((n) => n.category).filter(Boolean))].sort((a, b) =>
    a.localeCompare(b, "it")
  );
  for (const c of cats) {
    urls.push({
      loc: SITE + "/argomento/" + encodeURIComponent(c),
      changefreq: "daily",
      priority: "0.7",
    });
  }

  // Articoli
  for (const n of news) {
    if (!n.id || !n.title) continue;
    urls.push({
      loc: SITE + "/articolo/" + n.id + "/" + slugify(n.title),
      lastmod: iso(n.date || n.created_at),
      changefreq: "weekly",
      priority: "0.8",
    });
  }

  const body =
    '<?xml version="1.0" encoding="UTF-8"?>\n' +
    '<urlset xmlns="http://www.sitemaps.org/schemas/sitemap/0.9">\n' +
    urls
      .map(
        (u) =>
          "  <url><loc>" +
          esc(u.loc) +
          "</loc>" +
          (u.lastmod ? "<lastmod>" + u.lastmod + "</lastmod>" : "") +
          "<changefreq>" +
          u.changefreq +
          "</changefreq><priority>" +
          u.priority +
          "</priority></url>"
      )
      .join("\n") +
    "\n</urlset>\n";

  return new Response(body, {
    headers: {
      "content-type": "application/xml; charset=utf-8",
      // cache CDN 1 ora, così Google non colpisce Supabase a ogni fetch
      "cache-control": "public, max-age=0, s-maxage=3600",
    },
  });
}

export const config = { path: "/sitemap.xml" };
