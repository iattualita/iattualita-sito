// netlify/functions/riservato.mjs
// La pagina che un iscritto apre dall'email di un invio speciale.
//
//   ?id=<invio>&t=<token iscritto>   -> link personale dell'iscritto
//   ?id=<invio>&p=<firma>            -> anteprima della redazione (invio di prova)
//
// Mostra il messaggio, il video e l'articolo riservato solo se il token
// appartiene a un iscritto confermato. Chi si e' disiscritto perde
// l'accesso anche agli invii che aveva gia' ricevuto.
//
// Il video sta in un bucket privato: qui si genera un link che scade dopo
// qualche ora. Nessun indirizzo permanente del file esce mai dal server.
//
// La pagina e' costruita qui, sul server, e non nell'app React: cosi' non
// passa dal prerender, non finisce in nessuna sitemap e non carica script.
import L from "./_newsletter-lib.js";
import S from "./_speciali-lib.js";
import { safeBody } from "../../shared/safe-body.js";

const SUPA = L.SUPABASE_URL;
const HEADERS = {
  "Content-Type": "text/html; charset=utf-8",
  // Il link contiene il token personale: niente cache condivise, niente
  // indicizzazione, niente referrer verso i siti esterni.
  "Cache-Control": "private, no-store",
  "X-Robots-Tag": "noindex, nofollow",
  "Referrer-Policy": "no-referrer",
  "Content-Security-Policy":
"default-src 'none'; img-src " + SUPA + " " + L.SITE_URL + " data:; media-src " + SUPA + "; " +
    "style-src 'unsafe-inline' https://fonts.googleapis.com; font-src https://fonts.gstatic.com; " +
    "base-uri 'none'; form-action 'self'; frame-ancestors 'none'"
};

const esc = S.esc;

function shell(title, inner) {
  return `<!doctype html><html lang="it"><head><meta charset="utf-8">
<meta name="viewport" content="width=device-width, initial-scale=1">
<meta name="robots" content="noindex, nofollow">
<title>${esc(title)} · IAttualità</title>
<link rel="stylesheet" href="https://fonts.googleapis.com/css2?family=Anton&family=Barlow:wght@400;600;700&display=swap">
<style>
  body{margin:0;background:#F4F2EC;font-family:Barlow,Arial,sans-serif;color:#16243F}
  .wrap{max-width:720px;margin:0 auto;padding:28px 16px 56px}
  .brand{display:flex;align-items:center;gap:12px;text-decoration:none}
  .brand img{width:48px;height:48px;border-radius:50%;display:block}
  .marchio{font-family:Anton,Impact,Arial,sans-serif;font-size:30px;line-height:1;color:#16243F;letter-spacing:.3px}
  .marchio b{font-weight:400;color:${L.BLU_IA}}
  .motto{font-size:11.5px;color:#7A8499;margin-top:4px}
  .tag{display:inline-block;background:#E8A33D;color:#16243F;font-size:12px;font-weight:700;letter-spacing:.5px;text-transform:uppercase;padding:4px 10px;border-radius:6px;margin:18px 0 12px}
  h1{font-family:Anton,Arial,sans-serif;font-weight:400;font-size:clamp(28px,6vw,40px);line-height:1.1;margin:0 0 16px}
  h2{font-family:Anton,Arial,sans-serif;font-weight:400;font-size:clamp(24px,5vw,32px);line-height:1.15;margin:0 0 14px}
  .intro{font-size:18px;line-height:1.6;color:#2A3A57}
  .intro a,.corpo a{color:#2C5AA0}
  video{width:100%;max-height:80vh;background:#0E1117;border-radius:14px;display:block;margin:8px 0 28px}
  .card{background:#fff;border:1px solid #E3DFD6;border-radius:16px;padding:22px 20px 26px;margin:10px 0 24px}
  .corpo{font-size:18px;line-height:1.7;color:#16243F}
  .corpo img{max-width:100%;height:auto;border-radius:10px}
  .avviso{background:#fff;border:1px solid #E3DFD6;border-radius:14px;padding:16px 18px;color:#2A3A57;margin:0 0 22px}
  .btn{display:inline-block;background:#16243F;color:#fff;text-decoration:none;font-weight:700;padding:12px 22px;border-radius:11px}
  .piede{margin-top:34px;padding-top:16px;border-top:1px solid #E3DFD6;font-size:13px;color:#7A8499}
  .piede a{color:#2C5AA0}
</style></head>
<body><div class="wrap">
<a class="brand" href="${L.SITE_URL}"><img src="${L.LOGO_URL}" alt=""><span><span class="marchio"><b>IA</b>ttualità</span><span class="motto" style="display:block">L'informazione intelligente e in tempo reale</span></span></a>
${inner}
</div></body></html>`;
}

function blocco(status, title, msg, cta) {
  const btn = cta ? `<p style="margin-top:22px"><a class="btn" href="${esc(cta.url)}">${esc(cta.label)}</a></p>` : "";
  return new Response(shell(title, `<h1 style="margin-top:22px">${esc(title)}</h1><p class="intro">${msg}</p>${btn}`), { status, headers: HEADERS });
}

const ISCRIVITI = { url: L.SITE_URL + "/newsletter", label: "Iscriviti alla newsletter" };

export default async (req) => {
  const q = new URL(req.url).searchParams;
  const id = q.get("id") || "";
  const t = q.get("t") || "";
  const p = q.get("p") || "";

  if (!S.isUuid(id)) return blocco(404, "Link non valido", "Questo indirizzo non corrisponde a nessun contenuto. Aprilo direttamente dall'email che hai ricevuto.");

  try {
    const sp = await S.loadSpecial(id);
    if (!sp) return blocco(404, "Contenuto non trovato", "Questo contenuto non esiste più.");

    let anteprima = false;
    if (p) {
      anteprima = S.validPreview(id, p);
      if (!anteprima) return blocco(403, "Link non valido", "Il link di anteprima non è corretto.");
    } else {
      const sub = t ? await L.sbSelectByToken(t) : null;
      if (!sub)
        return blocco(403, "Contenuto riservato agli iscritti", "Questo contenuto è riservato agli iscritti alla newsletter di IAttualità.", ISCRIVITI);
      if (sub.status !== "confirmed")
        return blocco(403, "Contenuto riservato agli iscritti",
          sub.status === "unsubscribed"
            ? "Ti sei disiscritto dalla newsletter, quindi questo contenuto non è più disponibile per te. Puoi iscriverti di nuovo quando vuoi."
            : "La tua iscrizione non è ancora confermata: apri l'email di conferma che ti abbiamo mandato e poi torna qui.",
          ISCRIVITI);
      // Una bozza non e' ancora stata spedita: nessun iscritto dovrebbe
      // avere questo link.
      if (sp.status === "draft") return blocco(404, "Contenuto non ancora disponibile", "Questo contenuto non è ancora stato pubblicato.");
    }

    let video = "";
    if (sp.video_path) {
      try {
        const src = await S.signedVideoUrl(sp.video_path);
        const poster = sp.cover_url ? ` poster="${esc(sp.cover_url)}"` : "";
        video = `<video id="video" controls playsinline preload="metadata"${poster} src="${esc(src)}"></video>`;
      } catch (e) {
        console.error("riservato: link video non generato:", e && e.message);
        video = `<div id="video" class="avviso">Il video non è disponibile in questo momento. Riprova tra qualche minuto riaprendo il link dall'email.</div>`;
      }
    }

    const articolo = S.hasArticle(sp)
      ? `<div id="articolo" class="card"><div class="tag" style="margin-top:0">Articolo riservato</div>
<h2>${esc(sp.article_title)}</h2><div class="corpo">${safeBody(sp.article_body)}</div></div>`
      : "";

    const avvisoProva = anteprima
      ? `<div class="avviso" style="border-color:#E8A33D"><b>Anteprima della redazione.</b> Gli iscritti vedono questa stessa pagina dal proprio link personale.</div>`
      : "";

    const inner = `${avvisoProva}<div class="tag">Solo per gli iscritti</div>
<h1>${esc(sp.subject)}</h1>
${String(sp.intro || "").trim() ? `<div class="intro">${S.paragraphs(sp.intro)}</div>` : ""}
${video}
${articolo}
<div class="piede">Questo contenuto è riservato agli iscritti alla newsletter: per favore non inoltrare il link.<br>
<a href="${L.SITE_URL}">Torna su iattualita.it</a></div>`;

    return new Response(shell(sp.subject || "Contenuto riservato", inner), { status: 200, headers: HEADERS });
  } catch (e) {
    console.error("riservato:", e && e.message);
    return blocco(500, "Qualcosa è andato storto", "Riprova tra poco riaprendo il link dall'email.");
  }
};
