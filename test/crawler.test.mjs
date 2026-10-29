// Riconoscimento dei crawler (shared/crawler.js) e taglio dell'anteprima
// (shared/anteprima.js). Il primo decide chi riceve il testo integrale
// senza account: un errore qui regala gli articoli o li toglie a Google.
import { parseIp, inCidr, prefissiDaLista, crawlerVerificato, _svuotaCache } from "../shared/crawler.js";
import { paragrafiAnteprima } from "../shared/anteprima.js";

const risultati = [];
function check(nome, cond, extra) {
  risultati.push(cond);
  console.log((cond ? "  PASS  " : "> FAIL <") + nome);
  if (!cond && extra !== undefined) console.log("          " + JSON.stringify(extra, (k, v) => (typeof v === "bigint" ? v.toString() : v)));
}

// ---- indirizzi ----
check("IPv4 dentro /27", inCidr(parseIp("66.249.64.31"), "66.249.64.0/27"));
check("IPv4 appena fuori /27", !inCidr(parseIp("66.249.64.32"), "66.249.64.0/27"));
check("IPv6 compresso dentro /64", inCidr(parseIp("2001:4860:4801:10::1"), "2001:4860:4801:10::/64"));
check("IPv6 fuori /64", !inCidr(parseIp("2001:4860:4801:11::1"), "2001:4860:4801:10::/64"));
check("IPv6 scritto per intero", inCidr(parseIp("2001:4860:4801:0010:0000:0000:0000:0001"), "2001:4860:4801:10::/64"));
check("IPv4 travestito da IPv6 (::ffff:) trattato come IPv4", inCidr(parseIp("::ffff:66.249.64.5"), "66.249.64.0/27"));
check("famiglie diverse non si confondono", !inCidr(parseIp("::1"), "0.0.0.0/0"));
check("indirizzi malformati respinti",
  ["", "1.2.3", "1.2.3.256", "1.2.3.4.5", "2001:::1", "1:2:3:4:5:6:7:8:9", "abc", "1.2.3.a"].every((x) => parseIp(x) === null),
  ["", "1.2.3", "1.2.3.256", "1.2.3.4.5", "2001:::1", "1:2:3:4:5:6:7:8:9", "abc", "1.2.3.a"].map(parseIp));
check("prefisso /0 e /32", inCidr(parseIp("8.8.8.8"), "0.0.0.0/0") && inCidr(parseIp("8.8.8.8"), "8.8.8.8/32") && !inCidr(parseIp("8.8.8.9"), "8.8.8.8/32"));
check("lista nel formato di Google", prefissiDaLista({ creationTime: "x", prefixes: [{ ipv6Prefix: "2001:4860::/32" }, { ipv4Prefix: "66.249.64.0/27" }, {}] }).length === 2);

// ---- crawler ----
const UA = "Mozilla/5.0 (compatible; Googlebot/2.1; +http://www.google.com/bot.html)";
let scaricata = 0;
const lista = async () => { scaricata++; return new Response(JSON.stringify({ prefixes: [{ ipv4Prefix: "66.249.64.0/27" }] }), { status: 200 }); };
_svuotaCache();
check("Googlebot con IP di Google: verificato", await crawlerVerificato(UA, "66.249.64.7", lista));
check("Googlebot con IP qualunque: no", !(await crawlerVerificato(UA, "93.40.1.1", lista)));
check("browser normale con IP di Google: no", !(await crawlerVerificato("Mozilla/5.0 Safari", "66.249.64.7", lista)));
check("Rich Results Test (Google-InspectionTool) da IP di Google: no, e' uno strumento pubblico",
  !(await crawlerVerificato("Mozilla/5.0 (Linux; Android 6.0.1) Chrome/125.0 Mobile Safari/537.36 (compatible; Google-InspectionTool/1.0;)", "66.249.64.7", lista)));
check("GoogleOther da IP di Google: no", !(await crawlerVerificato("GoogleOther", "66.249.64.7", lista)));
check("la lista si scarica una volta sola", scaricata === 1, scaricata);

_svuotaCache();
const giu = async () => { throw new Error("rete"); };
check("lista irraggiungibile: no (mai il testo per errore)", !(await crawlerVerificato(UA, "66.249.64.7", giu)));
_svuotaCache();
const rotta = async () => new Response("<html>", { status: 200 });
check("lista illeggibile: no", !(await crawlerVerificato(UA, "66.249.64.7", rotta)));
_svuotaCache();
const errore = async () => new Response("", { status: 503 });
check("lista in errore: no", !(await crawlerVerificato(UA, "66.249.64.7", errore)));
check("senza IP: no", !(await crawlerVerificato(UA, undefined, lista)));

// ---- anteprima ----
check("vuota: nessun paragrafo", paragrafiAnteprima("").length === 0 && paragrafiAnteprima(null).length === 0);
check("frase gia' chiusa: intatta", paragrafiAnteprima("Una frase. Due frasi.").join("|") === "Una frase. Due frasi.");
check("taglio sull'ultima frase intera se ne resta abbastanza",
  paragrafiAnteprima("Prima frase abbastanza lunga da contare. Seconda frase lunga anche lei qui. Terza tron").join("|")
    === "Prima frase abbastanza lunga da contare. Seconda frase lunga anche lei qui.");
check("altrimenti sull'ultima parola, con i puntini",
  paragrafiAnteprima("Breve. Una frase molto lunga che non finisce mai e viene tagliata a met").join("|")
    === "Breve. Una frase molto lunga che non finisce mai e viene tagliata a…");
check("i paragrafi restano separati", paragrafiAnteprima("Primo paragrafo.\nSecondo paragrafo.\n\n").length === 2);
// Caso reale: testo incollato con un a capo a ogni riga visiva.
const incollato = "Il mercato del\nlavoro italiano è entrato in una fase sospesa, quasi una bolla di quiete che\nperò non rassicura. La crescita si arresta.\nL'Italia si ferma: la stagnazione\ndell'occupazione\nA settembre gli\noccupati sono 24.328.000, 7.000 in meno rispetto ad agosto.";
const ric = paragrafiAnteprima(incollato);
check("righe spezzate a meta' frase: ricucite in paragrafi veri",
  ric.length === 2 && ric[0] === "Il mercato del lavoro italiano è entrato in una fase sospesa, quasi una bolla di quiete che però non rassicura. La crescita si arresta.", ric);

console.log("\n" + risultati.length + " controlli, " + risultati.filter((x) => !x).length + " falliti");
if (risultati.some((x) => !x)) process.exit(1);
