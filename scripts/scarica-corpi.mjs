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
const CHIAVE = "sb_publishable_I3s4phA5Be9qnV4pLbWQMQ_8-IGUE-b"; // chiave pubblica, la stessa del sito

const r = await fetch(URL_SB, { headers: { apikey: CHIAVE } });
if (!r.ok) {
  console.error("Supabase ha risposto " + r.status + ": impossibile scaricare i corpi.");
  process.exit(1);
}
const corpi = (await r.json()).map((x) => x.body).filter(Boolean);
fs.mkdirSync("test/fixtures", { recursive: true });
fs.writeFileSync("test/fixtures/corpi-articoli.json", JSON.stringify(corpi));
console.log("Salvati " + corpi.length + " corpi in test/fixtures/corpi-articoli.json");
