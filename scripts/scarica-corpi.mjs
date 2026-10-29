// Scarica il corpo degli articoli pubblicati e lo salva come materiale di
// prova per test/sanitize.test.mjs, che verifica due cose insieme: che la
// sanificazione fermi le iniezioni, e che non rovini la formattazione degli
// articoli veri.
//
// Il file non sta nel repo: pesa oltre un mega e, con publish = ".", finirebbe
// pubblicato sul sito. Si rigenera quando serve con "npm run fixtures"; senza,
// il test salta semplicemente quella parte.
import fs from "node:fs";

const URL_SB = "https://wzkshpgakvasqwrrgkgd.supabase.co/rest/v1/news?select=body&limit=500";
// Dalla migrazione 006 il testo degli articoli non e' piu' leggibile con la
// chiave pubblica: serve quella di servizio, passata solo da riga di comando
// e mai scritta nel repository:
//   SUPABASE_SERVICE_ROLE_KEY=... npm run fixtures
const CHIAVE = process.env.SUPABASE_SERVICE_ROLE_KEY || "";
if (!CHIAVE) {
  console.error("Manca SUPABASE_SERVICE_ROLE_KEY: il testo degli articoli e' riservato (migrazione 006).");
  process.exit(1);
}

const h = { apikey: CHIAVE };
if (CHIAVE.indexOf("eyJ") === 0) h.Authorization = "Bearer " + CHIAVE;
const r = await fetch(URL_SB, { headers: h });
if (!r.ok) {
  console.error("Supabase ha risposto " + r.status + ": impossibile scaricare i corpi.");
  process.exit(1);
}
const corpi = (await r.json()).map((x) => x.body).filter(Boolean);
fs.mkdirSync("test/fixtures", { recursive: true });
fs.writeFileSync("test/fixtures/corpi-articoli.json", JSON.stringify(corpi));
console.log("Salvati " + corpi.length + " corpi in test/fixtures/corpi-articoli.json");
