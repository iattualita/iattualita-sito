import json, sys, unicodedata, re, collections
# Genera meteo-comuni.json (per il sito: ricerca, pagine dei comuni, sitemap), meteo-comuni-punti.json
# (coordinate, lo legge una volta la funzione Supabase meteo-comuni per riempire la tabella)
# Uso:
#   python3 -I scripts/meteo-comuni.py comuni.json shared/meteo-geo.js
# comuni.json: Samurai016/Comuni-ITA (data/comuni.json), elenco ISTAT con coordinate e popolazione.
src, geo = sys.argv[1], sys.argv[2]
C = json.load(open(src))
G = open(geo).read()
REG = json.loads(re.search(r"export const METEO_REGIONI = (\[.*?\]);\n", G, re.S).group(1))
def slug(n): return re.sub(r"[^a-z]+", "-", unicodedata.normalize("NFD", n).encode("ascii", "ignore").decode().lower()).strip("-")
def k(n): return re.sub(r"[^a-z]", "", unicodedata.normalize("NFD", n).encode("ascii", "ignore").decode().lower())
NOMIREG = {k(r["nome"]): r["slug"] for r in REG}
NOMIREG.update({k("Emilia Romagna"): "emilia-romagna", k("Trentino Alto Adige"): "trentino-alto-adige", k("Friuli Venezia Giulia"): "friuli-venezia-giulia"})
# capoluoghi del sito con nome diverso dall'ISTAT
ALIAS = {"Reggio Calabria": "Reggio di Calabria", "Reggio Emilia": "Reggio nell'Emilia", "Forlì": "Forlì", "Pesaro": "Pesaro", "Monza": "Monza", "Barletta": "Barletta", "Tortolì": "Tortolì", "Sanluri": "Sanluri", "Carbonia": "Carbonia", "Olbia": "Olbia", "Bolzano": "Bolzano", "Aosta": "Aosta"}
out = []
for x in C:
    r = NOMIREG[k(x["provincia"]["regione"])]
    out.append({"codice": x["codice"], "nome": x["nome"], "reg": r, "prov": x["provincia"]["sigla"], "pop": x.get("popolazione") or 0,
                "lat": round(x["coordinate"]["lat"], 4), "lon": round(x["coordinate"]["lng"], 4)})
# capoluoghi
capi = {}
for r in REG:
    for c in r["citta"]:
        n = ALIAS.get(c, c)
        m = [o for o in out if o["reg"] == r["slug"] and k(o["nome"]) == k(n)]
        if not m: m = [o for o in out if o["reg"] == r["slug"] and k(o["nome"]).startswith(k(n))]
        assert m, (c, r["slug"])
        m[0]["cap"] = c; capi[c] = m[0]["codice"]
# slug unici per regione (omonimi: si aggiunge la sigla della provincia)
cnt = collections.Counter((o["reg"], slug(o["nome"])) for o in out)
for o in out:
    s = slug(o["nome"])
    o["slug"] = slug(o["cap"]) if o.get("cap") else (s if cnt[(o["reg"], s)] == 1 else s + "-" + o["prov"].lower())
assert len({(o["reg"], o["slug"]) for o in out}) == len(out)
# per il sito: [nome, regione (indice), sigla, slug se diverso da quello derivato dal nome, capoluogo 0/1]
ri = {r["slug"]: i for i, r in enumerate(REG)}
web = [[o["nome"], ri[o["reg"]], o["prov"], (o["slug"] if o["slug"] != slug(o["nome"]) else 0), 1 if o.get("cap") else 0] for o in sorted(out, key=lambda o: (ri[o["reg"]], o["nome"]))]
json.dump({"regioni": [r["slug"] for r in REG], "comuni": web}, open("meteo-comuni.json", "w"), ensure_ascii=False, separators=(",", ":"))
json.dump([{k2: o.get(k2) for k2 in ("codice","nome","slug","reg","prov","pop","lat","lon")} | {"cap": bool(o.get("cap"))} for o in out], open("meteo-comuni-punti.json", "w"), ensure_ascii=False, separators=(",", ":"))
print(len(out), "comuni,", sum(1 for o in out if o.get("cap")), "capoluoghi")
