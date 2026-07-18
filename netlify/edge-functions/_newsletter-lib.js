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
const sbHeaders = (extra) => Object.assign({
  apikey: SERVICE_ROLE,
  Authorization: "Bearer " + SERVICE_ROLE,
  "Content-Type": "application/json"
}, extra || {});

// --- Supabase (service_role: scavalca la RLS in modo sicuro, lato server) ---
async function sbSelectByEmail(email){
  const r = await fetch(REST + "/subscribers?email=eq." + encodeURIComponent(email) + "&select=id,status,token", { headers: sbHeaders() });
  if(!r.ok) throw new Error("db select " + r.status);
  const a = await r.json();
  return a[0] || null;
}
async function sbSelectByToken(token){
  const r = await fetch(REST + "/subscribers?token=eq." + encodeURIComponent(token) + "&select=id,status,email", { headers: sbHeaders() });
  if(!r.ok) throw new Error("db select " + r.status);
  const a = await r.json();
  return a[0] || null;
}
async function sbInsert(email, token){
  const r = await fetch(REST + "/subscribers", { method:"POST", headers: sbHeaders({Prefer:"return=minimal"}),
    body: JSON.stringify({ email, status:"pending", token }) });
  if(!r.ok) throw new Error("db insert " + r.status + " " + (await r.text()));
}
async function sbPatch(id, patch){
  const r = await fetch(REST + "/subscribers?id=eq." + id, { method:"PATCH", headers: sbHeaders({Prefer:"return=minimal"}),
    body: JSON.stringify(patch) });
  if(!r.ok) throw new Error("db patch " + r.status + " " + (await r.text()));
}

// --- Brevo (invio email transazionale) ---
async function brevoSend(toEmail, subject, html){
  const r = await fetch("https://api.brevo.com/v3/smtp/email", {
    method:"POST",
    headers:{ "api-key": BREVO_API_KEY, "Content-Type":"application/json", accept:"application/json" },
    body: JSON.stringify({
      sender:{ name: SENDER_NAME, email: SENDER_EMAIL },
      to:[{ email: toEmail }],
      subject,
      htmlContent: html
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

module.exports = {
  sbSelectByEmail, sbSelectByToken, sbInsert, sbPatch,
  brevoSend, newToken, confirmEmailHtml, page, html, json, validEmail,
  SITE_URL, config: { SERVICE_ROLE, BREVO_API_KEY }
};
