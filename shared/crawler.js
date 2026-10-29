// shared/crawler.js
//
// Riconosce i crawler dei motori di ricerca in modo verificabile, per
// servire loro il testo integrale degli articoli che il pubblico vede solo
// in anteprima.
//
// Perche' serve: senza il testo, Google indicizza solo le prime righe di ogni
// articolo e il sito sparisce dalle ricerche su tutto il resto. Google lo
// prevede esplicitamente per i contenuti riservati ("flexible sampling"): il
// testo pieno al crawler e' ammesso se la pagina lo dichiara con i dati
// strutturati isAccessibleForFree=false. Non e' cloaking.
//
// Perche' non basta lo user-agent: chiunque puo' scrivere "Googlebot" nella
// propria richiesta e leggersi tutto. Quindi si controlla anche che l'IP
// stia negli intervalli pubblicati dal motore di ricerca stesso. Se la lista
// non si scarica, la risposta e' "no": il crawler riceve l'anteprima, il
// testo non esce mai per errore.

const MOTORI = [
  {
    nome: "google",
    ua: /Googlebot|Google-InspectionTool|GoogleOther|Storebot-Google/i,
    url: "https://developers.google.com/static/search/apis/ipranges/googlebot.json"
  },
  {
    nome: "bing",
    ua: /bingbot/i,
    url: "https://www.bing.com/toolbox/bingbot.json"
  }
];

const VALIDA_MS = 24 * 3600 * 1000;   // le liste cambiano di rado
const RIPROVA_MS = 5 * 60 * 1000;     // dopo un errore non si insiste a ogni richiesta
const TIMEOUT_MS = 1500;              // il crawler non deve aspettare la lista

// ---------- indirizzi IP come numeri ----------

function ip4(s) {
  const p = String(s).split(".");
  if (p.length !== 4) return null;
  let n = 0n;
  for (const x of p) {
    if (!/^\d{1,3}$/.test(x) || Number(x) > 255) return null;
    n = (n << 8n) | BigInt(x);
  }
  return n;
}

function ip6(s) {
  let t = String(s).toLowerCase();
  const zona = t.indexOf("%");
  if (zona >= 0) t = t.slice(0, zona);
  // Coda in forma IPv4 (::ffff:1.2.3.4): diventa due gruppi esadecimali.
  const m = t.match(/^(.*:)(\d+\.\d+\.\d+\.\d+)$/);
  if (m) {
    const v4 = ip4(m[2]);
    if (v4 === null) return null;
    t = m[1] + ((v4 >> 16n) & 0xffffn).toString(16) + ":" + (v4 & 0xffffn).toString(16);
  }
  const doppio = t.split("::");
  if (doppio.length > 2) return null;
  const testa = doppio[0] ? doppio[0].split(":") : [];
  const coda = doppio.length === 2 && doppio[1] ? doppio[1].split(":") : [];
  const mancano = 8 - testa.length - coda.length;
  if (doppio.length === 1 ? mancano !== 0 : mancano < 1) return null;
  const gruppi = testa.concat(Array(doppio.length === 2 ? mancano : 0).fill("0"), coda);
  let n = 0n;
  for (const g of gruppi) {
    if (!/^[0-9a-f]{1,4}$/.test(g)) return null;
    n = (n << 16n) | BigInt(parseInt(g, 16));
  }
  return n;
}

// { v: 4|6, n: BigInt } oppure null
export function parseIp(s) {
  const t = String(s || "").trim();
  if (t.indexOf(":") >= 0) {
    const n = ip6(t);
    if (n === null) return null;
    // IPv4 scritto come IPv6 (::ffff:a.b.c.d): lo si tratta da IPv4.
    if (n >> 32n === 0xffffn) return { v: 4, n: n & 0xffffffffn };
    return { v: 6, n };
  }
  const n = ip4(t);
  return n === null ? null : { v: 4, n };
}

export function inCidr(ip, cidr) {
  const [base, bitsTxt] = String(cidr).split("/");
  const b = parseIp(base);
  if (!ip || !b || ip.v !== b.v) return false;
  const tot = ip.v === 4 ? 32 : 128;
  const bits = bitsTxt === undefined ? tot : Number(bitsTxt);
  if (!Number.isInteger(bits) || bits < 0 || bits > tot) return false;
  const shift = BigInt(tot - bits);
  return (ip.n >> shift) === (b.n >> shift);
}

// Estrae i prefissi dal formato comune alle liste di Google e Bing:
// { prefixes: [ { ipv4Prefix: "..." } | { ipv6Prefix: "..." } ] }
export function prefissiDaLista(json) {
  const out = [];
  for (const p of (json && json.prefixes) || []) {
    const c = p && (p.ipv4Prefix || p.ipv6Prefix);
    if (c && /\//.test(c)) out.push(c);
  }
  return out;
}

// ---------- liste in memoria ----------

const cache = new Map(); // nome -> { prefissi, scade }

async function prefissi(motore, fetcher) {
  const c = cache.get(motore.nome);
  if (c && c.scade > Date.now()) return c.prefissi;
  let lista = [];
  try {
    const ctrl = typeof AbortController !== "undefined" ? new AbortController() : null;
    const t = ctrl ? setTimeout(() => ctrl.abort(), TIMEOUT_MS) : null;
    const r = await fetcher(motore.url, ctrl ? { signal: ctrl.signal } : undefined);
    if (t) clearTimeout(t);
    if (r.ok) lista = prefissiDaLista(await r.json());
  } catch (e) {
    lista = [];
  }
  cache.set(motore.nome, { prefissi: lista, scade: Date.now() + (lista.length ? VALIDA_MS : RIPROVA_MS) });
  return lista;
}

// true solo se user-agent E indirizzo IP appartengono a un motore di ricerca.
export async function crawlerVerificato(userAgent, ip, fetcher) {
  const ua = String(userAgent || "");
  const motore = MOTORI.find((m) => m.ua.test(ua));
  if (!motore) return false;
  const addr = parseIp(ip);
  if (!addr) return false;
  const lista = await prefissi(motore, fetcher || fetch);
  return lista.some((c) => inCidr(addr, c));
}

// Solo per i test.
export function _svuotaCache() {
  cache.clear();
}
