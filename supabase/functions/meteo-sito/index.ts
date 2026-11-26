import "jsr:@supabase/functions-js/edge-runtime.d.ts";
import { createClient } from "jsr:@supabase/supabase-js@2";
import { PUNTI, REGIONI } from "./punti.ts";

// MeteoIAttualità — dati della pagina /meteo di iattualita.it (dal 27/11/2026).
// La chiama il routine del mattino, DOPO il reel, e non deve mai bloccarlo.
// Scarica da Open-Meteo (piano commerciale, passando da meteo-dati) per 110 capoluoghi + 2 punti di montagna:
//   - ICON-2I di ItaliaMeteo-ARPAE per il giorno (giornaliero + ora per ora);
//   - ECMWF IFS 0,25° per i 6 giorni dopo e come secondo parere sul giorno.
// Calcola KPI, aggregati per regione, testi automatici delle regioni, differenze tra modelli,
// e fa upsert in public.meteo_giorni. I campi editoriali (titolo, zone, reel...) vengono dal routine;
// se mancano si tengono quelli già salvati. Reel e cover vengono copiati nello storage "media".
// Accesso: header x-iattualita-token valido in public.tts_token (lo stesso di meteo-dati).
// POST {giorno:"AAAA-MM-GG", titolo?, sottotitolo?, zone?:{nord,centro,sud}, reel_url?, cover_url?,
//       allerte?:{bollettino, testo, regioni:[...]}, solo_testi?:bool}

// La chiave Open-Meteo sta solo in meteo-dati: qui si passa da lei con lo stesso token della richiesta.
const METEO_DATI = (Deno.env.get("SUPABASE_URL") ?? "") + "/functions/v1/meteo-dati";
let TOKEN = "";
const DAILY = "weather_code,temperature_2m_max,temperature_2m_min,precipitation_sum,snowfall_sum,wind_gusts_10m_max,wind_direction_10m_dominant";
const ZONE = ["Nord", "Centro", "Sud e isole"];

async function sha256(t: string) {
  const b = await crypto.subtle.digest("SHA-256", new TextEncoder().encode(t));
  return Array.from(new Uint8Array(b)).map((x) => x.toString(16).padStart(2, "0")).join("");
}
const j = (o: unknown, s = 200) => new Response(JSON.stringify(o), { status: s, headers: { "Content-Type": "application/json" } });
const r1 = (x: number | null | undefined) => (x == null ? null : Math.round(x * 10) / 10);
const r0 = (x: number | null | undefined) => (x == null ? null : Math.round(x));
const addDays = (d: string, n: number) => { const t = new Date(d + "T12:00:00Z"); t.setUTCDate(t.getUTCDate() + n); return t.toISOString().slice(0, 10); };
const virg = (x: number) => String(r1(x)).replace(".", ",");

async function om(params: Record<string, string>) {
  for (let t = 0; t < 3; t++) {
    const r = await fetch(METEO_DATI, { method: "POST", headers: { "x-iattualita-token": TOKEN, "Content-Type": "application/json" }, body: JSON.stringify({ api: "forecast", params }) });
    if (r.ok) { const d = await r.json(); return Array.isArray(d) ? d : [d]; }
    if (t === 2) throw new Error(`Open-Meteo ${r.status}: ${(await r.text()).slice(0, 300)}`);
    await new Promise((ok) => setTimeout(ok, 1500 * (t + 1)));
  }
  return [];
}

async function scarica(giorno: string) {
  const lotti: typeof PUNTI[] = [];
  for (let i = 0; i < PUNTI.length; i += 30) lotti.push(PUNTI.slice(i, i + 30));
  const icon: any[] = [], ecm: any[] = [];
  for (const l of lotti) {
    const base = { latitude: l.map((p) => p[2]).join(","), longitude: l.map((p) => p[3]).join(","), daily: DAILY, timezone: "Europe/Rome" };
    const [a, b] = await Promise.all([
      om({ ...base, models: "italia_meteo_arpae_icon_2i", start_date: giorno, end_date: giorno, hourly: "precipitation,freezing_level_height" }),
      om({ ...base, models: "ecmwf_ifs025", start_date: giorno, end_date: addDays(giorno, 6), hourly: "precipitation" }),
    ]);
    icon.push(...a); ecm.push(...b);
  }
  return { icon, ecm };
}

const fascia = (h: number) => (h < 6 ? "di notte" : h < 12 ? "al mattino" : h < 18 ? "nel pomeriggio" : "in serata");
const BUSSOLA = ["Nord", "Nord-Est", "Est", "Sud-Est", "Sud", "Sud-Ovest", "Ovest", "Nord-Ovest"];
const bussola = (deg: number | null) => (deg == null ? "" : BUSSOLA[Math.round(deg / 45) % 8]);
const a = (nome: string) => (/^[AEIOUaeiou]/.test(nome) ? "ad " : "a ") + nome;
const elenco = (v: string[]) => (v.length < 2 ? v.join("") : v.slice(0, -1).join(", ") + " e " + v[v.length - 1]);
const norm = (s: string) => s.normalize("NFD").replace(/[\u0300-\u036f]/g, "").toLowerCase().replace(/[^a-z]/g, "");

function puntoDa(p: typeof PUNTI[number], A: any, E: any, giorno: string) {
  const Da = A?.daily ?? {}, De = E?.daily ?? {};
  const ia = (Da.time ?? []).indexOf(giorno), ie = (De.time ?? []).indexOf(giorno);
  const pick = (k: string) => { const v = ia >= 0 ? Da[k]?.[ia] : null; return v ?? (ie >= 0 ? De[k]?.[ie] : null); };
  const Ha = A?.hourly ?? {}, He = E?.hourly ?? {};
  let ore: (number | null)[] = (Ha.time ?? []).map((t: string, i: number) => (t.startsWith(giorno) ? Ha.precipitation[i] : undefined)).filter((x: any) => x !== undefined);
  if (!ore.length || ore.every((x) => x == null)) ore = (He.time ?? []).map((t: string, i: number) => (t.startsWith(giorno) ? He.precipitation[i] : undefined)).filter((x: any) => x !== undefined);
  const zt = [6, 12, 18].map((h) => { const i = (Ha.time ?? []).indexOf(`${giorno}T${String(h).padStart(2, "0")}:00`); return i >= 0 ? r0(Ha.freezing_level_height?.[i] ?? null) : null; });
  const tend = (De.time ?? []).slice(1, 7).map((d: string, k: number) => ({ d, cod: De.weather_code[k + 1], min: r0(De.temperature_2m_min[k + 1]), max: r0(De.temperature_2m_max[k + 1]), mm: r1(De.precipitation_sum[k + 1]) }));
  return {
    nome: p[0], regione: p[1], zona: p[4] === 2 ? "Montagna" : REGIONI.find((r) => r[0] === p[1])![2], cap: p[4] === 1, mont: p[4] === 2,
    cod: pick("weather_code"), min: r1(pick("temperature_2m_min")), max: r1(pick("temperature_2m_max")), mm: r1(pick("precipitation_sum")) ?? 0,
    neve: r1(pick("snowfall_sum")) ?? 0, raff: r0(pick("wind_gusts_10m_max")), dir: r0(pick("wind_direction_10m_dominant")),
    ore: ore.slice(0, 24).map((x) => r1(x ?? 0)), zt, tend,
    ecm: ie >= 0 ? { max: r1(De.temperature_2m_max[ie]), mm: r1(De.precipitation_sum[ie]) } : null,
    icon_ok: ia >= 0 && Da.temperature_2m_max?.[ia] != null,
  };
}

function testoRegione(nome: string, ps: any[], allerta: any) {
  const conPioggia = ps.filter((p) => p.mm >= 0.5).sort((a, b) => b.mm - a.mm);
  const raff = ps.reduce((a, b) => ((b.raff ?? 0) > (a.raff ?? 0) ? b : a), ps[0]);
  const neve = ps.filter((p) => p.neve >= 0.5);
  const mx = Math.max(...ps.map((p) => p.max ?? -99)), mn = Math.min(...ps.map((p) => p.min ?? 99));
  // fascia oraria prevalente della pioggia (somma su tutti i capoluoghi)
  const somma = Array(24).fill(0); ps.forEach((p) => p.ore.forEach((v: number, h: number) => (somma[h] += v ?? 0)));
  const tot = somma.reduce((a, b) => a + b, 0);
  const fasce = [0, 6, 12, 18].map((h) => somma.slice(h, h + 6).reduce((a, b) => a + b, 0));
  const fOrd = fasce.map((v, i) => [v, i]).sort((a, b) => b[0] - a[0]);
  const nomiF = ["di notte", "al mattino", "nel pomeriggio", "in serata"];
  let titolo: string;
  const frasi: string[] = [];
  const n = ps.length;
  if (neve.length) titolo = `${nome}: neve ${a(neve[0].nome)}`;
  else if (conPioggia.length === 0) titolo = (raff?.raff ?? 0) >= 60 ? `${nome}: asciutto ma ventoso` : `${nome}: giornata asciutta`;
  else {
    const f1 = nomiF[fOrd[0][1]], f2 = fOrd[1][0] > tot * 0.3 ? nomiF[fOrd[1][1]] : null;
    const chi = conPioggia.length === n ? (n === 1 ? "pioggia" : "piogge diffuse") : conPioggia.length >= n / 2 ? "piogge sparse" : "qualche pioggia";
    const [fa, fb] = f2 && nomiF.indexOf(f2) < nomiF.indexOf(f1) ? [f2, f1] : [f1, f2];
    titolo = `${nome}: ${chi} ${fa}${fb ? " e " + fb : ""}`;
  }
  if (conPioggia.length) {
    const top = conPioggia.slice(0, 3).map((p) => `${virg(p.mm)} mm ${a(p.nome)}`);
    const asc = ps.filter((p) => p.mm < 0.5).map((p) => p.nome);
    frasi.push(n > 1 && conPioggia.length === n ? `Piove ${n === 2 ? "in entrambi i capoluoghi" : `in tutti i ${n} capoluoghi`}: ${elenco(top)}.` : `Pioggia prevista: ${elenco(top)}.`);
    if (asc.length && asc.length <= 3 && n > 1) frasi.push(`Asciutto ${a(elenco(asc))}.`);
  } else frasi.push(n > 1 ? "Nessuna pioggia prevista nei capoluoghi." : "Nessuna pioggia prevista.");
  frasi.push(`Temperature tra ${r0(mn)} e ${r0(mx)} °C.`);
  if ((raff?.raff ?? 0) >= 40) frasi.push(`Raffiche fino a ${raff.raff} km/h ${a(raff.nome)}.`);
  if (neve.length) frasi.push(`Neve: ${elenco(neve.map((p) => `${virg(p.neve)} cm ${a(p.nome)}`))}.`);
  frasi.push(allerta ? `Allerta ${allerta.livello ?? "gialla"} della Protezione Civile${allerta.rischi?.length ? " per rischio " + elenco(allerta.rischi) : ""}.` : "Nessuna allerta oggi.");
  return { titolo, testo: frasi.join(" ") };
}

// Il bollettino DPC elenca le regioni sotto intestazioni del tipo
// "ORDINARIA CRITICITA' PER RISCHIO TEMPORALI / ALLERTA GIALLA:": livello e rischio
// stanno nell'intestazione, la riga della regione ha solo le zone.
function leggiAllerte(al: any) {
  if (!al) return null;
  const ORD = ["gialla", "arancione", "rossa"];
  const per: Record<string, { livello: string; rischi: string[]; zone: Set<string> }> = {};
  let livello: string | null = null, rischio: string | null = null;
  for (const l of String(al.testo ?? "").split("\n")) {
    const L = l.trim();
    const h = /RISCHIO\s+([A-Z' ]+?)\s*\/\s*ALLERTA\s+(GIALLA|ARANCIONE|ROSSA)/i.exec(L);
    if (h) { rischio = h[1].trim().toLowerCase(); livello = h[2].toLowerCase(); continue; }
    const m = /^([A-Z][A-Za-z' -]+?):\s*(.*)$/.exec(L);
    if (!m || !livello) continue;
    const reg = REGIONI.find((r) => norm(r[1]).startsWith(norm(m[1]).slice(0, 6)) || norm(m[1]).startsWith(norm(r[1]).slice(0, 6)));
    if (!reg) continue;
    const x = (per[reg[0]] ??= { livello, rischi: [], zone: new Set() });
    if (ORD.indexOf(livello) > ORD.indexOf(x.livello)) x.livello = livello;
    if (rischio && !x.rischi.includes(rischio)) x.rischi.push(rischio);
    if (m[2].trim()) x.zone.add(m[2].trim()); // i nomi delle zone DPC contengono virgole: la riga resta intera
  }
  // regioni elencate dal routine ma non trovate nel testo: allerta senza dettagli
  for (const nome of al.regioni ?? []) {
    const reg = REGIONI.find((r) => norm(r[1]).startsWith(norm(nome).slice(0, 6)));
    if (reg && !per[reg[0]]) per[reg[0]] = { livello: "gialla", rischi: [], zone: new Set() };
  }
  const regioni = REGIONI.filter((r) => per[r[0]]).map((r) => {
    const x = per[r[0]];
    return { regione: r[1], slug: r[0], livello: x.livello, rischi: x.rischi,
      testo: `Allerta ${x.livello}${x.rischi.length ? " per rischio " + elenco(x.rischi) : ""}. Zone: ${[...x.zone].join("; ")}.` };
  });
  return { bollettino: al.bollettino ?? null, regioni, errore: al.errore ?? null };
}

Deno.serve(async (req) => {
  if (req.method !== "POST") return j({ errore: "usa POST" }, 405);
  const SU = Deno.env.get("SUPABASE_URL")!;
  const db = createClient(SU, Deno.env.get("SUPABASE_SERVICE_ROLE_KEY")!);
  const tok = req.headers.get("x-iattualita-token") ?? "";
  if (tok.length < 20) return j({ errore: "non autorizzato" }, 401);
  const { data: valido } = await db.from("tts_token").select("hash").eq("hash", await sha256(tok)).gt("scade", new Date().toISOString()).maybeSingle();
  if (!valido) return j({ errore: "non autorizzato" }, 401);
  TOKEN = tok;

  let body: any;
  try { body = await req.json(); } catch { return j({ errore: "json non valido" }, 400); }
  const giorno = String(body.giorno ?? "");
  if (!/^\d{4}-\d{2}-\d{2}$/.test(giorno)) return j({ errore: "giorno AAAA-MM-GG obbligatorio" }, 400);

  try {
  const { data: prima } = await db.from("meteo_giorni").select("*").eq("giorno", giorno).maybeSingle();
  const allerte = body.allerte !== undefined ? leggiAllerte(body.allerte) : (prima?.allerte ?? null);

  let punti: any[] = prima?.punti ?? [];
  if (!body.solo_testi || !punti.length) {
    const { icon, ecm } = await scarica(giorno);
    punti = PUNTI.map((p, i) => puntoDa(p, icon[i], ecm[i], giorno));
  }
  const citta = punti.filter((p) => !p.mont);
  const best = (arr: any[], f: (p: any) => number) => arr.reduce((a, b) => (f(b) > f(a) ? b : a), arr[0]);

  // KPI
  const kR = best(citta, (p) => p.raff ?? -1), kP = best(citta, (p) => p.mm ?? -1), kM = best(citta, (p) => p.max ?? -99), kN = best(punti, (p) => -(p.min ?? 99));
  const picco = (p: any) => { const m = Math.max(...p.ore); return m > 0 ? p.ore.indexOf(m) : null; };
  const kpi = {
    raffica: { valore: kR.raff, citta: kR.nome, dir: bussola(kR.dir) },
    pioggia: { valore: kP.mm, citta: kP.nome, quando: kP.mm > 0 && picco(kP) != null ? fascia(picco(kP)!) : null },
    massima: { valore: kM.max, citta: kM.nome },
    minima: { valore: kN.min, citta: kN.nome, neve: kN.neve || null },
  };

  // regioni
  const regioni: Record<string, any> = {};
  for (const [slug, nome, zona, cap] of REGIONI) {
    const ps = citta.filter((p) => p.regione === slug);
    const c = ps.find((p) => p.nome === cap) ?? ps[0];
    const al = allerte?.regioni?.find((x: any) => x.slug === slug) ?? null;
    regioni[slug] = { nome, zona, cap: c.nome, cod: c.cod, max: r0(c.max), min: r0(c.min), mm: Math.max(...ps.map((p) => p.mm ?? 0)), mmCap: c.mm, allerta: al ? (al.livello ?? "gialla") : null, ...testoRegione(nome, ps, al) };
  }

  // zone: range delle massime sempre calcolato, testo dal routine (o automatico)
  const zIn = body.zone ?? {};
  const zKey: Record<string, string> = { "Nord": "nord", "Centro": "centro", "Sud e isole": "sud" };
  const zone = ZONE.map((z) => {
    const ps = citta.filter((p) => p.zona === z);
    const lo = r0(Math.min(...ps.map((p) => p.max ?? 99))), hi = r0(Math.max(...ps.map((p) => p.max ?? -99)));
    const pio = ps.filter((p) => p.mm >= 1).sort((a, b) => b.mm - a.mm);
    const auto = pio.length ? `Pioggia in ${pio.length} capoluoghi su ${ps.length}, di più ${a(pio[0].nome)} (${virg(pio[0].mm)} mm)${pio[1] ? ` e ${a(pio[1].nome)} (${virg(pio[1].mm)} mm)` : ""}.` : `Niente pioggia nei capoluoghi.`;
    const testo = zIn[zKey[z]] ?? (Array.isArray(prima?.zone) ? prima.zone.find((x: any) => x.nome === z)?.testo_routine : null) ?? null;
    return { nome: z, range: `massime da ${lo} a ${hi} °C`, testo: testo ?? auto, testo_routine: testo ?? null };
  });

  // tendenza: Milano, Roma, Palermo
  const rif = ["Milano", "Roma", "Palermo"].map((n) => punti.find((p) => p.nome === n));
  const tendenza = (rif[0]?.tend ?? []).map((t: any, k: number) => ({ d: t.d, righe: rif.map((p, i) => ({ zona: ["Nord", "Centro", "Sud"][i], citta: p.nome, cod: p.tend[k]?.cod, max: p.tend[k]?.max, mm: p.tend[k]?.mm })) }));

  // differenze ICON-2I / ECMWF
  const differenze: any[] = [];
  for (const p of citta) {
    if (!p.icon_ok || !p.ecm) continue;
    const note: string[] = []; let peso = 0;
    if (p.max != null && p.ecm.max != null && Math.abs(p.max - p.ecm.max) >= 3) { note.push(`massima ICON-2I ${r0(p.max)} °C, ECMWF ${r0(p.ecm.max)} °C`); peso += Math.abs(p.max - p.ecm.max); }
    if ((p.mm >= 1) !== (p.ecm.mm >= 1) && Math.max(p.mm, p.ecm.mm) >= 2) { note.push(`ICON-2I ${p.mm < 0.1 ? "asciutto" : virg(p.mm) + " mm"}, ECMWF ${p.ecm.mm < 0.1 ? "asciutto" : virg(p.ecm.mm) + " mm"}`); peso += Math.abs(p.mm - p.ecm.mm); }
    if (note.length) differenze.push({ citta: p.nome, testo: note.join("; "), peso });
  }
  differenze.sort((a, b) => b.peso - a.peso);

  const riga: any = {
    giorno, punti, kpi, regioni, zone, tendenza, differenze: differenze.slice(0, 8), allerte: allerte ?? { regioni: [] },
    fonti: "ItaliaMeteo-ARPAE ICON-2I ed ECMWF IFS (CC BY 4.0) via Open-Meteo; Dipartimento della Protezione Civile, bollettino di criticità (CC BY 4.0)",
    aggiornato_il: new Date().toISOString(),
  };
  for (const k of ["titolo", "sottotitolo", "reel_url", "cover_url"]) riga[k] = body[k] ?? prima?.[k] ?? null;
  const avvisi: string[] = [];
  for (const [k, nome] of [["reel_url", "reel.mp4"], ["cover_url", "cover.jpg"]] as const) {
    const u = riga[k];
    if (!u || u.startsWith(SU)) continue;
    try {
      const r = await fetch(u);
      if (!r.ok) throw new Error(`HTTP ${r.status}`);
      const tipo = r.headers.get("content-type") ?? (nome.endsWith(".mp4") ? "video/mp4" : "image/jpeg");
      const path = `meteo/${giorno}/${nome}`;
      const { error: e } = await db.storage.from("media").upload(path, await r.blob(), { upsert: true, contentType: tipo, cacheControl: "31536000" });
      if (e) throw new Error(e.message);
      riga[k] = `${SU}/storage/v1/object/public/media/${path}`;
    } catch (e) { avvisi.push(`${k} non copiato: ${String((e as Error)?.message ?? e)}`); }
  }
  const { error } = await db.from("meteo_giorni").upsert(riga, { onConflict: "giorno" });
  if (error) return j({ errore: "upsert", dettaglio: error.message }, 500);
  return j({ ok: true, giorno, avvisi, punti: punti.length, senza_icon: citta.filter((p) => !p.icon_ok).map((p) => p.nome), kpi, url: `https://iattualita.it/meteo/${giorno.slice(8, 10)}-${giorno.slice(5, 7)}-${giorno.slice(2, 4)}` });
  } catch (e) {
    return j({ errore: "elaborazione", dettaglio: String((e as Error)?.message ?? e) }, 502);
  }
});
