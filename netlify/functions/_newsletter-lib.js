// netlify/functions/_newsletter-lib.js
// Utilità condivise dalle tre funzioni della newsletter.
// Nessun segreto qui dentro: le chiavi arrivano dalle variabili d'ambiente Netlify.
const crypto = require("crypto");

const SUPABASE_URL   = process.env.SUPABASE_URL || "https://wzkshpgakvasqwrrgkgd.supabase.co";
const SERVICE_ROLE   = process.env.SUPABASE_SERVICE_ROLE_KEY || "";
const BREVO_API_KEY  = process.env.BREVO_API_KEY || "";
const SENDER_EMAIL   = process.env.NEWSLETTER_SENDER_EMAIL || "newsletter@iattualita.it";
const SENDER_NAME    = process.env.NEWSLETTER_SENDER_NAME  || "Iattualità";
const SITE_URL       = process.env.SITE_URL || "https://iattualita.it";
const FN = SITE_URL + "/.netlify/functions";

const REST = SUPABASE_URL + "/rest/v1";
// Supporta entrambi i formati di chiave Supabase:
//  - classica "service_role" (JWT, inizia con eyJ): vuole anche l'header Authorization
//  - nuova "sb_secret_...": NON e' un JWT; va inviata solo come apikey,
//    perche' un Bearer non-JWT viene rifiutato dal gateway con 401.
const sbHeaders = (extra) => {
  const h = { apikey: SERVICE_ROLE, "Content-Type": "application/json" };
  if (SERVICE_ROLE.indexOf("eyJ") === 0) h.Authorization = "Bearer " + SERVICE_ROLE;
  return Object.assign(h, extra || {});
};

// --- Supabase (service_role: scavalca la RLS in modo sicuro, lato server) ---
// Errore leggibile: numero + messaggio di Supabase + formato chiave rilevato
// (mai la chiave stessa). Trasforma "db select 403" in una diagnosi.
async function sbError(prefix, r){
  let t=""; try{ t = await r.text(); }catch(e){}
  const kind = !SERVICE_ROLE ? "assente" : (SERVICE_ROLE.indexOf("eyJ")===0 ? "legacy-jwt" : (SERVICE_ROLE.indexOf("sb_secret")===0 ? "sb_secret" : "sconosciuto"));
  return new Error(prefix + " " + r.status + (t ? " — " + t.slice(0,300) : "") + " [chiave: " + kind + "]");
}
async function sbSelectByEmail(email){
  const r = await fetch(REST + "/subscribers?email=eq." + encodeURIComponent(email) + "&select=id,status,token", { headers: sbHeaders() });
  if(!r.ok) throw await sbError("db select", r);
  const a = await r.json();
  return a[0] || null;
}
async function sbSelectByToken(token){
  const r = await fetch(REST + "/subscribers?token=eq." + encodeURIComponent(token) + "&select=id,status,email", { headers: sbHeaders() });
  if(!r.ok) throw await sbError("db select", r);
  const a = await r.json();
  return a[0] || null;
}
async function sbInsert(email, token){
  const r = await fetch(REST + "/subscribers", { method:"POST", headers: sbHeaders({Prefer:"return=minimal"}),
    body: JSON.stringify({ email, status:"pending", token }) });
  if(!r.ok) throw await sbError("db insert", r);
}
async function sbPatch(id, patch){
  const r = await fetch(REST + "/subscribers?id=eq." + id, { method:"PATCH", headers: sbHeaders({Prefer:"return=minimal"}),
    body: JSON.stringify(patch) });
  if(!r.ok) throw await sbError("db patch", r);
}

// --- Brevo (invio email transazionale) ---
function htmlToText(html){
  return String(html||"")
    .replace(/<style[\s\S]*?<\/style>/gi," ")
    .replace(/<a[^>]*href="([^"]*)"[^>]*>([\s\S]*?)<\/a>/gi,"$2 ($1)")
    .replace(/<\/(p|div|tr|h[1-6]|li)>/gi,"\n")
    .replace(/<br\s*\/?>(?=)/gi,"\n")
    .replace(/<[^>]+>/g," ")
    .replace(/&nbsp;/gi," ").replace(/&amp;/gi,"&").replace(/&agrave;/gi,"à").replace(/&egrave;/gi,"è").replace(/&middot;/gi,"·").replace(/&rarr;/gi,"->")
    .replace(/[ \t]+/g," ").replace(/\n{3,}/g,"\n\n").trim();
}
async function brevoSend(toEmail, subject, html, text){
  const r = await fetch("https://api.brevo.com/v3/smtp/email", {
    method:"POST",
    headers:{ "api-key": BREVO_API_KEY, "Content-Type":"application/json", accept:"application/json" },
    body: JSON.stringify({
      sender:{ name: SENDER_NAME, email: SENDER_EMAIL },
      replyTo:{ email: SENDER_EMAIL, name: SENDER_NAME },
      to:[{ email: toEmail }],
      subject,
      htmlContent: html,
      textContent: text || htmlToText(html)
    })
  });
  if(!r.ok) throw new Error("brevo " + r.status + " " + (await r.text()));
  return true;
}

const newToken = () => crypto.randomUUID();

// --- Email di conferma (double opt-in) ---
function confirmEmailHtml(token){
  const link = FN + "/confirm?token=" + token;
  return `<div style="font-family:Arial,Helvetica,sans-serif;max-width:520px;margin:0 auto;color:#16243F">
    <h1 style="font-size:22px;margin:0 0 12px">Conferma la tua iscrizione</h1>
    <p style="font-size:15px;line-height:1.6;color:#2A3A57">Hai chiesto di ricevere la newsletter di Iattualità. Per completare l'iscrizione clicca qui sotto:</p>
    <p style="margin:22px 0"><a href="${link}" style="background:#E8A33D;color:#16243F;text-decoration:none;font-weight:bold;padding:13px 22px;border-radius:10px;display:inline-block">Confermo l'iscrizione</a></p>
    <p style="font-size:13px;line-height:1.6;color:#7A8499">Se non sei stato tu, ignora questa email: senza conferma non riceverai nulla.</p>
    <p style="font-size:12px;color:#7A8499;margin-top:24px">Iattualità · L'informazione intelligente e in tempo reale</p>
  </div>`;
}

// --- Pagine HTML mostrate dopo il click (conferma / disiscrizione) ---
function page(title, body){
  return `<!doctype html><html lang="it"><head><meta charset="utf-8">
  <meta name="viewport" content="width=device-width, initial-scale=1"><title>${title} · Iattualità</title>
  <link rel="stylesheet" href="https://fonts.googleapis.com/css2?family=Anton&family=Barlow:wght@400;600;700&display=swap"></head>
  <body style="margin:0;background:#F4F2EC;font-family:Barlow,Arial,sans-serif;color:#16243F">
    <div style="max-width:520px;margin:0 auto;padding:60px 20px;text-align:center">
      <div style="font-family:Anton;font-size:26px;color:#16243F;margin-bottom:14px">${title}</div>
      <div style="font-size:16px;line-height:1.6;color:#2A3A57">${body}</div>
      <a href="${SITE_URL}" style="display:inline-block;margin-top:26px;background:#16243F;color:#fff;text-decoration:none;font-weight:700;padding:12px 22px;border-radius:11px">Torna al sito</a>
    </div>
  </body></html>`;
}
const html = (statusCode, htmlBody) => ({ statusCode, headers:{ "Content-Type":"text/html; charset=utf-8" }, body: htmlBody });
const json = (statusCode, obj) => ({ statusCode, headers:{ "Content-Type":"application/json" }, body: JSON.stringify(obj) });
const validEmail = (e) => /^[^@\s]+@[^@\s]+\.[^@\s]+$/.test(e);

// ================== DIGEST SETTIMANALE ==================
function slugify(x){ return (x||"").toString().toLowerCase().normalize("NFD").replace(/[\u0300-\u036f]/g,"").replace(/[^a-z0-9]+/g,"-").replace(/^-+|-+$/g,"").slice(0,60)||"articolo"; }
const articleUrl = (a) => SITE_URL + "/articolo/" + a.id + "/" + slugify(a.title);

async function sbConfirmedSubscribers(){
  const r = await fetch(REST + "/subscribers?status=eq.confirmed&select=email,token", { headers: sbHeaders() });
  if(!r.ok) throw await sbError("db select", r);
  return r.json();
}
async function sbLastSend(){
  const r = await fetch(REST + "/newsletter_log?select=sent_at&order=sent_at.desc&limit=1", { headers: sbHeaders() });
  if(!r.ok) throw await sbError("db select", r);
  const a = await r.json();
  return a[0] ? a[0].sent_at : null;
}
async function sbNewsSince(iso){
  const r = await fetch(REST + "/news?select=id,title,subtitle,summary,category,image,date,created_at&created_at=gt." + encodeURIComponent(iso) + "&order=created_at.desc&limit=20", { headers: sbHeaders() });
  if(!r.ok) throw await sbError("db select", r);
  return r.json();
}
async function sbLogSend(articleIds, recipients){
  const r = await fetch(REST + "/newsletter_log", { method:"POST", headers: sbHeaders({Prefer:"return=minimal"}),
    body: JSON.stringify({ article_ids: articleIds, recipients }) });
  if(!r.ok) throw await sbError("db insert", r);
}

// Verifica che chi preme il bottone sia la redazione (token Supabase valido)
async function verifyRedazione(bearer){
  if(!bearer) return false;
  try{
    const r = await fetch(SUPABASE_URL + "/auth/v1/user", { headers:{ apikey: SERVICE_ROLE, Authorization: "Bearer " + bearer } });
    if(!r.ok) return false;
    const u = await r.json();
    return !!(u && u.id);
  }catch(e){ return false; }
}

function digestHtml(articles, unsubUrl){
  const rows = articles.map(a => {
    const img = a.image ? '<img src="'+a.image+'" alt="" width="536" style="width:100%;max-width:536px;border-radius:10px;display:block;margin:0 0 10px">' : "";
    const sub = a.subtitle || a.summary || "";
    return '<td style="padding:0 0 26px">'
      + img
      + '<div style="font-size:11px;font-weight:bold;letter-spacing:.6px;color:#E8A33D;text-transform:uppercase;padding:0 0 6px">' + (a.category||"") + '</div>'
      + '<a href="'+articleUrl(a)+'" style="font-size:20px;line-height:1.25;font-weight:bold;color:#16243F;text-decoration:none;display:block">'+ (a.title||"") +'</a>'
      + (sub ? '<div style="font-size:14px;line-height:1.5;color:#2A3A57;padding-top:6px">'+ sub +'</div>' : "")
      + '<a href="'+articleUrl(a)+'" style="display:inline-block;margin-top:10px;font-size:13px;font-weight:bold;color:#2C5AA0;text-decoration:none">Leggi l\'articolo &rarr;</a>'
      + '</td>';
  }).map(td => '<tr>'+td+'</tr>').join("");
  return '<!doctype html><html lang="it"><body style="margin:0;background:#F4F2EC">'
    + '<table role="presentation" width="100%" cellpadding="0" cellspacing="0" style="background:#F4F2EC"><tr><td align="center" style="padding:26px 12px">'
    + '<table role="presentation" width="560" cellpadding="0" cellspacing="0" style="max-width:560px;width:100%">'
    + '<tr><td style="padding:0 12px 18px;font-family:Arial,Helvetica,sans-serif">'
    + '<div style="font-size:26px;font-weight:bold;color:#16243F">Iattualit&agrave;</div>'
    + '<div style="font-size:13px;color:#2A3A57">Gli articoli della settimana &middot; non tifiamo per nessuno, verifichiamo</div>'
    + '</td></tr>'
    + '<tr><td style="padding:0 12px"><table role="presentation" width="100%" cellpadding="0" cellspacing="0" style="font-family:Arial,Helvetica,sans-serif">' + rows + '</table></td></tr>'
    + '<tr><td style="padding:14px 12px;border-top:1px solid #E3DFD6;font-family:Arial,Helvetica,sans-serif;font-size:12px;color:#7A8499;line-height:1.5">'
    + 'Ricevi questa email perch&eacute; ti sei iscritto su iattualita.it.<br>'
    + '<a href="'+unsubUrl+'" style="color:#7A8499">Disiscriviti</a> quando vuoi &middot; Iattualit&agrave; &middot; L\'informazione intelligente e in tempo reale'
    + '</td></tr></table></td></tr></table></body></html>';
}

// Cuore dell'invio. dry=true: conta senza spedire.
async function runDigest(opts){
  const dry = !!(opts && opts.dry);
  const last = await sbLastSend();
  const since = last || new Date(Date.now() - 7*24*3600*1000).toISOString();
  const articles = await sbNewsSince(since);
  const subs = await sbConfirmedSubscribers();
  if(dry) return { dry:true, since, articles: articles.length, recipients: subs.length };
  if(articles.length === 0) return { sent:false, reason:"nessun articolo nuovo", since, recipients: subs.length };
  if(subs.length === 0)     return { sent:false, reason:"nessun iscritto confermato", since, articles: articles.length };
  let ok = 0, failed = 0;
  for(const s of subs){
    const unsub = FN + "/unsubscribe?token=" + s.token;
    try{ await brevoSend(s.email, "Iattualità — gli articoli della settimana", digestHtml(articles, unsub)); ok++; }
    catch(e){ failed++; }
  }
  await sbLogSend(articles.map(a=>a.id), ok);
  return { sent:true, since, articles: articles.length, recipients: subs.length, delivered: ok, failed };
}

module.exports = {
  sbSelectByEmail, sbSelectByToken, sbInsert, sbPatch,
  brevoSend, newToken, confirmEmailHtml, page, html, json, validEmail,
  runDigest, verifyRedazione,
  SITE_URL, config: { SERVICE_ROLE, BREVO_API_KEY }
};
