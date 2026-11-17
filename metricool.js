// Statistiche del sito su Metricool, accanto a Umami: cosi' le visite al sito
// stanno nello stesso pannello dei social e si vede quanto traffico porta
// ogni reel. Metricool dichiara che questo tracker non usa cookie (misura la
// visita e ricava il paese dall'IP), quindi non serve il banner.
//
// E' il codice fornito da Metricool (Connessioni > Collega sito web), messo in
// un file invece che inline perche' la Content-Security-Policy in _headers
// blocca gli script inline. L'hash identifica il brand "iattualita".
(function () {
  var s = document.createElement("script");
  s.src = "https://tracker.metricool.com/resources/be.js";
  s.async = true;
  s.onload = function () {
    try { window.beTracker.t({ hash: "e82699f60a7b5501670f3504bb2f2bf7" }); } catch (e) {}
  };
  document.head.appendChild(s);
})();
