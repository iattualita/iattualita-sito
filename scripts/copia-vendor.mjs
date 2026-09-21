// Copia React e ReactDOM da node_modules a vendor/, da dove li serve il sito.
//
// Prima arrivavano da cdnjs. Funzionava, ma significava che il sito non
// partiva affatto se cdnjs era irraggiungibile o bloccato, che ogni lettore
// faceva una connessione in piu' verso un dominio terzo, e che quel dominio
// vedeva il traffico di chi legge. I file sono identici: verificato che
// l'hash SHA-256 dei pacchetti npm coincida con quello servito da cdnjs.
//
// La versione e' fissata in package.json, quindi cambia solo quando la
// cambi tu. Gira dentro "npm run build": i file in vendor/ non possono
// restare indietro rispetto alla versione dichiarata.
import fs from "node:fs";

const FILE = [
  ["node_modules/react/umd/react.production.min.js", "vendor/react.production.min.js"],
  ["node_modules/react-dom/umd/react-dom.production.min.js", "vendor/react-dom.production.min.js"]
];

fs.mkdirSync("vendor", { recursive: true });
for (const [da, a] of FILE) {
  if (!fs.existsSync(da)) {
    console.error("Manca " + da + ": esegui prima 'npm install'.");
    process.exit(1);
  }
  fs.copyFileSync(da, a);
  console.log("vendor <- " + da + " (" + Math.round(fs.statSync(a).size / 1024) + " kB)");
}
