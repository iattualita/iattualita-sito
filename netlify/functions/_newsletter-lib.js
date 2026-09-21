// netlify/functions/_newsletter-lib.js
// Utilità condivise dalle tre funzioni della newsletter.
// Nessun segreto qui dentro: le chiavi arrivano dalle variabili d'ambiente Netlify.
const crypto = require("crypto");

const SUPABASE_URL   = process.env.SUPABASE_URL || "https://wzkshpgakvasqwrrgkgd.supabase.co";
const SERVICE_ROLE   = process.env.SUPABASE_SERVICE_ROLE_KEY || "";
const BREVO_API_KEY  = process.env.BREVO_API_KEY || "";
const SENDER_EMAIL   = process.env.NEWSLETTER_SENDER_EMAIL || "newsletter@iattualita.it";
const SENDER_NAME    = process.env.NEWSLETTER_SENDER_NAME  || "Iattualità";
// Mittente separato per la sola email di conferma (double opt-in):
// un indirizzo "newsletter@" e' un marcatore promozionale per Gmail e spinge
// il messaggio nella scheda Promozioni, dove l'opt-in rischia di non essere visto.
const CONFIRM_SENDER_EMAIL = process.env.CONFIRM_SENDER_EMAIL || "conferma@iattualita.it";
const CONFIRM_SENDER_NAME  = process.env.CONFIRM_SENDER_NAME  || "Redazione Iattualità";
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

// --- Limitazione degli abusi ---
// Si appoggia alla funzione rate_hit() creata da
// supabase/migrations/001_rate_limit.sql.
//
// FAIL-OPEN di proposito: se la migrazione non e' ancora stata eseguita, o se
// Supabase non risponde, la richiesta passa. Un form di iscrizione che blocca
// i lettori veri per un problema di infrastruttura fa piu' danni dello spam
// che dovrebbe fermare. L'errore finisce nei log della function.
//
// Ritorna true = consentito, false = oltre il limite.
async function rateHit(key, windowSeconds, maxHits) {
  try {
    const r = await fetch(REST + "/rpc/rate_hit", {
      method: "POST",
      headers: sbHeaders(),
      body: JSON.stringify({ k: key, window_seconds: windowSeconds, max_hits: maxHits })
    });
    if (!r.ok) {
      console.warn("rateHit non disponibile (" + r.status + "): la migrazione 001_rate_limit.sql e' stata eseguita?");
      return true;
    }
    return (await r.json()) !== false;
  } catch (e) {
    console.warn("rateHit errore:", e && e.message);
    return true;
  }
}

// L'IP di chi chiama, come lo espone Netlify. Se manca si usa una chiave
// unica: senza IP il limite per indirizzo email resta comunque attivo.
function clientIp(event) {
  const h = (event && event.headers) || {};
  return (
    h["x-nf-client-connection-ip"] ||
    h["client-ip"] ||
    String(h["x-forwarded-for"] || "").split(",")[0].trim() ||
    "sconosciuto"
  );
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
// sender opzionale: { name, email }. Se assente usa il mittente newsletter.
//
// unsubUrl opzionale: se presente, il messaggio parte con gli header
// List-Unsubscribe e List-Unsubscribe-Post. Dal 2024 Gmail e Yahoo li
// pretendono da chi invia in massa, e chi non li manda si vede peggiorare
// il recapito. In pratica fanno comparire "Annulla iscrizione" accanto al
// mittente: il lettore che non vuole piu' le email usa quello invece del
// pulsante "Spam", che invece danneggia la reputazione del dominio.
//
// List-Unsubscribe-Post dichiara che l'annullamento funziona in un clic
// (RFC 8058): il gestore di posta manda una POST a quell'indirizzo, e
// unsubscribe.js la gestisce senza chiedere conferma.
async function brevoSend(toEmail, subject, html, text, sender, unsubUrl){
  const from = sender && sender.email ? sender : { name: SENDER_NAME, email: SENDER_EMAIL };
  const payload = {
    sender:{ name: from.name, email: from.email },
    replyTo:{ email: from.email, name: from.name },
    to:[{ email: toEmail }],
    subject,
    htmlContent: html,
    textContent: text || htmlToText(html)
  };
  if(unsubUrl){
    payload.headers = {
      "List-Unsubscribe": "<" + unsubUrl + ">",
      "List-Unsubscribe-Post": "List-Unsubscribe=One-Click"
    };
  }
  const r = await fetch("https://api.brevo.com/v3/smtp/email", {
    method:"POST",
    headers:{ "api-key": BREVO_API_KEY, "Content-Type":"application/json", accept:"application/json" },
    body: JSON.stringify(payload)
  });
  if(!r.ok) throw new Error("brevo " + r.status + " " + (await r.text()));
  return true;
}

const newToken = () => crypto.randomUUID();

// --- Email di conferma (double opt-in) ---
// Template volutamente spoglio: niente bottone colorato, niente immagini,
// niente tagline di brand, un solo link visibile come testo. Sono tutti
// marcatori che Gmail usa per classificare un messaggio come promozionale.
function confirmEmailHtml(token){
  const link = FN + "/confirm?token=" + token;
  return `<p>Hai chiesto di ricevere la newsletter di Iattualità.</p>
<p>Per completare l'iscrizione apri questo indirizzo:<br>
<a href="${link}">${link}</a></p>
<p>Se non sei stato tu, ignora questa email: senza conferma non riceverai nulla.</p>`;
}

// --- Pagine HTML mostrate dopo il click (conferma / disiscrizione) ---
//
// action opzionale: { url, label }. Se c'e', la pagina mostra un pulsante che
// manda una POST a quell'indirizzo invece del solito "Torna al sito".
//
// Serve perche' i filtri antivirus aziendali e i precaricatori dei client di
// posta aprono da soli i link contenuti nelle email, con una GET. Se fosse la
// GET a fare il lavoro, quei programmi confermerebbero iscrizioni che nessuno
// ha voluto (svuotando di senso il doppio consenso su cui poggia la privacy
// policy) e disiscriverebbero lettori che non hanno cliccato niente. Nessuno
// di quei programmi invia POST, quindi spostare l'azione sulla POST li taglia
// fuori chiedendo al lettore un clic in piu'.
function page(title, body, action){
  const btn = action
    ? `<form method="post" action="${action.url}" style="margin:26px 0 0">
         <button type="submit" style="background:#16243F;color:#fff;border:none;font-family:inherit;font-weight:700;font-size:16px;padding:12px 22px;border-radius:11px;cursor:pointer">${action.label}</button>
       </form>
       <a href="${SITE_URL}" style="display:inline-block;margin-top:16px;color:#2C5AA0;font-size:14px">Torna al sito</a>`
    : `<a href="${SITE_URL}" style="display:inline-block;margin-top:26px;background:#16243F;color:#fff;text-decoration:none;font-weight:700;padding:12px 22px;border-radius:11px">Torna al sito</a>`;
  return `<!doctype html><html lang="it"><head><meta charset="utf-8">
  <meta name="viewport" content="width=device-width, initial-scale=1"><title>${title} · Iattualità</title>
  <meta name="robots" content="noindex">
  <link rel="stylesheet" href="https://fonts.googleapis.com/css2?family=Anton&family=Barlow:wght@400;600;700&display=swap"></head>
  <body style="margin:0;background:#F4F2EC;font-family:Barlow,Arial,sans-serif;color:#16243F">
    <div style="max-width:520px;margin:0 auto;padding:60px 20px;text-align:center">
      <div style="font-family:Anton;font-size:26px;color:#16243F;margin-bottom:14px">${title}</div>
      <div style="font-size:16px;line-height:1.6;color:#2A3A57">${body}</div>
      ${btn}
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
  const r = await fetch(REST + "/subscribers?status=eq.confirmed&select=id,email,token,last_digest_at", { headers: sbHeaders() });
  if(!r.ok) throw await sbError("db select", r);
  return r.json();
}
// Segna che a questo iscritto il digest corrente e' partito. Va scritto
// subito dopo l'invio, non in fondo al giro: e' cio' che rende l'invio
// ripartibile se la funzione viene interrotta a meta'.
async function sbMarkDigestSent(id){
  await sbPatch(id, { last_digest_at: new Date().toISOString() });
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

// Quanti iscritti serve al massimo in una sola chiamata. Una funzione
// serverless sincrona ha una manciata di secondi: 25 invii a 4 alla volta
// stanno larghi, e chi resta viene servito dalla chiamata successiva.
const BATCH = 25;
const CONCURRENCY = 4;

// Esegue task a piccoli gruppi invece che tutti insieme: l'API di Brevo ha
// un tetto di richieste al secondo, e saturarlo farebbe fallire gli invii.
async function inPool(items, size, fn){
  for(let i = 0; i < items.length; i += size){
    await Promise.all(items.slice(i, i + size).map(fn));
  }
}

// Cuore dell'invio.
//
//  dry=true  -> conta soltanto, non spedisce niente.
//  dry=false -> spedisce al massimo BATCH iscritti e dice quanti ne restano.
//
// L'invio e' RIPARTIBILE. Il registro newsletter_log viene scritto solo
// quando l'ultimo iscritto e' stato servito, quindi finche' il giro non e'
// completo la data di partenza non si sposta; nel frattempo ogni iscritto
// servito viene marcato con last_digest_at, e chi e' gia' marcato viene
// saltato. Cosi' un'interruzione a meta' (timeout, errore, chiusura del
// browser) non produce mai un doppio invio: basta richiamare la funzione e
// riprende da dove si era fermata.
async function runDigest(opts){
  const dry = !!(opts && opts.dry);
  const limit = (opts && opts.limit) || BATCH;

  const last = await sbLastSend();
  const since = last || new Date(Date.now() - 7*24*3600*1000).toISOString();
  const articles = await sbNewsSince(since);
  const subs = await sbConfirmedSubscribers();

  // Chi non ha ancora ricevuto QUESTO digest. Il confronto passa da getTime()
  // e non dalle stringhe: Supabase puo' restituire "+00:00" o "Z" a seconda
  // della colonna, e due formati diversi si ordinerebbero a caso.
  const sinceMs = new Date(since).getTime();
  const pending = subs.filter(s => {
    if(!s.last_digest_at) return true;
    const t = new Date(s.last_digest_at).getTime();
    return isNaN(t) || t <= sinceMs;
  });

  if(dry) return { dry:true, since, articles: articles.length, recipients: subs.length, remaining: pending.length };
  if(articles.length === 0) return { sent:false, done:true, reason:"nessun articolo nuovo", since, recipients: subs.length };
  if(subs.length === 0)     return { sent:false, done:true, reason:"nessun iscritto confermato", since, articles: articles.length };

  // Tutti gia' serviti ma il registro non e' stato scritto: e' l'ultimo
  // frammento di un invio interrotto proprio sul finale. Si chiude e basta.
  if(pending.length === 0){
    await sbLogSend(articles.map(a=>a.id), subs.length);
    return { sent:true, done:true, since, articles: articles.length, recipients: subs.length, delivered:0, failed:0, remaining:0 };
  }

  const batch = pending.slice(0, limit);
  const html = digestHtml(articles, "{{UNSUB}}");
  let ok = 0, failed = 0;

  await inPool(batch, CONCURRENCY, async (s) => {
    const unsub = FN + "/unsubscribe?token=" + s.token;
    try{
      await brevoSend(s.email, "Iattualità — gli articoli della settimana", html.split("{{UNSUB}}").join(unsub), null, null, unsub);
      await sbMarkDigestSent(s.id);
      ok++;
    }catch(e){
      // Non marchiamo: chi fallisce resta in coda e ci riprova al giro dopo.
      failed++;
      console.warn("digest, invio fallito per un iscritto:", e && e.message);
    }
  });

  const remaining = pending.length - ok;
  const done = remaining === 0;
  if(done) await sbLogSend(articles.map(a=>a.id), subs.length);

  return { sent:true, done, since, articles: articles.length, recipients: subs.length, delivered: ok, failed, remaining };
}

module.exports = {
  sbSelectByEmail, sbSelectByToken, sbInsert, sbPatch,
  brevoSend, newToken, confirmEmailHtml, page, html, json, validEmail,
  rateHit, clientIp,
  runDigest, verifyRedazione,
  confirmSender: { name: CONFIRM_SENDER_NAME, email: CONFIRM_SENDER_EMAIL },
  SITE_URL, config: { SERVICE_ROLE, BREVO_API_KEY }
};
