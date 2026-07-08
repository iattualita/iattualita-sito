// Netlify Edge Function — sitemap.xml sempre aggiornata dagli articoli su Supabase.
const SUPABASE_URL = "https://wzkshpgakvasqwrrgkgd.supabase.co";
const SUPABASE_KEY = "sb_publishable_I3s4phA5Be9qnV4pLbWQMQ_8-IGUE-b";
const SITE = "https://iattualita.it";

function slugify(s) {
  return (
    (s || "").toString().toLowerCase()
      .normalize("NFD").replace(/[\u0300-\u036f]/g, "")
      .replace(/[^a-z0-9]+/g, "-").replace(/^-+|-+$/g, "")
      .slice(0, 60) || "articolo"
  );
}

export default async () => {
  let news = [];
  try {
    const r = await fetch(
      `${SUPABASE_URL}/rest/v1/news?select=id,title,date,created_at&order=date.desc.nullslast,created_at.desc`,
      { headers: { apikey: SUPABASE_KEY } }
    );
    if (r.ok) news = await r.json();
  } catch (_) {}

  const items = news
    .map((n) => {
      const loc = `${SITE}/articolo/${n.id}/${slugify(n.title)}`;
      const d = (n.date || n.created_at || "").toString().slice(0, 10);
      const lastmod = d ? `<lastmod>${d}</lastmod>` : "";
      return `<url><loc>${loc}</loc>${lastmod}</url>`;
    })
    .join("");

  const xml =
    `<?xml version="1.0" encoding="UTF-8"?>` +
    `<urlset xmlns="http://www.sitemaps.org/schemas/sitemap/0.9">` +
    `<url><loc>${SITE}/</loc></url>` +
    items +
    `</urlset>`;

  return new Response(xml, {
    headers: {
      "content-type": "application/xml; charset=utf-8",
      "cache-control": "public, max-age=3600",
    },
  });
};

export const config = { path: "/sitemap.xml" };
