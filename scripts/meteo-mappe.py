import json, math, unicodedata
# Rigenera meteo-mappe.json e i dati di shared/meteo-geo.js. Uso:
#   python3 scripts/meteo-mappe.py regioni.geojson comuni.json
# regioni.geojson: openpolis/geojson-italy (geojson/limits_IT_regions.geojson)
# comuni.json: MatteoHenryChinaski/Comuni-Italiani-2018-Sql-Json-excel (italy_geo.json)
# Scrive geo.json (tutto) nella cartella corrente: da li' si ricavano meteo-mappe.json
# (contorni e posizioni) e METEO_REGIONI in shared/meteo-geo.js, e i PUNTI della
# funzione supabase/functions/meteo-sito/punti.ts.
import sys
G=json.load(open(sys.argv[1]))
C=json.load(open(sys.argv[2]))
def norm(s): return unicodedata.normalize('NFKD',s).encode('ascii','ignore').decode().lower().split('/')[0].strip()
cidx={}
for c in C:
    if 'comune' in c: cidx.setdefault(norm(c['comune']),[]).append(c)
REG=[ # slug, nome, nome geojson prefix, zona, capoluogo regione, province
("piemonte","Piemonte","Piemonte","Nord","Torino",["Torino","Alessandria","Asti","Biella","Cuneo","Novara","Verbania","Vercelli"]),
("valle-daosta","Valle d'Aosta","Valle d'Aosta","Nord","Aosta",["Aosta"]),
("lombardia","Lombardia","Lombardia","Nord","Milano",["Milano","Bergamo","Brescia","Como","Cremona","Lecco","Lodi","Mantova","Monza","Pavia","Sondrio","Varese"]),
("trentino-alto-adige","Trentino-Alto Adige","Trentino","Nord","Trento",["Trento","Bolzano"]),
("veneto","Veneto","Veneto","Nord","Venezia",["Venezia","Belluno","Padova","Rovigo","Treviso","Verona","Vicenza"]),
("friuli-venezia-giulia","Friuli-Venezia Giulia","Friuli","Nord","Trieste",["Trieste","Gorizia","Pordenone","Udine"]),
("liguria","Liguria","Liguria","Nord","Genova",["Genova","Imperia","La Spezia","Savona"]),
("emilia-romagna","Emilia-Romagna","Emilia","Nord","Bologna",["Bologna","Ferrara","Forlì","Modena","Parma","Piacenza","Ravenna","Reggio nell'Emilia","Rimini"]),
("toscana","Toscana","Toscana","Centro","Firenze",["Firenze","Arezzo","Grosseto","Livorno","Lucca","Massa","Pisa","Pistoia","Prato","Siena"]),
("umbria","Umbria","Umbria","Centro","Perugia",["Perugia","Terni"]),
("marche","Marche","Marche","Centro","Ancona",["Ancona","Pesaro","Macerata","Fermo","Ascoli Piceno"]),
("lazio","Lazio","Lazio","Centro","Roma",["Roma","Frosinone","Latina","Rieti","Viterbo"]),
("abruzzo","Abruzzo","Abruzzo","Centro","L'Aquila",["L'Aquila","Chieti","Pescara","Teramo"]),
("molise","Molise","Molise","Sud e isole","Campobasso",["Campobasso","Isernia"]),
("campania","Campania","Campania","Sud e isole","Napoli",["Napoli","Avellino","Benevento","Caserta","Salerno"]),
("puglia","Puglia","Puglia","Sud e isole","Bari",["Bari","Barletta","Brindisi","Foggia","Lecce","Taranto"]),
("basilicata","Basilicata","Basilicata","Sud e isole","Potenza",["Potenza","Matera"]),
("calabria","Calabria","Calabria","Sud e isole","Catanzaro",["Catanzaro","Cosenza","Crotone","Reggio di Calabria","Vibo Valentia"]),
("sicilia","Sicilia","Sicilia","Sud e isole","Palermo",["Palermo","Agrigento","Caltanissetta","Catania","Enna","Messina","Ragusa","Siracusa","Trapani"]),
("sardegna","Sardegna","Sardegna","Sud e isole","Cagliari",["Cagliari","Sassari","Nuoro","Oristano","Olbia","Tortolì","Carbonia","Sanluri"]),
]
NOMEVIS={"Reggio nell'Emilia":"Reggio Emilia","Reggio di Calabria":"Reggio Calabria"}
VICINE={"piemonte":["valle-daosta","lombardia","liguria","emilia-romagna"],"valle-daosta":["piemonte"],
"lombardia":["piemonte","trentino-alto-adige","veneto","emilia-romagna"],"trentino-alto-adige":["lombardia","veneto"],
"veneto":["trentino-alto-adige","friuli-venezia-giulia","lombardia","emilia-romagna"],"friuli-venezia-giulia":["veneto"],
"liguria":["piemonte","emilia-romagna","toscana"],"emilia-romagna":["lombardia","veneto","piemonte","liguria","toscana","marche"],
"toscana":["liguria","emilia-romagna","umbria","marche","lazio"],"umbria":["toscana","marche","lazio"],
"marche":["emilia-romagna","toscana","umbria","lazio","abruzzo"],"lazio":["toscana","umbria","marche","abruzzo","molise","campania"],
"abruzzo":["marche","lazio","molise"],"molise":["abruzzo","lazio","campania","puglia"],"campania":["lazio","molise","puglia","basilicata"],
"puglia":["molise","campania","basilicata"],"basilicata":["campania","puglia","calabria"],"calabria":["basilicata","sicilia"],
"sicilia":["calabria"],"sardegna":["lazio","toscana"]}
# projection
LAT0=42.0; K=math.cos(math.radians(LAT0))
def proj(lon,lat): return (lon*K, -lat)
def feat(prefix):
    for f in G['features']:
        if f['properties']['reg_name'].startswith(prefix): return f
def rings(f):
    g=f['geometry']; P=g['coordinates'] if g['type']=='MultiPolygon' else [g['coordinates']]
    return [p[0] for p in P]  # outer rings only
def area(r):
    a=0
    for i in range(len(r)-1): a+=r[i][0]*r[i+1][1]-r[i+1][0]*r[i][1]
    return abs(a)/2
def dp(pts,eps):
    if len(pts)<3: return pts
    a,b=pts[0],pts[-1]; dx,dy=b[0]-a[0],b[1]-a[1]; L=math.hypot(dx,dy) or 1e-12
    imax,dmax=0,0
    for i in range(1,len(pts)-1):
        p=pts[i]; d=abs(dy*(p[0]-a[0])-dx*(p[1]-a[1]))/L if L>1e-12 else math.hypot(p[0]-a[0],p[1]-a[1])
        if d>dmax: imax,dmax=i,d
    if dmax>eps: return dp(pts[:imax+1],eps)[:-1]+dp(pts[imax:],eps)
    return [a,b]
def dpring(r,eps):
    # split at farthest point from r[0]
    r=r[:-1] if r[0]==r[-1] else r
    far=max(range(len(r)),key=lambda i:(r[i][0]-r[0][0])**2+(r[i][1]-r[0][1])**2)
    a=dp(r[:far+1],eps); b=dp(r[far:]+[r[0]],eps)
    return a[:-1]+b[:-1]
def build(prefixes, W, H, pad, eps_px, minarea_px, fit=False):
    allr={p:[[proj(*pt) for pt in ring] for ring in rings(feat(p))] for p in prefixes}
    xs=[x for rr in allr.values() for r in rr for x,y in r]; ys=[y for rr in allr.values() for r in rr for x,y in r]
    x0,x1,y0,y1=min(xs),max(xs),min(ys),max(ys)
    if fit:
        H=int(max(320,min(720,(W-2*pad)*(y1-y0)/(x1-x0)+2*pad)))
    s=min((W-2*pad)/(x1-x0),(H-2*pad)/(y1-y0))
    ox=(W-(x1-x0)*s)/2; oy=(H-(y1-y0)*s)/2
    T=lambda x,y:((x-x0)*s+ox,(y-y0)*s+oy)
    out={}
    for p,rr in allr.items():
        d=[]
        for r in rr:
            pr=[T(*q) for q in r]
            if area(pr+[pr[0]])<minarea_px: continue
            sm=dpring(pr,eps_px)
            if len(sm)<3: continue
            d.append("M"+"L".join(f"{x:.0f} {y:.0f}" for x,y in sm)+"Z")
        out[p]="".join(d)
    def pt(lon,lat):
        x,y=T(*proj(lon,lat)); return [round(x/W*100,1),round(y/H*100,1)]
    return out,pt,(W,H)
W,H=567,666
itmap,itpt,_=build([r[2] for r in REG],W,H,8,0.9,6)
punti=[];regioni=[]
for slug,nome,pref,zona,cap,prov in REG:
    rmap,rpt,rwh=build([pref],600,600,40,1.1,20,fit=True)
    ps=[]
    for n in prov:
        cands=cidx.get(norm(n))
        assert cands, n
        c=cands[0]
        lat,lon=float(c['lat']),float(c['lng'])
        vis=NOMEVIS.get(n,n)
        ps.append(vis)
        punti.append({"nome":vis,"regione":slug,"zona":zona,"lat":round(lat,3),"lon":round(lon,3),"capoluogo":n==cap,"it":itpt(lon,lat),"rg":rpt(lon,lat)})
    regioni.append({"slug":slug,"nome":nome,"zona":zona,"capoluogo":NOMEVIS.get(cap,cap),"citta":ps,"vicine":VICINE[slug],"d":itmap[pref],"mappa":rmap[pref],"vb":list(rwh)})
for n,lat,lon,slug in [("Campo Imperatore",42.443,13.558,"abruzzo"),("Abetone",44.143,10.663,"toscana")]:
    punti.append({"nome":n,"regione":slug,"zona":"Centro","lat":lat,"lon":lon,"montagna":True})

def relax(items,key,outkey,Wpx,Hpx,cw,ch):
    # items: dicts with [key]=[x%,y%]; place labels avoiding overlap, near true point
    P=[[it[key][0]/100*Wpx,it[key][1]/100*Hpx] for it in items]; O=[p[:] for p in P]
    for _ in range(400):
        moved=False
        for i in range(len(P)):
            for j in range(i+1,len(P)):
                dx=P[j][0]-P[i][0]; dy=P[j][1]-P[i][1]
                ox=cw-abs(dx); oy=ch-abs(dy)
                if ox>0 and oy>0:
                    moved=True
                    if ox/cw < oy/ch:
                        sgn=1 if dx>=0 else -1; P[i][0]-=sgn*ox/2; P[j][0]+=sgn*ox/2
                    else:
                        sgn=1 if dy>=0 else -1; P[i][1]-=sgn*oy/2; P[j][1]+=sgn*oy/2
        for k in range(len(P)):
            P[k][0]=min(max(P[k][0],cw/2),Wpx-cw/2); P[k][1]=min(max(P[k][1],ch/2),Hpx-ch/2)
        if not moved: break
    for it,p in zip(items,P): it[outkey]=[round(p[0]/Wpx*100,1),round(p[1]/Hpx*100,1)]
pidx={p['nome']:p for p in punti}
caps=[pidx[r['capoluogo']] for r in regioni]
relax(caps,'it','itl',540,540*666/567,74,36)
for r in regioni:
    W2,H2=r['vb']; wpx=520; hpx=wpx*H2/W2
    relax([pidx[c] for c in r['citta']],'rg','rgl',wpx,hpx,96,40)
json.dump({"regioni":regioni,"punti":punti},open('geo.json','w'),ensure_ascii=False)
print(len(punti), sum(len(r['d']) for r in regioni), sum(len(r['mappa']) for r in regioni))
for p in punti[:3]+punti[-4:]: print(p)
