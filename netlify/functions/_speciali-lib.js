// netlify/functions/_speciali-lib.js
// Invii speciali: email decise dalla redazione, fuori dal digest settimanale.
//
// Il digest manda gli articoli pubblicati sul sito. Un invio speciale manda
// cio' che sul sito non c'e': un messaggio agli iscritti, un video caricato
// dalla redazione, un articolo riservato. Usa la stessa lista (subscribers),
// lo stesso mittente e lo stesso link di disiscrizione del digest: chi si
// disiscrive da uno smette di ricevere anche l'altro.
//
// Il video NON viaggia dentro l'email: pesa decine di MB, i gestori di posta
// rifiutano allegati del genere e quasi nessuno li riproduce. Sta in un
// bucket privato di Supabase e si guarda dalla pagina riservata
// (riservato.mjs), che controlla l'iscrizione prima di aprirlo.
const crypto = require("crypto");
const L = require("./_newsletter-lib");

const VIDEO_BUCKET = "riservati";
// Durata del link al file video. Basta a guardarlo con calma; scaduto,
// riaprendo la pagina dall'email se ne genera uno nuovo.
const VIDEO_LINK_S = 6 * 3600;

const isUuid = (x) => /^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/i.test(String(x || ""));

// --- testo ---------------------------------------------------------------
const esc = (s) => String(s == null ? "" : s)
  .replace(/&/g, "&amp;").replace(/</g, "&lt;").replace(/>/g, "&gt;").replace(/"/g, "&quot;");

// Il messaggio agli iscritti si scrive come testo semplice: una riga vuota
// separa i paragrafi, un a capo resta un a capo, gli indirizzi web diventano
// link. Si fa l'escape di tutto prima: nessun HTML scritto a mano entra
// nell'email.
function paragraphs(text, linkStyle) {
  const st = linkStyle || "color:#2C5AA0";
  return String(text || "").trim().split(/\n\s*\n/).filter(Boolean).map((blk) =>
    "<p style=\"margin:0 0 14px\">" +
    esc(blk.trim())
      .replace(/https?:\/\/[^\s<]+[^\s<.,;:!?)"']/g, (u) => '<a href="' + u + '" style="' + st + '">' + u + "</a>")
      .replace(/\n/g, "<br>") +
    "</p>"
  ).join("");
}

// Testo nudo da HTML, per l'anteprima dell'articolo e per capire se il
// corpo e' davvero vuoto (l'editor lascia spesso un <br> anche a campo vuoto).
function plain(html) {
  return String(html || "")
    .replace(/<(style|script)[\s\S]*?<\/\1>/gi, " ")
    .replace(/<\/?(p|div|br|li|ul|ol|h[1-6]|blockquote|tr|td|th|hr)\b[^>]*>/gi, " ")
    .replace(/<[^>]+>/g, "")
    .replace(/&nbsp;/gi, " ").replace(/&amp;/gi, "&").replace(/&quot;/gi, '"')
    .replace(/&#39;|&apos;/gi, "'").replace(/&lt;/gi, "<").replace(/&gt;/gi, ">")
    .replace(/\s+/g, " ").trim();
}

function excerpt(html, max) {
  const t = plain(html);
  if (t.length <= max) return t;
  const cut = t.slice(0, max);
  const sp = cut.lastIndexOf(" ");
  return (sp > max * 0.6 ? cut.slice(0, sp) : cut).replace(/[,;:.\-\s]+$/, "") + "…";
}

// --- link ----------------------------------------------------------------
// Ogni iscritto riceve un link personale: contiene il suo token, lo stesso
// che usa la disiscrizione. La pagina riservata lo controlla a ogni apertura,
// quindi chi si disiscrive perde l'accesso anche agli invii gia' ricevuti.
const viewUrl = (id, token) => L.FN + "/riservato?id=" + id + "&t=" + encodeURIComponent(token);

// L'invio di prova va alla redazione, che non e' necessariamente iscritta:
// il suo link porta una firma calcolata con la chiave del server, che
// nessuno fuori dal server puo' produrre.
function previewSig(id) {
  return crypto.createHmac("sha256", "anteprima-speciale:" + L.config.SERVICE_ROLE)
    .update(String(id)).digest("hex").slice(0, 32);
}
const previewUrl = (id) => L.FN + "/riservato?id=" + id + "&p=" + previewSig(id);
function validPreview(id, sig) {
  if (!L.config.SERVICE_ROLE || !sig) return false;
  const a = Buffer.from(previewSig(id)), b = Buffer.from(String(sig));
  return a.length === b.length && crypto.timingSafeEqual(a, b);
}

// --- Supabase --------------------------------------------------------------
async function loadSpecial(id) {
  if (!isUuid(id)) return null;
  const r = await fetch(L.REST + "/newsletter_specials?id=eq." + id + "&select=*", { headers: L.sbHeaders() });
  if (!r.ok) throw await L.sbError("db select", r);
  const a = await r.json();
  return a[0] || null;
}
async function patchSpecial(id, patch) {
  const r = await fetch(L.REST + "/newsletter_specials?id=eq." + id, {
    method: "PATCH", headers: L.sbHeaders({ Prefer: "return=minimal" }),
    body: JSON.stringify(Object.assign({ updated_at: new Date().toISOString() }, patch))
  });
  if (!r.ok) throw await L.sbError("db patch", r);
}
// Supabase restituisce al massimo 1000 righe per richiesta: oltre quella
// soglia una lista letta in un colpo solo verrebbe troncata senza avviso.
async function getAll(pathQuery) {
  const out = [];
  for (let offset = 0; ; offset += 1000) {
    const r = await fetch(L.REST + pathQuery + "&limit=1000&offset=" + offset, { headers: L.sbHeaders() });
    if (!r.ok) throw await L.sbError("db select", r);
    const rows = await r.json();
    out.push(...rows);
    if (rows.length < 1000) return out;
  }
}
const confirmedSubscribers = () => getAll("/subscribers?status=eq.confirmed&select=id,email,token&order=id");
async function deliveredIds(specialId) {
  const rows = await getAll("/newsletter_special_deliveries?special_id=eq." + specialId + "&select=subscriber_id&order=subscriber_id");
  return rows.map((r) => r.subscriber_id);
}
async function markDelivered(specialId, subscriberId) {
  const r = await fetch(L.REST + "/newsletter_special_deliveries", {
    method: "POST",
    headers: L.sbHeaders({ Prefer: "resolution=ignore-duplicates,return=minimal" }),
    body: JSON.stringify({ special_id: specialId, subscriber_id: subscriberId })
  });
  if (!r.ok) throw await L.sbError("db insert", r);
}

// Link temporaneo al video nel bucket privato.
async function signedVideoUrl(path) {
  const clean = String(path || "").split("/").map(encodeURIComponent).join("/");
  const r = await fetch(L.SUPABASE_URL + "/storage/v1/object/sign/" + VIDEO_BUCKET + "/" + clean, {
    method: "POST", headers: L.sbHeaders(), body: JSON.stringify({ expiresIn: VIDEO_LINK_S })
  });
  if (!r.ok) throw await L.sbError("storage sign", r);
  const d = await r.json();
  const rel = d.signedURL || d.signedUrl || "";
  if (!rel) throw new Error("storage sign: risposta senza link");
  return /^https?:/.test(rel) ? rel : L.SUPABASE_URL + "/storage/v1" + (rel[0] === "/" ? "" : "/") + rel;
}

// --- contenuto -------------------------------------------------------------
const hasArticle = (sp) => !!(String(sp.article_title || "").trim() && plain(sp.article_body));

// Cosa manca perche' l'invio possa partire. Vuoto = pronto.
function problems(sp) {
  const p = [];
  if (!String(sp.subject || "").trim()) p.push("Manca l'oggetto dell'email.");
  if (!String(sp.intro || "").trim() && !sp.video_path && !hasArticle(sp))
    p.push("Non c'e' niente da mandare: scrivi un messaggio, carica un video o scrivi l'articolo riservato.");
  if (String(sp.article_title || "").trim() && !plain(sp.article_body))
    p.push("L'articolo riservato ha il titolo ma non il testo.");
  return p;
}

const BTN = "display:inline-block;background:#16243F;color:#ffffff;text-decoration:none;font-weight:bold;font-size:15px;padding:12px 22px;border-radius:10px";

// links: { view, unsub, prova }
function specialHtml(sp, links) {
  const parts = [];
  parts.push('<div style="font-size:24px;line-height:1.25;font-weight:bold;color:#16243F;padding:0 0 14px">' + esc(sp.subject) + "</div>");
  if (String(sp.intro || "").trim())
    parts.push('<div style="font-size:16px;line-height:1.6;color:#2A3A57">' + paragraphs(sp.intro) + "</div>");

  if (sp.video_path) {
    const img = sp.email_image_url
      ? '<a href="' + esc(links.view) + '#video" style="text-decoration:none"><img src="' + esc(sp.email_image_url) + '" alt="Guarda il video" width="536" style="width:100%;max-width:536px;border-radius:12px;display:block;margin:6px 0 12px;border:0"></a>'
      : "";
    parts.push('<div style="padding:6px 0 18px">' + img + '<a href="' + esc(links.view) + '#video" style="' + BTN + '">&#9654;&nbsp; Guarda il video</a></div>');
  }

  if (hasArticle(sp)) {
    parts.push(
      '<div style="background:#FFFFFF;border:1px solid #E3DFD6;border-radius:12px;padding:18px 18px 20px;margin:6px 0 18px">' +
      '<div style="font-size:11px;font-weight:bold;letter-spacing:.6px;color:#E8A33D;text-transform:uppercase;padding:0 0 6px">Articolo riservato</div>' +
      '<div style="font-size:20px;line-height:1.25;font-weight:bold;color:#16243F;padding:0 0 8px">' + esc(sp.article_title) + "</div>" +
      '<div style="font-size:14px;line-height:1.55;color:#2A3A57;padding:0 0 14px">' + esc(excerpt(sp.article_body, 260)) + "</div>" +
      '<a href="' + esc(links.view) + '#articolo" style="' + BTN + '">Leggi l\'articolo &rarr;</a>' +
      "</div>"
    );
  }

  const nota = links.prova
    ? "Questa &egrave; una <b>prova</b>: la vedi solo tu. Il link qui sopra funziona per la redazione; gli iscritti ricevono ciascuno il proprio."
    : "Ricevi questa email perch&eacute; ti sei iscritto su iattualita.it. I link qui sopra sono personali: se li inoltri, chi li apre usa il tuo accesso.";

  return '<!doctype html><html lang="it">' + L.emailHead(sp.subject) + '<body style="margin:0;background:#F4F2EC">'
    + '<table role="presentation" width="100%" cellpadding="0" cellspacing="0" style="background:#F4F2EC"><tr><td align="center" style="padding:26px 12px">'
    + '<table role="presentation" width="560" cellpadding="0" cellspacing="0" style="max-width:560px;width:100%">'
    + L.emailHeader("Solo per gli iscritti alla newsletter")
    + '<tr><td style="padding:0 12px;font-family:Arial,Helvetica,sans-serif">' + parts.join("") + "</td></tr>"
    + '<tr><td style="padding:14px 12px;border-top:1px solid #E3DFD6;font-family:Arial,Helvetica,sans-serif;font-size:12px;color:#7A8499;line-height:1.5">'
    + nota + "<br>"
    + '<a href="' + esc(links.unsub) + '" style="color:#7A8499">Disiscriviti</a> quando vuoi &middot; IAttualit&agrave; &middot; verificato con i dati'
    + "</td></tr></table></td></tr></table></body></html>";
}

// --- invio -------------------------------------------------------------------
async function closeSpecial(id, recipients) {
  await patchSpecial(id, { status: "sent", sent_at: new Date().toISOString(), recipients });
}

// Stesso schema del digest:
//   dry=true  -> conta soltanto
//   dry=false -> serve al massimo `limit` iscritti e dice quanti ne restano
// Ripartibile: ogni iscritto servito finisce nel registro delle consegne e
// alla chiamata successiva viene saltato.
async function runSpecial(opts) {
  const dry = !!opts.dry;
  const limit = opts.limit || L.BATCH;

  const sp = await loadSpecial(opts.id);
  if (!sp) return { notFound: true };

  const subs = await confirmedSubscribers();
  const gia = new Set(await deliveredIds(sp.id));
  const pending = subs.filter((s) => !gia.has(s.id));
  const prob = problems(sp);

  if (dry) return { dry: true, status: sp.status, recipients: subs.length, already: gia.size, remaining: pending.length, problems: prob };
  if (sp.status === "sent") return { sent: false, done: true, reason: "Questo invio speciale è già stato spedito." };
  if (prob.length) return { sent: false, done: false, reason: prob.join(" ") };
  if (subs.length === 0) return { sent: false, done: true, reason: "nessun iscritto confermato" };

  if (sp.status === "draft") await patchSpecial(sp.id, { status: "sending" });

  // Tutti gia' serviti ma lo stato non era stato chiuso: e' la coda di un
  // invio interrotto proprio sul finale.
  if (pending.length === 0) {
    await closeSpecial(sp.id, gia.size);
    return { sent: true, done: true, recipients: subs.length, delivered: 0, failed: 0, remaining: 0 };
  }

  let ok = 0, failed = 0;
  await L.inPool(pending.slice(0, limit), L.CONCURRENCY, async (s) => {
    const unsub = L.FN + "/unsubscribe?token=" + s.token;
    try {
      await L.brevoSend(s.email, sp.subject, specialHtml(sp, { view: viewUrl(sp.id, s.token), unsub }), null, null, unsub);
    } catch (e) {
      failed++;   // non registrato: resta in coda per il giro dopo
      console.warn("invio speciale, invio fallito per un iscritto:", e && e.message);
      return;
    }
    ok++;
    try { await markDelivered(sp.id, s.id); }
    catch (e) {
      // L'email e' partita ma il registro no: se l'invio riparte, a questo
      // iscritto arriverebbe una seconda copia. Lo si scrive nei log.
      console.error("invio speciale: email partita ma consegna non registrata:", e && e.message);
    }
  });

  const remaining = pending.length - ok;
  const done = remaining === 0;
  if (done) await closeSpecial(sp.id, gia.size + ok);
  return { sent: true, done, recipients: subs.length, delivered: ok, failed, remaining };
}

// Prova alla redazione: stessa email, oggetto marcato, link di anteprima.
async function sendTest(id, email) {
  const sp = await loadSpecial(id);
  if (!sp) return { notFound: true };
  const prob = problems(sp);
  if (prob.length) return { ok: false, reason: prob.join(" ") };
  if (!email) return { ok: false, reason: "Il tuo account di redazione non ha un indirizzo email." };
  await L.brevoSend(email, "[PROVA] " + sp.subject,
    specialHtml(sp, { view: previewUrl(sp.id), unsub: L.SITE_URL + "/newsletter", prova: true }));
  return { ok: true, to: email };
}

module.exports = {
  isUuid, esc, paragraphs, excerpt, plain,
  viewUrl, previewUrl, previewSig, validPreview,
  loadSpecial, signedVideoUrl, hasArticle, problems, specialHtml,
  runSpecial, sendTest
};
