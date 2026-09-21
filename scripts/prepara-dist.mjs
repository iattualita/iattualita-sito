// Raccoglie in dist/ i soli file che devono finire online.
//
// Prima Netlify pubblicava la radice del repository. Funzionava, ma
// significava mettere in rete anche node_modules (verificato: esbuild e
// React erano scaricabili), package-lock.json, i test, le migrazioni SQL e
// il sorgente app.jsx. Nessuno di questi e' segreto, ma non c'entra niente
// con il sito e gonfia ogni deploy.
//
// L'elenco e' esplicito di proposito: un file nuovo non finisce online per
// sbaglio, e se ne aggiungi uno che serve va aggiunto qui. Lo script fallisce
// se un file dichiarato non esiste, cosi' un refuso ferma il deploy invece di
// pubblicare un sito rotto.
import fs from "node:fs";
import path from "node:path";

const DA_PUBBLICARE = [
  "index.html",
  "app.js",
  "_headers",
  "robots.txt",
  "llms.txt",
  "favicon.ico",
  "favicon-192.png",
  "apple-touch-icon.png",
  "og-default.jpg",
  "vendor" // cartella intera: React e ReactDOM
];

const DIST = "dist";
fs.rmSync(DIST, { recursive: true, force: true });
fs.mkdirSync(DIST, { recursive: true });

let mancanti = [];
for (const voce of DA_PUBBLICARE) {
  if (!fs.existsSync(voce)) {
    mancanti.push(voce);
    continue;
  }
  const dest = path.join(DIST, voce);
  if (fs.statSync(voce).isDirectory()) {
    fs.cpSync(voce, dest, { recursive: true });
  } else {
    fs.copyFileSync(voce, dest);
  }
}

if (mancanti.length) {
  console.error("Mancano questi file, il deploy si ferma: " + mancanti.join(", "));
  process.exit(1);
}

const conta = (d) =>
  fs.readdirSync(d, { withFileTypes: true }).reduce((n, v) => n + (v.isDirectory() ? conta(path.join(d, v.name)) : 1), 0);
console.log("dist/ pronta: " + conta(DIST) + " file");
