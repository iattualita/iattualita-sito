// shared/anteprima.js
//
// Come si taglia l'anteprima di un articolo. Usato dal sito (app.jsx) e dal
// prerender: devono produrre esattamente lo stesso testo, altrimenti quando
// React prende il posto dell'HTML pre-renderizzato la pagina cambia sotto gli
// occhi del lettore (e Google misura il salto come layout shift).
//
// Il testo arriva gia' accorciato dal database (colonna news.anteprima,
// migrazione 005: un terzo dell'articolo, al massimo 600 caratteri). Qui si
// sistema solo la fine: si chiude sull'ultima frase intera se ne resta
// abbastanza, altrimenti sull'ultima parola con i puntini.

export function paragrafiAnteprima(testo) {
  let t = String(testo || "").replace(/\r/g, "").replace(/[ \t]+/g, " ").trim();
  if (!t) return [];

  const fineFrase = Math.max(t.lastIndexOf(". "), t.lastIndexOf("! "), t.lastIndexOf("? "), t.lastIndexOf(".\n"));
  if (/[.!?]$/.test(t)) {
    // finisce gia' con una frase intera
  } else if (fineFrase >= t.length * 0.5) {
    t = t.slice(0, fineFrase + 1);
  } else {
    const spazio = t.lastIndexOf(" ");
    t = (spazio > t.length * 0.5 ? t.slice(0, spazio) : t).replace(/[,;:\-–—\s]+$/, "") + "…";
  }

  return t.split(/\n+/).map((p) => p.trim()).filter(Boolean);
}
