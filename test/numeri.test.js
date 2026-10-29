// Lettura automatica dei numeri social (_numeri-lib.js) con API finte.
process.env.SUPABASE_SERVICE_ROLE_KEY = "sb_secret_prova";
process.env.YOUTUBE_API_KEY = "yt-key";
process.env.YOUTUBE_CHANNEL = "@iattualita";
process.env.META_PAGE_ID = "123";
process.env.META_PAGE_TOKEN = "page-token";

const path = require("path");
let salvati, insightsRotto, youtubeRotto, chiamate;
const risp = (status, data) => ({ ok: status < 300, status, json: async () => data, text: async () => JSON.stringify(data) });
global.fetch = async (url, opt = {}) => {
  const u = String(url);
  chiamate.push(u);
  if (u.includes("/numeri_social")) { const p = u.match(/piattaforma=eq\.(\w+)/)[1]; salvati[p] = { ...(salvati[p] || {}), ...JSON.parse(opt.body) }; return risp(204, null); }
  if (u.includes("googleapis.com/youtube")) {
    if (youtubeRotto) return risp(403, { error: { message: "API key not valid" } });
    return risp(200, { items: [{ statistics: { subscriberCount: "1700", viewCount: "2500000", hiddenSubscriberCount: false } }] });
  }
  if (u.includes("/123?fields=instagram_business_account")) return risp(200, { instagram_business_account: { id: "1784" } });
  if (u.includes("/123?fields=followers_count")) return risp(200, { followers_count: 13066 });
  if (u.includes("/1784/insights")) return insightsRotto ? risp(400, { error: { message: "permission" } }) : risp(200, { data: [{ name: "views", total_value: { value: 1600000 } }] });
  if (u.includes("/1784?fields=followers_count")) return risp(200, { followers_count: 38652 });
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
  salvati = {}; chiamate = []; insightsRotto = false; youtubeRotto = false;
  let e = await N.aggiornaTutto();
  check("tutto configurato: tre piattaforme ok", e.youtube === "ok" && e.instagram === "ok" && e.facebook === "ok", e);
  check("YouTube: solo iscritti, visualizzazioni non mostrate", salvati.youtube.follower === 1700 && salvati.youtube.visualizzazioni === null && salvati.youtube.periodo === null, salvati.youtube);
  check("YouTube cercato per handle", chiamate.some((u) => u.includes("forHandle=%40iattualita")));
  check("Instagram: follower e visualizzazioni 30 giorni", salvati.instagram.follower === 38652 && salvati.instagram.visualizzazioni === 1600000 && salvati.instagram.periodo === "ultimi 30 giorni", salvati.instagram);
  check("Facebook: follower", salvati.facebook.follower === 13066, salvati.facebook);
  check("data e fonte registrate", salvati.facebook.fonte === "automatico" && !!salvati.facebook.aggiornato_at);
  check("TikTok non viene toccato (si aggiorna a mano)", !salvati.tiktok);

  salvati = { youtube: { follower: 1500 } }; chiamate = []; insightsRotto = true; youtubeRotto = true;
  e = await N.aggiornaTutto();
  check("YouTube in errore: il numero vecchio resta, si registra l'errore", salvati.youtube.follower === 1500 && /API key not valid/.test(salvati.youtube.errore), salvati.youtube);
  check("  ^ e le altre piattaforme si aggiornano lo stesso", salvati.facebook.follower === 13066);
  check("insights Instagram rifiutati: i follower si salvano comunque", salvati.instagram.follower === 38652 && salvati.instagram.visualizzazioni === null && /visualizzazioni non lette/.test(salvati.instagram.errore), salvati.instagram);

  delete process.env.YOUTUBE_API_KEY;
  salvati = {}; youtubeRotto = false;
  e = await N.aggiornaTutto();
  check("piattaforma senza chiavi: saltata senza errori", e.youtube === "non configurato" && !salvati.youtube, e);

  console.log("\n" + risultati.length + " controlli, " + risultati.filter((x) => !x).length + " falliti");
  if (risultati.some((x) => !x)) process.exit(1);
})();
