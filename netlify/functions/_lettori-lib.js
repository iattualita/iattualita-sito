// netlify/functions/_lettori-lib.js
// Accesso dei lettori: codice a 6 cifre via email e sessione con cookie.
//
// Usato da accesso-codice.js, accesso-verifica.js, lettore.js e
// articolo-completo.js.
//
// PERCHE' NON SUPABASE AUTH
// Gli utenti di Supabase Auth sono la redazione, e nel database il ruolo
// "authenticated" puo' scrivere articoli e invii speciali. Un lettore
// registrato li' avrebbe gli stessi poteri. Qui il lettore e' una riga della
// tabella lettori (migrazione 005) e la sessione e' un cookie firmato con
// LETTORI_SECRET: Supabase non lo vede e non lo riconosce.
//
// PERCHE' UN CODICE E NON UN LINK
// Gran parte di chi legge arriva dal browser interno di TikTok o Instagram.
// Un link nell'email si apre nell'app di posta o in Safari/Chrome, e il
// lettore si ritrova autenticato li', non nella finestra in cui stava
// leggendo. Il codice lo digita dove si trova e continua a leggere.
const crypto = require("crypto");
const L = require("./_newsletter-lib");

const SECRET = process.env.LETTORI_SECRET || "";

// La sessione dura sei mesi e si rinnova da sola quando il lettore torna
// (vedi articolo-completo.js): chi legge spesso non deve rifare l'accesso.
const SESSIONE_GIORNI = 180;
const SESSIONE_S = SESSIONE_GIORNI * 24 * 60 * 60;
const RINNOVA_SOTTO_S = 60 * 24 * 60 * 60;

// Il codice vale 15 minuti e si puo' sbagliare 5 volte. Un milione di
// combinazioni e 5 tentativi: la probabilita' di indovinarlo a caso e' 1 su
// 200.000 per ogni codice chiesto, e le richieste di codici sono limitate.
const CODICE_VALIDO_S = 15 * 60;
const CODICE_TENTATIVI = 5;

const COOKIE_SESSIONE = "iatt_sessione";
// Secondo cookie, leggibile dal sito e senza segreti dentro: dice soltanto
// "questo browser ha fatto l'accesso". Serve a non interrogare il server a
// ogni pagina: chi non e' registrato non fa partire nessuna funzione.
const COOKIE_SEGNALE = "iatt_lettore";

const UUID = /^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/i;
const isUuid = (s) => UUID.test(String(s || ""));

// ---------- codice ----------

const nuovoCodice = () => String(crypto.randomInt(0, 1000000)).padStart(6, "0");

// Nel database finisce solo l'impronta del codice, legata all'indirizzo:
// lo stesso codice per due email diverse da' due impronte diverse.
function impronta(email, codice) {
  return crypto.createHmac("sha256", SECRET).update("codice:" + email + ":" + codice).digest("hex");
}

function confrontaImpronta(a, b) {
  const x = Buffer.from(String(a || ""), "utf8");
  const y = Buffer.from(String(b || ""), "utf8");
  return x.length === y.length && crypto.timingSafeEqual(x, y);
}

// ---------- sessione ----------

const b64url = (buf) => Buffer.from(buf).toString("base64").replace(/\+/g, "-").replace(/\//g, "_").replace(/=+$/, "");

function firma(testo) {
  return b64url(crypto.createHmac("sha256", SECRET).update("sessione:" + testo).digest());
}

// Formato: v1.<id lettore>.<scadenza in secondi>.<firma>
function creaSessione(idLettore, oraS) {
  const ora = oraS || Math.floor(Date.now() / 1000);
  const corpo = "v1." + idLettore + "." + (ora + SESSIONE_S);
  return corpo + "." + firma(corpo);
}

// Restituisce { id, exp } se il cookie e' integro e non scaduto, altrimenti null.
function leggiSessione(valore, oraS) {
  if (!SECRET) return null;
  const parti = String(valore || "").split(".");
  if (parti.length !== 4 || parti[0] !== "v1" || !isUuid(parti[1])) return null;
  const exp = Number(parti[2]);
  if (!Number.isFinite(exp)) return null;
  const attesa = firma(parti.slice(0, 3).join("."));
  if (!confrontaImpronta(attesa, parti[3])) return null;
  const ora = oraS || Math.floor(Date.now() / 1000);
  if (exp <= ora) return null;
  return { id: parti[1].toLowerCase(), exp };
}

function leggiCookie(event) {
  const h = (event && event.headers) || {};
  const raw = h.cookie || h.Cookie || "";
  const out = {};
  String(raw).split(";").forEach((p) => {
    const i = p.indexOf("=");
    if (i > 0) out[p.slice(0, i).trim()] = p.slice(i + 1).trim();
  });
  return out;
}

function sessioneDaRichiesta(event) {
  return leggiSessione(leggiCookie(event)[COOKIE_SESSIONE]);
}

// Cookie tecnici: servono solo a ricordare che hai fatto l'accesso, non
// tracciano niente e non escono dal sito. Per il Garante sono "cookie
// tecnici" e non richiedono consenso (linee guida cookie, 10 giugno 2021).
function cookieAccesso(idLettore) {
  const attr = "; Path=/; Max-Age=" + SESSIONE_S + "; Secure; SameSite=Lax";
  return [
    COOKIE_SESSIONE + "=" + creaSessione(idLettore) + attr + "; HttpOnly",
    COOKIE_SEGNALE + "=1" + attr
  ];
}

function cookieUscita() {
  const attr = "; Path=/; Max-Age=0; Secure; SameSite=Lax";
  return [COOKIE_SESSIONE + "=" + attr + "; HttpOnly", COOKIE_SEGNALE + "=" + attr];
}

// Risposta JSON con eventuali cookie. Le funzioni Netlify vogliono i
// Set-Cookie multipli in multiValueHeaders, non in headers.
function risposta(statusCode, obj, cookies) {
  const r = {
    statusCode,
    headers: {
      "Content-Type": "application/json",
      // Risposte personali: nessuna cache condivisa deve conservarle.
      "Cache-Control": "private, no-store",
      "X-Robots-Tag": "noindex"
    },
    body: JSON.stringify(obj)
  };
  if (cookies && cookies.length) r.multiValueHeaders = { "Set-Cookie": cookies };
  return r;
}

// Le azioni che cambiano qualcosa arrivano solo dal sito stesso, in JSON.
// Un modulo HTML su un altro sito non puo' mandare application/json senza
// un preflight che il browser blocca, e sec-fetch-site lo dice esplicitamente
// nei browser che lo inviano.
function richiestaDalSito(event) {
  const h = (event && event.headers) || {};
  const ct = String(h["content-type"] || h["Content-Type"] || "");
  if (ct.indexOf("application/json") !== 0) return false;
  const sfs = String(h["sec-fetch-site"] || "");
  return sfs === "" || sfs === "same-origin" || sfs === "same-site" || sfs === "none";
}

function leggiJson(event) {
  try { return JSON.parse((event && event.body) || "{}") || {}; } catch (e) { return null; }
}

// ---------- database (service_role) ----------

const REST = L.REST;
const H = (extra) => L.sbHeaders(extra);

async function codiceSalva(email, hash, newsletter) {
  const r = await fetch(REST + "/codici_accesso?on_conflict=email", {
    method: "POST",
    headers: H({ Prefer: "resolution=merge-duplicates,return=minimal" }),
    body: JSON.stringify({
      email,
      code_hash: hash,
      expires_at: new Date(Date.now() + CODICE_VALIDO_S * 1000).toISOString(),
      tentativi: 0,
      newsletter: !!newsletter,
      created_at: new Date().toISOString()
    })
  });
  if (!r.ok) throw await L.sbError("codice salva", r);
}

async function codiceLeggi(email) {
  const r = await fetch(REST + "/codici_accesso?email=eq." + encodeURIComponent(email) + "&select=email,code_hash,expires_at,tentativi,newsletter", { headers: H() });
  if (!r.ok) throw await L.sbError("codice leggi", r);
  return (await r.json())[0] || null;
}

async function codiceTentativo(email, tentativi) {
  const r = await fetch(REST + "/codici_accesso?email=eq." + encodeURIComponent(email), {
    method: "PATCH", headers: H({ Prefer: "return=minimal" }), body: JSON.stringify({ tentativi })
  });
  if (!r.ok) throw await L.sbError("codice tentativo", r);
}

async function codiceCancella(email) {
  const r = await fetch(REST + "/codici_accesso?email=eq." + encodeURIComponent(email), { method: "DELETE", headers: H({ Prefer: "return=minimal" }) });
  if (!r.ok) throw await L.sbError("codice cancella", r);
}

// Pulizia: i codici mai usati restano finche' qualcuno non li sovrascrive.
// Una volta ogni tanto si buttano quelli scaduti da piu' di un giorno.
async function codiciPulizia() {
  try {
    const prima = new Date(Date.now() - 24 * 3600 * 1000).toISOString();
    await fetch(REST + "/codici_accesso?expires_at=lt." + encodeURIComponent(prima), { method: "DELETE", headers: H({ Prefer: "return=minimal" }) });
  } catch (e) { /* non importa: ci riprova la prossima volta */ }
}

// Crea il lettore se non esiste, altrimenti aggiorna l'ultimo accesso.
async function lettoreAccesso(email) {
  const r = await fetch(REST + "/lettori?on_conflict=email&select=id,email", {
    method: "POST",
    headers: H({ Prefer: "resolution=merge-duplicates,return=representation" }),
    body: JSON.stringify({ email, last_login_at: new Date().toISOString() })
  });
  if (!r.ok) throw await L.sbError("lettore accesso", r);
  return (await r.json())[0] || null;
}

async function lettorePerId(id) {
  if (!isUuid(id)) return null;
  const r = await fetch(REST + "/lettori?id=eq." + id + "&select=id,email", { headers: H() });
  if (!r.ok) throw await L.sbError("lettore leggi", r);
  return (await r.json())[0] || null;
}

async function lettoreCancella(id) {
  const r = await fetch(REST + "/lettori?id=eq." + id, { method: "DELETE", headers: H({ Prefer: "return=minimal" }) });
  if (!r.ok) throw await L.sbError("lettore cancella", r);
}

async function articoloCompleto(id) {
  if (!isUuid(id)) return null;
  const r = await fetch(REST + "/news?id=eq." + id + "&select=id,body,summary&limit=1", { headers: H() });
  if (!r.ok) throw await L.sbError("articolo", r);
  return (await r.json())[0] || null;
}

// Iscrive alla newsletter un indirizzo GIA' verificato (il lettore ha appena
// digitato il codice ricevuto li', o ha una sessione valida). Equivale al
// click sul link del doppio opt-in, quindi l'iscrizione nasce confermata.
//
// Ritorna "iscritto" o "gia_iscritto".
async function newsletterIscrivi(email) {
  const ora = new Date().toISOString();
  const esiste = await L.sbSelectByEmail(email);
  if (esiste && esiste.status === "confirmed") return "gia_iscritto";
  if (esiste) {
    await L.sbPatch(esiste.id, { status: "confirmed", confirmed_at: ora, unsubscribed_at: null, token: esiste.token || L.newToken() });
    return "iscritto";
  }
  const r = await fetch(REST + "/subscribers", {
    method: "POST",
    headers: H({ Prefer: "return=minimal" }),
    body: JSON.stringify({ email, status: "confirmed", token: L.newToken(), confirmed_at: ora })
  });
  if (!r.ok) throw await L.sbError("newsletter iscrivi", r);
  return "iscritto";
}

async function newsletterStato(email) {
  const s = await L.sbSelectByEmail(email);
  return s && s.status === "confirmed" ? "iscritto" : "non_iscritto";
}

// ---------- email con il codice ----------

// Stesso stile spoglio della mail di conferma della newsletter: niente
// immagini ne' pulsanti, perche' sono i segnali che spingono un messaggio
// nella scheda Promozioni, dove un codice da usare subito non va visto tardi.
function emailCodiceHtml(codice) {
  return `<p>Ecco il tuo codice per entrare su IAttualità:</p>
<p style="font-size:28px;font-weight:bold;letter-spacing:6px;font-family:Arial,Helvetica,sans-serif">${codice}</p>
<p>Scrivilo nella pagina che hai aperto. Vale 15 minuti.</p>
<p>Se non sei stato tu a chiederlo, ignora questa email: senza il codice nessuno può entrare con il tuo indirizzo.</p>`;
}

module.exports = {
  config: { SECRET },
  SESSIONE_S, RINNOVA_SOTTO_S, CODICE_TENTATIVI,
  COOKIE_SESSIONE, COOKIE_SEGNALE,
  isUuid, nuovoCodice, impronta, confrontaImpronta,
  creaSessione, leggiSessione, leggiCookie, sessioneDaRichiesta,
  cookieAccesso, cookieUscita, risposta, richiestaDalSito, leggiJson,
  codiceSalva, codiceLeggi, codiceTentativo, codiceCancella, codiciPulizia,
  lettoreAccesso, lettorePerId, lettoreCancella, articoloCompleto,
  newsletterIscrivi, newsletterStato,
  emailCodiceHtml
};
