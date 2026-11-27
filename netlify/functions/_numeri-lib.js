// netlify/functions/_numeri-lib.js
// Legge i follower dalle API ufficiali e li salva nella
// tabella numeri_social (migrazione 007), da cui li prende la pagina /numeri.
//
// Usato da numeri-cron.mjs (ogni notte) e da numeri-aggiorna.js (pulsante
// "Aggiorna adesso" in redazione).
//
// PERCHE' LE API E NON LA LETTURA DELLE PAGINE DEI PROFILI
// Instagram, Facebook e TikTok bloccano i programmi che leggono le loro
// pagine e lo vietano nelle condizioni d'uso. Funzionerebbe qualche giorno e
// poi si romperebbe, con il rischio di far segnalare l'account. Le API
// ufficiali sono stabili e leggono i numeri veri dei vostri profili.
//
// VARIABILI D'AMBIENTE (Netlify)
//   YOUTUBE_API_KEY     chiave di Google Cloud con "YouTube Data API v3" attiva
//   YOUTUBE_CHANNEL     handle del canale (@iattualita) oppure id (UC...)
//   SUPABASE_SERVICE_ROLE_KEY  serve anche per Facebook e Instagram (sotto)
// Una piattaforma senza le sue variabili viene saltata, senza errori: si
// possono attivare una alla volta.
//
// FACEBOOK E INSTAGRAM (dal 27 nov 2026)
// Li legge la funzione Supabase "numeri-meta" (supabase/functions/numeri-meta)
// con il token dell'utente di sistema "agente-commenti", nel portafoglio Meta
// di Nicola dove stanno le pagine: lo stesso token degli agenti dei commenti,
// salvato solo tra i segreti di Supabase (META_COMMENTI_TOKEN). Su Netlify
// non serve piu' nessun token Meta: META_PAGE_TOKEN e META_PAGE_ID non si
// usano. Il vecchio token di "sito-iattualita" (portafoglio di Andre') ha
// perso l'accesso alla pagina il 27 nov 2026.
const L = require("./_newsletter-lib");

const env = (k) => String(process.env[k] || "").trim();
const FUNZIONE_META = L.REST.replace(/\/rest\/v1$/, "/functions/v1/numeri-meta");

async function getJson(url, opt) {
  const r = await fetch(url, opt);
  let d = null;
  try { d = await r.json(); } catch (e) {}
  if (!r.ok || (d && d.error)) {
    const e = d && d.error;
    const m = (typeof e === "string" ? e : e && (e.message || e.code)) || ("HTTP " + r.status);
    throw new Error(String(m).slice(0, 200));
  }
  return d;
}

const numero = (x) => {
  const n = Number(x);
  return Number.isFinite(n) && n >= 0 ? Math.round(n) : null;
};

// ---------- YouTube ----------
async function leggiYoutube() {
  const key = env("YOUTUBE_API_KEY"), canale = env("YOUTUBE_CHANNEL");
  if (!key || !canale) return null;
  const filtro = canale.startsWith("UC") ? "id=" + encodeURIComponent(canale) : "forHandle=" + encodeURIComponent(canale.replace(/^@?/, "@"));
  const d = await getJson("https://www.googleapis.com/youtube/v3/channels?part=statistics&" + filtro + "&key=" + encodeURIComponent(key));
  const s = d && d.items && d.items[0] && d.items[0].statistics;
  if (!s) throw new Error("canale YouTube non trovato: controlla YOUTUBE_CHANNEL");
  return {
    // YouTube nasconde il numero esatto di iscritti se il canale lo ha
    // scelto: in quel caso hiddenSubscriberCount e' true e il numero manca.
    follower: s.hiddenSubscriberCount ? null : numero(s.subscriberCount),
    // Le visualizzazioni totali di YouTube non si mostrano: scelta della
    // redazione (29 ott 2026). Sulla pagina restano solo gli iscritti.
    visualizzazioni: null,
    periodo: null
  };
}

// ---------- Facebook e Instagram ----------
// Una sola chiamata a numeri-meta per giro, condivisa dalle due piattaforme.
// aggiornaTutto la azzera a ogni giro, cosi' un nuovo "Aggiorna adesso"
// rilegge sempre i numeri freschi.
let giroMeta = null;
function leggiMeta() {
  if (!L.config.SERVICE_ROLE) return Promise.resolve(null);
  if (!giroMeta) giroMeta = getJson(FUNZIONE_META, { method: "POST", headers: L.sbHeaders(), body: "{}" });
  return giroMeta;
}

async function leggiFacebook() {
  const m = await leggiMeta();
  if (!m) return null;
  return { follower: numero(m.facebook && m.facebook.follower), visualizzazioni: null, periodo: null };
}

async function leggiInstagram() {
  const m = await leggiMeta();
  if (!m) return null;
  if (!m.instagram) throw new Error(m.errore_instagram || "account Instagram non trovato");
  return {
    follower: numero(m.instagram.follower),
    // Le visualizzazioni di Instagram non si mostrano: scelta della
    // redazione (14 nov 2026), come per YouTube. Restano solo i follower,
    // e il valore null cancella dalla pagina il numero letto in precedenza.
    visualizzazioni: null,
    periodo: null
  };
}

const LETTORI = { youtube: leggiYoutube, instagram: leggiInstagram, facebook: leggiFacebook };

async function salva(piattaforma, campi) {
  const r = await fetch(L.REST + "/numeri_social?piattaforma=eq." + piattaforma, {
    method: "PATCH",
    headers: L.sbHeaders({ Prefer: "return=minimal" }),
    body: JSON.stringify(campi)
  });
  if (!r.ok) throw await L.sbError("numeri salva", r);
}

// Legge tutte le piattaforme configurate e salva. Un errore su una non
// ferma le altre, e non cancella i numeri vecchi: si registra solo l'errore,
// cosi' la pagina continua a mostrare l'ultimo dato buono con la sua data.
async function aggiornaTutto() {
  giroMeta = null;
  const esito = {};
  for (const [nome, leggi] of Object.entries(LETTORI)) {
    try {
      const n = await leggi();
      if (!n) { esito[nome] = "non configurato"; continue; }
      const campi = { fonte: "automatico", aggiornato_at: new Date().toISOString(), errore: n.avviso || null };
      if (n.follower != null) campi.follower = n.follower;
      // Le visualizzazioni si scrivono sempre, anche vuote: se una
      // piattaforma smette di fornirle (o si decide di non mostrarle) il
      // numero vecchio non deve restare sulla pagina senza aggiornarsi.
      campi.visualizzazioni = n.visualizzazioni != null ? n.visualizzazioni : null;
      campi.periodo = n.visualizzazioni != null ? n.periodo : null;
      await salva(nome, campi);
      esito[nome] = "ok" + (n.avviso ? " (" + n.avviso + ")" : "");
    } catch (e) {
      esito[nome] = "errore: " + e.message;
      try { await salva(nome, { errore: String(e.message).slice(0, 300) }); } catch (e2) {}
    }
  }
  return esito;
}

module.exports = { aggiornaTutto, leggiYoutube, leggiInstagram, leggiFacebook };
