// netlify/functions/_numeri-lib.js
// Legge follower e visualizzazioni dalle API ufficiali e li salva nella
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
//   META_PAGE_ID        id della pagina Facebook
//   META_PAGE_TOKEN     token di accesso della pagina (permanente)
//   META_IG_USER_ID     facoltativo: se manca si ricava dalla pagina
//   META_GRAPH_VERSION  facoltativo, default v26.0
// Una piattaforma senza le sue variabili viene saltata, senza errori: si
// possono attivare una alla volta.
const L = require("./_newsletter-lib");

const GRAPH = "https://graph.facebook.com/" + (process.env.META_GRAPH_VERSION || "v26.0");
const env = (k) => String(process.env[k] || "").trim();

async function getJson(url) {
  const r = await fetch(url);
  let d = null;
  try { d = await r.json(); } catch (e) {}
  if (!r.ok || (d && d.error)) {
    const m = (d && d.error && (d.error.message || d.error.code)) || ("HTTP " + r.status);
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

// ---------- Facebook ----------
async function leggiFacebook() {
  const pagina = env("META_PAGE_ID"), token = env("META_PAGE_TOKEN");
  if (!pagina || !token) return null;
  const d = await getJson(GRAPH + "/" + encodeURIComponent(pagina) + "?fields=followers_count,fan_count&access_token=" + encodeURIComponent(token));
  return { follower: numero(d.followers_count != null ? d.followers_count : d.fan_count), visualizzazioni: null, periodo: null };
}

// ---------- Instagram ----------
async function idInstagram(pagina, token) {
  const id = env("META_IG_USER_ID");
  if (id) return id;
  const d = await getJson(GRAPH + "/" + encodeURIComponent(pagina) + "?fields=instagram_business_account&access_token=" + encodeURIComponent(token));
  if (!d.instagram_business_account || !d.instagram_business_account.id)
    throw new Error("la pagina Facebook non risulta collegata a un account Instagram professionale");
  return d.instagram_business_account.id;
}

async function leggiInstagram() {
  const pagina = env("META_PAGE_ID"), token = env("META_PAGE_TOKEN");
  if (!pagina || !token) return null;
  const ig = await idInstagram(pagina, token);
  const t = encodeURIComponent(token);
  const d = await getJson(GRAPH + "/" + ig + "?fields=followers_count&access_token=" + t);
  const out = { follower: numero(d.followers_count), visualizzazioni: null, periodo: null };

  // Visualizzazioni degli ultimi 30 giorni. Se Meta rifiuta (permesso
  // insights mancante, metrica rinominata) si tengono comunque i follower.
  try {
    const fine = Math.floor(Date.now() / 1000);
    const inizio = fine - 30 * 86400;
    const v = await getJson(GRAPH + "/" + ig + "/insights?metric=views&period=day&metric_type=total_value&since=" + inizio + "&until=" + fine + "&access_token=" + t);
    const voce = (v.data || []).find((x) => x.name === "views");
    const tot = voce && voce.total_value ? numero(voce.total_value.value) : null;
    if (tot != null) { out.visualizzazioni = tot; out.periodo = "ultimi 30 giorni"; }
  } catch (e) {
    out.avviso = "visualizzazioni non lette: " + e.message;
  }
  return out;
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
