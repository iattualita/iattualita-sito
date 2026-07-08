// Netlify Edge Function — anteprime social e title per singolo articolo.
const SUPABASE_URL = "https://wzkshpgakvasqwrrgkgd.supabase.co";
const SUPABASE_KEY = "sb_publishable_I3s4phA5Be9qnV4pLbWQMQ_8-IGUE-b";
const SITE = "https://iattualita.it";

const esc = (s) =>
  (s || "").toString()
    .replace(/&/g, "&amp;").replace(/</g, "&lt;")
    .replace(/>/g, "&gt;").replace(/"/g, "&quot;");

export default async (request, context) => {
  const url = new URL(request.url);
  const m = url.pathname.match(/^\/articolo\/([^/]+)/);
  const res = await context.next();
  if (!m) return res;
  const contentType = res.headers.get("content-type") || "";
  if (!contentType.includes("text/html")) return res;
  const id = decodeURIComponent(m[1]);
  let article = null;
  try {
    const r = await fetch(
      `${SUPABASE_URL}/rest/v1/news?id=eq.${encodeURIComponent(id)}&select=title,subtitle,summary,image,category,date&limit=1`,
      { headers: { apikey: SUPABASE_KEY } }
    );
    if (r.ok) { const rows = await r.json(); article = rows && rows[0]; }
  } catch (_) {}
  if (!article) return res;
  let html = await res.text();
  const title = esc(article.title) + " · Iattualità";
  const desc = esc(article.subtitle || article.summary || "Informazione verificata con i dati.").slice(0, 300);
  const img = article.image ? esc(article.image) : `${SITE}/og-default.jpg`;
  const canon = SITE + url.pathname;
  const block = `<!--OG_START-->
<title>${title}</title>
<meta name="description" content="${desc}">
<link rel="canonical" href="${canon}">
<meta property="og:type" content="article">
<meta property="og:site_name" content="Iattualità">
<meta property="og:locale" content="it_IT">
<meta property="og:title" content="${title}">
<meta property="og:description" content="${desc}">
<meta property="og:url" content="${canon}">
<meta property="og:image" content="${img}">
<meta name="twitter:card" content="summary_large_image">
<meta name="twitter:title" content="${title}">
<meta name="twitter:description" content="${desc}">
<meta name="twitter:image" content="${img}">
<!--OG_END-->`;
  html = html.replace(/<!--OG_START-->[\s\S]*?<!--OG_END-->/, block);
  const headers = new Headers(res.headers);
  headers.delete("content-length");
  headers.set("cache-control", "public, max-age=0, must-revalidate");
  return new Response(html, { status: res.status, headers });
};

export const config = { path: "/articolo/*" };
