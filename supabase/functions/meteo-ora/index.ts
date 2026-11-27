import "jsr:@supabase/functions-js/edge-runtime.d.ts";
import { createClient } from "jsr:@supabase/supabase-js@2";
import { PUNTI } from "./punti.ts";

// MeteoIAttualità — "Adesso": il tempo osservato davvero, non previsto.
// Legge i bollettini METAR degli aeroporti (aviationweather.gov, servizio pubblico NOAA, gratuito)
// e salva in public.meteo_ora una riga per stazione. Lo chiama pg_cron ogni 30 minuti (:27 e :57,
// subito dopo le emissioni delle :20 e delle :50). Accesso: header x-meteo-cron (impronta in meteo_cron).
// Ogni capoluogo deve avere il suo "Adesso": dove manca l'aeroporto si aggiunge una stima (stima: true).

// [ICAO, città mostrata, slug regione]
const STAZIONI: [string, string, string][] = [
  ["LIMF", "Torino", "piemonte"], ["LIMZ", "Cuneo", "piemonte"], ["LIMW", "Aosta", "valle-daosta"],
  ["LIML", "Milano", "lombardia"], ["LIME", "Bergamo", "lombardia"], ["LIPO", "Brescia", "lombardia"],
  ["LIPB", "Bolzano", "trentino-alto-adige"],
  ["LIPZ", "Venezia", "veneto"], ["LIPX", "Verona", "veneto"], ["LIPH", "Treviso", "veneto"],
  ["LIPQ", "Trieste", "friuli-venezia-giulia"],
  ["LIMJ", "Genova", "liguria"], ["LIMG", "Albenga", "liguria"],
  ["LIPE", "Bologna", "emilia-romagna"], ["LIMP", "Parma", "emilia-romagna"], ["LIPK", "Forlì", "emilia-romagna"], ["LIPR", "Rimini", "emilia-romagna"],
  ["LIRQ", "Firenze", "toscana"], ["LIRP", "Pisa", "toscana"], ["LIRS", "Grosseto", "toscana"],
  ["LIRZ", "Perugia", "umbria"], ["LIPY", "Ancona", "marche"],
  ["LIRA", "Roma", "lazio"], ["LIRF", "Fiumicino", "lazio"],
  ["LIBP", "Pescara", "abruzzo"],
  ["LIRN", "Napoli", "campania"], ["LIRI", "Salerno", "campania"],
  ["LIRM", "Caserta (Grazzanise)", "campania"],
  ["LIBD", "Bari", "puglia"], ["LIBA", "Foggia (Amendola)", "puglia"], ["LIBV", "Gioia del Colle", "puglia"], ["LIBN", "Lecce (Galatina)", "puglia"], ["LIBR", "Brindisi", "puglia"], ["LIBG", "Taranto", "puglia"],
  ["LICA", "Lamezia Terme", "calabria"], ["LICR", "Reggio Calabria", "calabria"], ["LIBC", "Crotone", "calabria"],
  ["LICJ", "Palermo", "sicilia"], ["LICC", "Catania", "sicilia"], ["LICT", "Trapani", "sicilia"], ["LICB", "Comiso", "sicilia"],
  ["LIEE", "Cagliari", "sardegna"], ["LIEO", "Olbia", "sardegna"], ["LIEA", "Alghero", "sardegna"],
];

// Ogni capoluogo di provincia ha il suo "Adesso": se non c'e' un aeroporto della citta' (o se tace),
// stima del modello per il momento attuale (Open-Meteo "current", dati a 15 minuti), segnata come stima.
// Circa 70 capoluoghi x 48 volte al giorno: ~100.000 chiamate al mese, dentro il piano Standard.
const STIME: [string, string, number, number][] = PUNTI.filter((p) => p[4] !== 2).map((p) => [p[0], p[1], p[2], p[3]]);
const DESC: Record<number, string> = { 0: "sereno", 1: "poco nuvoloso", 2: "parzialmente nuvoloso", 3: "coperto", 45: "nebbia", 48: "nebbia", 51: "pioviggine", 53: "pioviggine", 55: "pioviggine", 56: "pioviggine gelata", 57: "pioviggine gelata", 61: "pioggia debole", 63: "pioggia", 65: "pioggia forte", 66: "pioggia gelata", 67: "pioggia gelata", 71: "neve debole", 73: "neve", 75: "neve forte", 77: "neve", 80: "rovesci", 81: "rovesci", 82: "rovesci forti", 85: "rovesci di neve", 86: "rovesci di neve", 95: "temporale", 96: "temporale", 99: "temporale" };

async function sha256(t: string) {
  const b = await crypto.subtle.digest("SHA-256", new TextEncoder().encode(t));
  return Array.from(new Uint8Array(b)).map((x) => x.toString(16).padStart(2, "0")).join("");
}
const j = (o: unknown, s = 200) => new Response(JSON.stringify(o), { status: s, headers: { "Content-Type": "application/json" } });

// METAR -> codice tipo WMO (lo stesso delle icone del sito) + descrizione in italiano.
function cielo(m: any): { cod: number; desc: string } {
  const wx = String(m.wxString ?? "");
  const nubi: string[] = (m.clouds ?? []).map((c: any) => String(c.cover));
  const cover = String(m.cover ?? "");
  if (/TS/.test(wx)) return { cod: 95, desc: "temporale" };
  if (/SN|SG|PL/.test(wx)) return { cod: /\+/.test(wx) ? 75 : 71, desc: /\+/.test(wx) ? "neve forte" : "neve" };
  if (/RA|DZ|SH/.test(wx)) {
    const forte = /\+/.test(wx), debole = /-/.test(wx) || /DZ/.test(wx);
    return { cod: forte ? 65 : debole ? 61 : 63, desc: forte ? "pioggia forte" : debole ? "pioggia debole" : "pioggia" };
  }
  if (/FG/.test(wx) && !/BCFG|MIFG|PRFG/.test(wx)) return { cod: 45, desc: "nebbia" };
  // nuvolosità: lo strato più esteso
  const ordine = ["SKC", "CLR", "NSC", "NCD", "CAVOK", "FEW", "SCT", "BKN", "OVC", "OVX", "VV"];
  const tutte = [...nubi, cover].filter((x) => ordine.includes(x));
  const peggio = tutte.sort((a, b) => ordine.indexOf(b) - ordine.indexOf(a))[0] ?? "";
  const foschia = /BR|HZ|FU/.test(wx);
  let r: { cod: number; desc: string };
  if (peggio === "OVC" || peggio === "OVX" || peggio === "VV") r = { cod: 3, desc: "coperto" };
  else if (peggio === "BKN") r = { cod: 3, desc: "molto nuvoloso" };
  else if (peggio === "SCT") r = { cod: 2, desc: "parzialmente nuvoloso" };
  else if (peggio === "FEW") r = { cod: 1, desc: "poco nuvoloso" };
  else r = { cod: 0, desc: "sereno" };
  if (foschia) r = { cod: r.cod, desc: r.desc + (/HZ/.test(wx) && !/BR/.test(wx) ? ", caligine" : ", foschia") };
  return r;
}

Deno.serve(async (req) => {
  const db = createClient(Deno.env.get("SUPABASE_URL")!, Deno.env.get("SUPABASE_SERVICE_ROLE_KEY")!);
  const k = req.headers.get("x-meteo-cron") ?? "";
  if (k.length < 20) return j({ errore: "non autorizzato" }, 401);
  const { data: ok } = await db.from("meteo_cron").select("hash").eq("hash", await sha256(k)).maybeSingle();
  if (!ok) return j({ errore: "non autorizzato" }, 401);

  const r = await fetch(`https://aviationweather.gov/api/data/metar?ids=${STAZIONI.map((s) => s[0]).join(",")}&format=json`, { headers: { "User-Agent": "iattualita.it meteo (redazione@iattualita.it)" } });
  if (!r.ok) return j({ errore: "METAR", stato: r.status }, 502);
  const lista: any[] = await r.json();
  const ultimo: Record<string, any> = {};
  for (const m of lista) {
    if (m.temp == null) continue; // NIL o bollettino vuoto
    const prec = ultimo[m.icaoId];
    if (!prec || String(m.reportTime) > String(prec.reportTime)) ultimo[m.icaoId] = m;
  }
  const adesso = Date.now();
  const ora = (iso: string) => new Intl.DateTimeFormat("it-IT", { timeZone: "Europe/Rome", hour: "2-digit", minute: "2-digit" }).format(new Date(iso));
  const stazioni = STAZIONI.map(([icao, citta, regione]) => {
    const m = ultimo[icao];
    if (!m) return null;
    const quando = new Date(String(m.reportTime).replace(" ", "T") + (String(m.reportTime).endsWith("Z") ? "" : "Z"));
    if (adesso - quando.getTime() > 3 * 3600_000) return null; // più vecchio di 3 ore: non è "adesso"
    const c = cielo(m);
    const kmh = (kt: any) => (typeof kt === "number" ? Math.round(kt * 1.852) : null);
    return { icao, citta, regione, ...c, t: Math.round(m.temp), vento: kmh(m.wspd), raffica: kmh(m.wgst), ora: ora(quando.toISOString()), quando: quando.toISOString() };
  }).filter(Boolean) as any[];

  // Capoluoghi senza un aeroporto proprio che ha trasmesso: stima del modello.
  // "Caserta (Grazzanise)" conta come stazione di Caserta.
  const conOss = new Set(stazioni.map((x) => String(x.citta).replace(/ \(.*\)$/, "")));
  const daStimare = STIME.filter(([nome]) => !conOss.has(nome));
  const avvisi: string[] = [];
  if (daStimare.length) {
    let tmp: string | null = null;
    try {
      const TOKEN = crypto.randomUUID() + crypto.randomUUID(); tmp = await sha256(TOKEN);
      await db.from("tts_token").insert({ hash: tmp, scade: new Date(Date.now() + 5 * 60000).toISOString() });
      const rr = await fetch((Deno.env.get("SUPABASE_URL") ?? "") + "/functions/v1/meteo-dati", { method: "POST", headers: { "x-iattualita-token": TOKEN, "Content-Type": "application/json" },
        body: JSON.stringify({ api: "forecast", params: { latitude: daStimare.map((x) => x[2]).join(","), longitude: daStimare.map((x) => x[3]).join(","), current: "temperature_2m,weather_code,wind_speed_10m,wind_gusts_10m", timezone: "Europe/Rome" } }) });
      const d = await rr.json(); const arr = Array.isArray(d) ? d : [d];
      daStimare.forEach(([nome, reg], i) => {
        const c = arr[i]?.current; if (!c || c.temperature_2m == null) return;
        const quando = new Date(String(c.time) + ":00" + (arr[i].utc_offset_seconds === 7200 ? "+02:00" : "+01:00"));
        const cod = Number(c.weather_code);
        stazioni.push({ icao: "stima-" + nome, citta: nome, regione: reg, cod, desc: DESC[cod] ?? "", t: Math.round(c.temperature_2m), vento: c.wind_speed_10m != null ? Math.round(c.wind_speed_10m) : null, raffica: c.wind_gusts_10m != null ? Math.round(c.wind_gusts_10m) : null, ora: ora(quando.toISOString()), quando: quando.toISOString(), stima: true });
      });
    } catch (e) { avvisi.push("stime: " + String((e as Error)?.message ?? e)); }
    finally { if (tmp) await db.from("tts_token").delete().eq("hash", tmp); }
  }
  const ordReg = ["piemonte","valle-daosta","lombardia","trentino-alto-adige","veneto","friuli-venezia-giulia","liguria","emilia-romagna","toscana","umbria","marche","lazio","abruzzo","molise","campania","puglia","basilicata","calabria","sicilia","sardegna"];
  stazioni.sort((a, b) => ordReg.indexOf(a.regione) - ordReg.indexOf(b.regione) || Number(!!a.stima) - Number(!!b.stima));

  const { error } = await db.from("meteo_ora").upsert({ id: 1, stazioni, aggiornato_il: new Date().toISOString() });
  if (error) return j({ errore: "upsert", dettaglio: error.message }, 500);
  return j({ ok: true, osservate: stazioni.filter((x) => !x.stima).length, stime: stazioni.filter((x) => x.stima).length, regioni: new Set(stazioni.map((x) => x.regione)).size, avvisi });
});
