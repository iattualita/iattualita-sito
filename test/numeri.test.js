// Lettura automatica dei numeri social (_numeri-lib.js) con API finte.
process.env.SUPABASE_SERVICE_ROLE_KEY = "sb_secret_prova";
process.env.YOUTUBE_API_KEY = "yt-key";
process.env.YOUTUBE_CHANNEL = "@iattualita";

const path = require("path");
let salvati, metaRotto, igMancante, youtubeRotto, chiamate, intestazioniMeta;
const risp = (status, data) => ({ ok: status < 300, status, json: async () => data, text: async () => JSON.stringify(data) });
global.fetch = async (url, opt = {}) => {
  const u = String(url);
  chiamate.push(u);
  if (u.includes("/numeri_social")) { const p = u.match(/piattaforma=eq\.(\w+)/)[1]; salvati[p] = { ...(salvati[p] || {}), ...JSON.parse(opt.body) }; return risp(204, null); }
  if (u.includes("googleapis.com/youtube")) {
    if (youtubeRotto) return risp(403, { error: { message: "API key not valid" } });
    return risp(200, { items: [{ statistics: { subscriberCount: "1700", viewCount: "2500000", hiddenSubscriberCount: false } }] });
  }
  if (u.endsWith("/functions/v1/numeri-meta")) {
    intestazioniMeta = opt.headers || {};
    if (metaRotto) return risp(502, { error: "Error validating access token" });
    return risp(200, { pagina: "IAttualità", facebook: { follower: 13066 },
      ...(igMancante ? { instagram: null, errore_instagram: "la pagina non risulta collegata a un account Instagram" } : { instagram: { follower: 38652, username: "ia.ttualita" } }) });
  }
  throw new Error("chiamata inattesa " + u);
};
const N = require(path.join(__dirname, "..", "netlify", "functions", "_numeri-lib.js"));

const risultati = [];
function check(nome, cond, extra) {
  risultati.push(cond);
  console.log((cond ? "  PASS  " : "> FAIL <") + nome);
  if (!cond && extra !== undefined) console.log("          " + JSON.stringify(extra).slice(0, 400));
}

(async () => {
  salvati = {}; chiamate = []; metaRotto = false; igMancante = false; youtubeRotto = false;
  let e = await N.aggiornaTutto();
  check("tutto configurato: tre piattaforme ok", e.youtube === "ok" && e.instagram === "ok" && e.facebook === "ok", e);
  check("YouTube: solo iscritti, visualizzazioni non mostrate", salvati.youtube.follower === 1700 && salvati.youtube.visualizzazioni === null && salvati.youtube.periodo === null, salvati.youtube);
  check("YouTube cercato per handle", chiamate.some((u) => u.includes("forHandle=%40iattualita")));
  check("Instagram: solo follower, visualizzazioni non mostrate", salvati.instagram.follower === 38652 && salvati.instagram.visualizzazioni === null && salvati.instagram.periodo === null, salvati.instagram);
  check("Facebook: follower", salvati.facebook.follower === 13066, salvati.facebook);
  check("Facebook e Instagram: una sola chiamata alla funzione Supabase", chiamate.filter((u) => u.includes("/functions/v1/numeri-meta")).length === 1, chiamate);
  check("  ^ con la chiave di servizio", intestazioniMeta.apikey === "sb_secret_prova", intestazioniMeta);
  check("  ^ e il sito non chiama Meta direttamente", !chiamate.some((u) => u.includes("graph.facebook.com")));
  check("data e fonte registrate", salvati.facebook.fonte === "automatico" && !!salvati.facebook.aggiornato_at);
  check("TikTok non viene toccato (si aggiorna a mano)", !salvati.tiktok);

  chiamate = [];
  await N.aggiornaTutto();
  check("ogni giro rilegge i numeri (niente risposta vecchia in memoria)", chiamate.filter((u) => u.includes("/functions/v1/numeri-meta")).length === 1, chiamate);

  salvati = { youtube: { follower: 1500 }, facebook: { follower: 16000 }, instagram: { follower: 44000 } }; chiamate = []; metaRotto = true; youtubeRotto = true;
  e = await N.aggiornaTutto();
  check("YouTube in errore: il numero vecchio resta, si registra l'errore", salvati.youtube.follower === 1500 && /API key not valid/.test(salvati.youtube.errore), salvati.youtube);
  check("Meta in errore: i numeri vecchi restano, si registra l'errore", salvati.facebook.follower === 16000 && salvati.instagram.follower === 44000 && /validating access token/.test(salvati.facebook.errore) && /validating access token/.test(salvati.instagram.errore), salvati);

  salvati = {}; metaRotto = false; igMancante = true; youtubeRotto = false;
  e = await N.aggiornaTutto();
  check("Instagram non trovato: errore chiaro, Facebook si aggiorna lo stesso", /collegata a un account Instagram/.test(salvati.instagram.errore) && salvati.instagram.follower === undefined && salvati.facebook.follower === 13066, salvati);
  igMancante = false;

  delete process.env.YOUTUBE_API_KEY;
  salvati = {};
  e = await N.aggiornaTutto();
  check("piattaforma senza chiavi: saltata senza errori", e.youtube === "non configurato" && !salvati.youtube, e);

  console.log("\n" + risultati.length + " controlli, " + risultati.filter((x) => !x).length + " falliti");
  if (risultati.some((x) => !x)) process.exit(1);
})();
