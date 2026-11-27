import "jsr:@supabase/functions-js/edge-runtime.d.ts";
import { createClient } from "jsr:@supabase/supabase-js@2";

// MeteoIAttualità — previsioni di tutti i comuni (dal 27/11/2026), tabella public.meteo_comuni.
// I 110 capoluoghi NON passano di qui: restano in meteo_giorni (meteo-sito, 6 volte al giorno, 4 modelli).
// Per gli altri 7.784 comuni: ICON-2I (oggi, ora per ora) + ECMWF IFS (6 giorni), 2 chiamate Open-Meteo a comune.
//   POST {lotto:true}       x-meteo-cron: calcola fino a 400 comuni non ancora aggiornati oggi (cron 5:00-7:00)
//   POST {comune:{regione,slug}}  pubblico: se il dato ha piu' di 3 ore lo ricalcola (con tetto giornaliero)
//   POST {semina:url}       x-meteo-cron: riempie/aggiorna la tabella dai dati di meteo-comuni-punti.json
// Il consumo si conta in public.meteo_consumo (tipo "lotto" / "richiesta").

const SU = Deno.env.get("SUPABASE_URL")!;
const METEO_DATI = SU + "/functions/v1/meteo-dati";
const DAILY = "weather_code,temperature_2m_max,temperature_2m_min,precipitation_sum,snowfall_sum,wind_gusts_10m_max,wind_direction_10m_dominant";
const HOURLY = "precipitation,cloud_cover,temperature_2m";
const TETTO_RICHIESTE = 10000; // chiamate Open-Meteo al giorno per gli aggiornamenti a richiesta (~5.000 comuni)
const LOTTO = 400, GRUPPO = 100;
const CORS = { "Access-Control-Allow-Origin": "*", "Access-Control-Allow-Headers": "content-type, apikey, authorization", "Access-Control-Allow-Methods": "POST, OPTIONS" };
const j = (o: unknown, s = 200) => new Response(JSON.stringify(o), { status: s, headers: { "Content-Type": "application/json", ...CORS } });
const r1 = (x: any) => (x == null ? null : Math.round(x * 10) / 10);
const r0 = (x: any) => (x == null ? null : Math.round(x));
const addDays = (d: string, n: number) => { const t = new Date(d + "T12:00:00Z"); t.setUTCDate(t.getUTCDate() + n); return t.toISOString().slice(0, 10); };
const oggiRoma = () => new Intl.DateTimeFormat("en-CA", { timeZone: "Europe/Rome" }).format(new Date());
async function sha256(t: string) {
  const b = await crypto.subtle.digest("SHA-256", new TextEncoder().encode(t));
  return Array.from(new Uint8Array(b)).map((x) => x.toString(16).padStart(2, "0")).join("");
}

// ---- stesse regole del cielo di meteo-sito (vedi li' i commenti completi) ----
type Serie = { time?: string[]; [k: string]: any };
const mediana = (v: number[]) => { const s = [...v].sort((a, b) => a - b); const n = s.length; return n % 2 ? s[(n - 1) / 2] : (s[n / 2 - 1] + s[n / 2]) / 2; };
const serieOra = (H: Serie | undefined, k: string, ora: string) => { const i = (H?.time ?? []).indexOf(ora); const v = i >= 0 ? H?.[k]?.[i] : null; return typeof v === "number" ? v : null; };
const hh = (g: string, h: number) => `${g}T${String(h).padStart(2, "0")}:00`;
function codDiurno(cod: number | null, g: string, fonti: Serie[], mm: number | null) {
  const nebbia = cod === 45 || cod === 48;
  const pioggia = cod != null && ((cod >= 51 && cod <= 67) || (cod >= 80 && cod <= 82));
  const tracce = pioggia && mm != null && mm < 1;
  if (cod == null || (cod > 3 && !nebbia && !tracce)) return cod;
  const tot: number[] = [];
  for (let h = 9; h <= 16; h++) { const v = fonti.map((H) => serieOra(H, "cloud_cover", hh(g, h))).filter((x): x is number => x != null); if (v.length) tot.push(mediana(v)); }
  if (tot.length < 4) return tracce ? 3 : cod;
  const m = tot.reduce((a, b) => a + b, 0) / tot.length;
  if (nebbia && m >= 90) return cod; // senza visibilita' dei modelli: nebbia solo se e' grigio tutto il giorno
  const c = m < 20 ? 0 : m < 45 ? 1 : m < 75 ? 2 : 3;
  return tracce ? Math.max(c, 1) : c;
}
const FASCE: [string, number, number, number][] = [["mattina", 6, 11, 9], ["pomeriggio", 12, 17, 15], ["sera", 18, 23, 21]];
function fasceDi(g: string, fonti: Serie[], ore: (number | null)[], neve: number) {
  return FASCE.map(([f, h0, h1, hc]) => {
    const nuv: number[] = [];
    for (let h = h0; h <= h1; h++) { const v = fonti.map((H) => serieOra(H, "cloud_cover", hh(g, h))).filter((x): x is number => x != null); if (v.length) nuv.push(mediana(v)); }
    const mm = ore.slice(h0, h1 + 1).reduce((a: number, b) => a + (b ?? 0), 0);
    const t = fonti.map((H) => serieOra(H, "temperature_2m", hh(g, hc))).find((x) => x != null) ?? null;
    let cod: number | null;
    if (mm >= 0.5) cod = neve >= 0.5 && t != null && t <= 1.5 ? (mm >= 3 ? 73 : 71) : mm >= 6 ? 65 : mm >= 2 ? 63 : 61;
    else if (nuv.length) { const m = nuv.reduce((a, b) => a + b, 0) / nuv.length; cod = m < 20 ? 0 : m < 45 ? 1 : m < 75 ? 2 : 3; }
    else cod = null;
    return { f, cod, t: r0(t), mm: r1(mm) };
  });
}
function calcola(A: any, E: any, g: string) {
  const Da = A?.daily ?? {}, De = E?.daily ?? {};
  const ia = (Da.time ?? []).indexOf(g), ie = (De.time ?? []).indexOf(g);
  const pick = (k: string) => { const v = ia >= 0 ? Da[k]?.[ia] : null; return v ?? (ie >= 0 ? De[k]?.[ie] : null); };
  const Ha = A?.hourly ?? {}, He = E?.hourly ?? {};
  let ore: (number | null)[] = (Ha.time ?? []).map((t: string, i: number) => (t.startsWith(g) ? Ha.precipitation[i] : undefined)).filter((x: any) => x !== undefined);
  if (!ore.length || ore.every((x) => x == null)) ore = (He.time ?? []).map((t: string, i: number) => (t.startsWith(g) ? He.precipitation[i] : undefined)).filter((x: any) => x !== undefined);
  const neve = r1(pick("snowfall_sum")) ?? 0;
  const tend = (De.time ?? []).slice(1, 7).map((d: string, k: number) => ({ d, cod: codDiurno(De.weather_code[k + 1], d, [He], De.precipitation_sum?.[k + 1] ?? null), min: r0(De.temperature_2m_min[k + 1]), max: r0(De.temperature_2m_max[k + 1]), mm: r1(De.precipitation_sum[k + 1]) }));
  return {
    giorno: g,
    cod: codDiurno(pick("weather_code"), g, [Ha, He], ore.length >= 24 ? ore.slice(6, 24).reduce((a: number, b) => a + (b ?? 0), 0) : pick("precipitation_sum")),
    min: r1(pick("temperature_2m_min")), max: r1(pick("temperature_2m_max")), mm: r1(pick("precipitation_sum")) ?? 0, neve,
    raff: r0(pick("wind_gusts_10m_max")), dir: r0(pick("wind_direction_10m_dominant")),
    ore: ore.slice(0, 24).map((x) => r1(x ?? 0)), fasce: fasceDi(g, [Ha, He], ore, neve), tend,
    icon_ok: ia >= 0 && Da.temperature_2m_max?.[ia] != null,
  };
}

async function om(token: string, params: Record<string, string>) {
  for (let t = 0; t < 3; t++) {
    const r = await fetch(METEO_DATI, { method: "POST", headers: { "x-iattualita-token": token, "Content-Type": "application/json" }, body: JSON.stringify({ api: "forecast", params }) });
    if (r.ok) { const d = await r.json(); return Array.isArray(d) ? d : [d]; }
    if (t === 2) throw new Error(`Open-Meteo ${r.status}: ${(await r.text()).slice(0, 200)}`);
    await new Promise((ok) => setTimeout(ok, 1500 * (t + 1)));
  }
  return [];
}

// calcola e salva un gruppo di comuni (max GRUPPO), ritorna quante chiamate ha usato
async function aggiorna(db: any, token: string, righe: any[], tipo: string) {
  const g = oggiRoma();
  const base = { latitude: righe.map((r) => r.lat).join(","), longitude: righe.map((r) => r.lon).join(","), daily: DAILY, hourly: HOURLY, timezone: "Europe/Rome" };
  const [A, E] = await Promise.all([
    om(token, { ...base, models: "italia_meteo_arpae_icon_2i", start_date: g, end_date: g }),
    om(token, { ...base, models: "ecmwf_ifs025", start_date: g, end_date: addDays(g, 6) }),
  ]);
  const chiamate = righe.length * 2;
  await db.rpc("meteo_consumo_aggiungi", { t: tipo, n: chiamate });
  const ora = new Date().toISOString();
  const nuove = righe.map((r, i) => ({ ...r, dati: calcola(A[i], E[i], g), giorno: g, aggiornato_il: ora }));
  const { error } = await db.from("meteo_comuni").upsert(nuove.map(({ codice, nome, slug, regione, prov, pop, lat, lon, capoluogo, dati, giorno, aggiornato_il }) => ({ codice, nome, slug, regione, prov, pop, lat, lon, capoluogo, dati, giorno, aggiornato_il })), { onConflict: "codice" });
  if (error) throw new Error("upsert: " + error.message);
  return { chiamate, righe: nuove };
}

Deno.serve(async (req) => {
  if (req.method === "OPTIONS") return new Response(null, { headers: CORS });
  if (req.method !== "POST") return j({ errore: "usa POST" }, 405);
  const db = createClient(SU, Deno.env.get("SUPABASE_SERVICE_ROLE_KEY")!);
  let body: any; try { body = await req.json(); } catch { body = {}; }
  const cron = req.headers.get("x-meteo-cron") ?? "";
  const daCron = cron.length >= 20 && !!(await db.from("meteo_cron").select("hash").eq("hash", await sha256(cron)).maybeSingle()).data;
  if ((body.lotto || body.semina) && !daCron) return j({ errore: "non autorizzato" }, 401);

  // token di 10 minuti per meteo-dati (come meteo-sito), cancellato alla fine
  const TOKEN = crypto.randomUUID() + crypto.randomUUID(); const tmp = await sha256(TOKEN);
  let tokenFatto = false;
  const prendiToken = async () => { if (!tokenFatto) { await db.from("tts_token").insert({ hash: tmp, scade: new Date(Date.now() + 10 * 60000).toISOString() }); tokenFatto = true; } return TOKEN; };
  try {
    if (body.semina) {
      const lista: any[] = await (await fetch(String(body.semina))).json();
      let n = 0;
      for (let i = 0; i < lista.length; i += 1000) {
        const pezzo = lista.slice(i, i + 1000).map((o) => ({ codice: o.codice, nome: o.nome, slug: o.slug, regione: o.reg, prov: o.prov, pop: o.pop ?? 0, lat: o.lat, lon: o.lon, capoluogo: !!o.cap }));
        const { error } = await db.from("meteo_comuni").upsert(pezzo, { onConflict: "codice" });
        if (error) return j({ errore: "semina", dettaglio: error.message, fatti: n }, 500);
        n += pezzo.length;
      }
      return j({ ok: true, comuni: n });
    }

    if (body.lotto) {
      const g = oggiRoma();
      const { data: righe, error } = await db.from("meteo_comuni").select("codice,nome,slug,regione,prov,pop,lat,lon,capoluogo")
        .eq("capoluogo", false).or(`giorno.is.null,giorno.lt.${g}`).order("pop", { ascending: false }).limit(Number(body.quanti) || LOTTO);
      if (error) return j({ errore: "lettura", dettaglio: error.message }, 500);
      if (!righe?.length) return j({ ok: true, fatti: 0, nota: "tutti aggiornati oggi" });
      const tk = await prendiToken();
      let chiamate = 0, fatti = 0; const errori: string[] = [];
      for (let i = 0; i < righe.length; i += GRUPPO) {
        try { const r = await aggiorna(db, tk, righe.slice(i, i + GRUPPO), "lotto"); chiamate += r.chiamate; fatti += r.righe.length; }
        catch (e) { errori.push(String((e as Error)?.message ?? e)); }
      }
      const { count } = await db.from("meteo_comuni").select("codice", { count: "exact", head: true }).eq("capoluogo", false).or(`giorno.is.null,giorno.lt.${g}`);
      return j({ ok: !errori.length, fatti, chiamate, restano: count, errori });
    }

    if (body.comune) {
      const { regione, slug } = body.comune;
      const { data: c } = await db.from("meteo_comuni").select("*").eq("regione", String(regione)).eq("slug", String(slug)).maybeSingle();
      if (!c) return j({ errore: "comune sconosciuto" }, 404);
      const vecchio = !c.aggiornato_il || c.giorno !== oggiRoma() || Date.now() - new Date(c.aggiornato_il).getTime() > 3 * 3600_000;
      if (c.capoluogo || !vecchio) return j({ ok: true, aggiornato: false, comune: c });
      const { data: usati } = await db.from("meteo_consumo").select("chiamate").eq("giorno", oggiRoma()).eq("tipo", "richiesta").maybeSingle();
      if ((usati?.chiamate ?? 0) + 2 > TETTO_RICHIESTE) return j({ ok: true, aggiornato: false, tetto: true, comune: c });
      const r = await aggiorna(db, await prendiToken(), [c], "richiesta");
      return j({ ok: true, aggiornato: true, comune: r.righe[0] });
    }
    return j({ errore: "niente da fare" }, 400);
  } catch (e) {
    return j({ errore: "elaborazione", dettaglio: String((e as Error)?.message ?? e) }, 502);
  } finally {
    if (tokenFatto) await db.from("tts_token").delete().eq("hash", tmp);
  }
});
