// ====== METEO: /meteo, /meteo/gg-mm-aa, /meteo/<regione> ======
// Dal 27/11/2026 la pagina meteo non e' piu' l'elenco degli articoli "Meteo
// della settimana": e' un hub che si aggiorna da solo ogni mattina. I dati li
// scrive la edge function Supabase "meteo-sito" nella tabella meteo_giorni
// (una riga per giorno), chiamata dal routine del reel dopo la pubblicazione.
// Qui si legge soltanto (RLS: lettura pubblica). Mockup approvato da Andre'.
import { METEO_REGIONI, regioneDaSlug, giornoDaUrl, urlDaGiorno, cittaSlug, cittaDaSlug, urlCitta } from "./shared/meteo-geo.js";

// Contorni delle regioni e posizioni delle etichette: ~70 KB che servono solo
// qui, quindi stanno in un file a parte e non nel bundle di tutto il sito.
let GEO=null, GEO_P=null;
function caricaGeo(){ if(GEO) return Promise.resolve(GEO); if(!GEO_P) GEO_P=fetch("/meteo-mappe.json").then(r=>{ if(!r.ok) throw new Error("mappe "+r.status); return r.json(); }).then(j=>(GEO=j)).catch(e=>{ GEO_P=null; throw e; }); return GEO_P; }

const { useState, useEffect, useRef } = React;

const SUPA = "https://wzkshpgakvasqwrrgkgd.supabase.co";
const KEY = "sb_publishable_I3s4phA5Be9qnV4pLbWQMQ_8-IGUE-b";
const M = { bg:"#F4F6FA", navy:"#16243F", ink:"#0F1A2E", soft:"#33415C", gray:"#5B6880", blue:"#0047AB", rain:"#2F6FD0", gold:"#D8B472", line:"#E3E8F1", green:"#E8F1E8", greenInk:"#1B5E32", yellow:"#FFF6D6", yellowInk:"#7A5A00" };
const INSTAGRAM = "https://www.instagram.com/meteo.iattualita/";
const ZONE = ["Nord","Centro","Sud e isole"];
const GIORNI = ["domenica","lunedì","martedì","mercoledì","giovedì","venerdì","sabato"];
const MESI = ["gennaio","febbraio","marzo","aprile","maggio","giugno","luglio","agosto","settembre","ottobre","novembre","dicembre"];
const BUSSOLA = ["Nord","Nord-Est","Est","Sud-Est","Sud","Sud-Ovest","Ovest","Nord-Ovest"];
const DESC = {0:"Sereno",1:"Poco nuvoloso",2:"Nuvoloso",3:"Coperto",45:"Nebbia",48:"Nebbia gelata",51:"Pioviggine debole",53:"Pioviggine",55:"Pioviggine forte",56:"Pioviggine gelata",57:"Pioviggine gelata",61:"Pioggia debole",63:"Pioggia",65:"Pioggia forte",66:"Pioggia gelata",67:"Pioggia gelata",71:"Neve debole",73:"Neve",75:"Neve forte",77:"Granelli di neve",80:"Rovesci deboli",81:"Rovesci",82:"Rovesci forti",85:"Rovesci di neve",86:"Rovesci di neve",95:"Temporale",96:"Temporale con grandine",99:"Temporale con grandine"};

const cap = (s)=>s? s.charAt(0).toUpperCase()+s.slice(1):s;
const dt = (g)=>new Date(g+"T12:00:00");
const dataLunga = (g)=>{ const d=dt(g); return GIORNI[d.getDay()]+" "+d.getDate()+" "+MESI[d.getMonth()]+" "+d.getFullYear(); };
const dataBreve = (g)=>{ const d=dt(g); return d.getDate()+" "+MESI[d.getMonth()]; };
const nomeGiorno = (g)=>cap(GIORNI[dt(g).getDay()]);
const breve = (g)=>g.slice(8,10)+"-"+g.slice(5,7)+"-"+g.slice(2,4);
const virg = (x,d=1)=>x==null?"–":(Math.round(x*Math.pow(10,d))/Math.pow(10,d)).toFixed(Math.abs(x)>=10&&d===1&&Math.round(x)===x?0:d).replace(".",",").replace("-","−");
const int = (x)=>x==null?"–":String(Math.round(x)).replace("-","−");
const mm = (x)=>x>=0.1? virg(x)+" mm" : "asciutto";
const bussola = (d)=>d==null?"":BUSSOLA[Math.round(d/45)%8];
const pioggiaCol = (x)=> x<0.5?"#DCE6F5": x<=2?"#BFD3EE": x<=10?"#8FB2E3":"#3F77C8";
const a_ = (n)=>(/^[AEIOU]/i.test(n)?"ad ":"a ")+n;
const regNome = (slug)=>(regioneDaSlug(slug)||{}).nome||slug;

async function leggi(q){
  const r=await fetch(SUPA+"/rest/v1/meteo_giorni?"+q,{headers:{apikey:KEY}});
  if(!r.ok) throw new Error("meteo "+r.status);
  return r.json();
}

// ---------- pezzi grafici ----------
function Icona({cod,s=24,notte=false}){
  const c=cod==null?-1:cod;
  const luna=notte&&(c===0||c===1);
  const sun=c===0&&!luna, part=c===1&&!luna, cloud=c===2||c===3, fog=c===45||c===48, snow=(c>=71&&c<=77)||c===85||c===86;
  const storm=c>=95, rain=!snow&&((c>=51&&c<=67)||(c>=80&&c<=82));
  return <svg viewBox="0 0 24 24" width={s} height={s} aria-hidden="true" style={{flexShrink:0}}>
    {sun&&<circle cx="12" cy="12" r="5.5" fill="#F2B01E"/>}
    {part&&<g><circle cx="9" cy="9" r="4.5" fill="#F2B01E"/><path d="M8 19h9a3.6 3.6 0 0 0 .4-7.2A5 5 0 0 0 8.2 11 4 4 0 0 0 8 19z" fill="#AEB9CC"/></g>}
    {cloud&&<path d="M7 18h10a4 4 0 0 0 .5-7.97A5.5 5.5 0 0 0 7 9.5 4.25 4.25 0 0 0 7 18z" fill="#97A4BC"/>}
    {fog&&<path d="M4 8h16M3 12h18M5 16h14M8 20h8" stroke="#8D9BB5" strokeWidth="2" strokeLinecap="round"/>}
    {(rain||storm)&&<g><path d="M7 14h10a3.6 3.6 0 0 0 .4-7.2A5 5 0 0 0 7.2 6 4 4 0 0 0 7 14z" fill="#6F7F9C"/>{storm?<path d="M12 14l-2 4h3l-2 4" stroke="#F2B01E" strokeWidth="2" fill="none" strokeLinecap="round" strokeLinejoin="round"/>:<path d="M8 17l-1 3M12 17l-1 3M16 17l-1 3" stroke="#2F6FD0" strokeWidth="2" strokeLinecap="round"/>}</g>}
    {snow&&<g><path d="M7 14h10a3.6 3.6 0 0 0 .4-7.2A5 5 0 0 0 7.2 6 4 4 0 0 0 7 14z" fill="#97A4BC"/><circle cx="8" cy="18" r="1.4" fill="#2F6FD0"/><circle cx="12" cy="20" r="1.4" fill="#2F6FD0"/><circle cx="16" cy="18" r="1.4" fill="#2F6FD0"/></g>}
    {luna&&<path d={c===0?"M15.5 4.5a7.5 7.5 0 1 0 4 13.6A8.5 8.5 0 0 1 15.5 4.5z":"M12.5 3.5a6 6 0 1 0 3.2 10.9A6.8 6.8 0 0 1 12.5 3.5z"} fill="#7C8DB0"/>}
    {luna&&c===1&&<path d="M9 20h9a3.6 3.6 0 0 0 .4-7.2A5 5 0 0 0 9.2 12 4 4 0 0 0 9 20z" fill="#AEB9CC"/>}
    {c<0&&<circle cx="12" cy="12" r="3" fill="#CBD3E1"/>}
  </svg>;
}

// Mattina / pomeriggio / sera di una citta' (campo fasce, da meteo-sito; i giorni vecchi non ce l'hanno).
const NOMEF={mattina:"Mattina",pomeriggio:"Pomeriggio",sera:"Sera"};
function Fasce({p}){
  if(!Array.isArray(p.fasce)||!p.fasce.length) return null;
  return <div style={{display:"grid",gridTemplateColumns:"repeat(3,1fr)",gap:8,marginTop:4}}>
    {p.fasce.map(x=><div key={x.f} title={NOMEF[x.f]+": "+(DESC[x.cod]||"")+(x.mm>=0.5?", "+virg(x.mm)+" mm":"")} style={{background:M.bg,borderRadius:10,padding:"8px 10px",display:"flex",flexDirection:"column",gap:3}}>
      <span style={{fontSize:12,fontWeight:700,letterSpacing:".06em",color:M.gray,textTransform:"uppercase"}}>{NOMEF[x.f]}</span>
      <span style={{display:"flex",alignItems:"center",gap:6}}><Icona cod={x.cod} s={24} notte={x.f==="sera"}/><span style={{fontSize:17,fontWeight:700,color:M.ink}}>{int(x.t)}°</span></span>
      <span style={{fontSize:12.5,color:x.mm>=0.5?M.rain:M.gray,fontWeight:x.mm>=0.5?700:500}}>{x.mm>=0.5?virg(x.mm)+" mm":(DESC[x.cod]||"")}</span>
    </div>)}
  </div>;
}

// Le etichette sono disegnate per una mappa larga ~540 px: sotto quella
// misura si rimpiccioliscono insieme alla mappa, invece di accavallarsi.
function useScala(ref,base){
  const [s,setS]=useState(1);
  useEffect(()=>{ const el=ref.current; if(!el) return; const f=()=>setS(Math.min(1.15,Math.max(.62,el.clientWidth/base)));
    f(); if(typeof ResizeObserver==="undefined"){ window.addEventListener("resize",f); return ()=>window.removeEventListener("resize",f); }
    const o=new ResizeObserver(f); o.observe(el); return ()=>o.disconnect(); },[]);
  return s;
}

function Link({href,onNav,style,children,title}){
  return <a href={href} title={title} onClick={e=>{ if(e.metaKey||e.ctrlKey||e.shiftKey||e.altKey||e.button!==0) return; e.preventDefault(); onNav(href); }} style={style}>{children}</a>;
}

const h2 = {margin:0,fontFamily:"Anton",fontWeight:400,fontSize:"clamp(26px,4.2vw,36px)",color:M.navy,letterSpacing:.2};
const card = {background:"#fff",borderRadius:16,padding:"20px 22px",boxSizing:"border-box"};
const kicker = {fontSize:13.5,fontWeight:700,letterSpacing:".12em",color:M.blue,textTransform:"uppercase"};
const h1 = {margin:0,fontFamily:"Anton",fontWeight:400,fontSize:"clamp(36px,6.4vw,64px)",lineHeight:1.05,color:M.navy};
const lead = {margin:0,fontSize:"clamp(17px,2.2vw,20px)",lineHeight:1.5,color:M.soft,maxWidth:760};
const pill = (on,col=M.blue)=>({border:"2px solid "+col,borderRadius:999,padding:"8px 16px",fontSize:15,fontWeight:700,cursor:"pointer",background:on?col:"#fff",color:on?"#fff":col,fontFamily:"Barlow"});

function Intestazione({titolo,sotto,children}){
  return <div style={{display:"flex",flexWrap:"wrap",justifyContent:"space-between",alignItems:"baseline",gap:"6px 16px"}}><h2 style={h2}>{titolo}</h2>{sotto&&<span style={{fontSize:15,color:M.gray}}>{sotto}</span>}{children}</div>;
}

function Allerte({riga,slug}){
  const a=(riga.allerte&&riga.allerte.regioni)||[];
  const lista=slug? a.filter(x=>x.slug===slug) : a;
  if(riga.allerte&&riga.allerte.errore&&!a.length) return null;
  if(!lista.length) return <div style={{background:M.green,borderRadius:16,padding:"16px 22px",display:"flex",flexDirection:"column",gap:4}}>
    <span style={{fontSize:13.5,fontWeight:700,letterSpacing:".08em",color:M.greenInk}}>ALLERTE DELLA PROTEZIONE CIVILE</span>
    <span style={{fontSize:17,color:"#1F3326"}}>{slug?"Nessuna allerta per oggi in questa regione.":"Nessuna regione in allerta oggi."}</span>
  </div>;
  const liv=(x)=>x.livello||"gialla";
  const col={gialla:"#E8B500",arancione:"#E07B00",rossa:"#E2231A"};
  return <div style={{background:M.yellow,borderRadius:16,padding:"16px 22px",display:"flex",flexDirection:"column",gap:8}}>
    <span style={{fontSize:13.5,fontWeight:700,letterSpacing:".08em",color:M.yellowInk}}>ALLERTE DELLA PROTEZIONE CIVILE</span>
    <span style={{fontSize:17,color:"#3D2E00"}}>{slug? "Allerta "+liv(lista[0])+" per oggi." : (lista.length===1?"Una regione":lista.length+" regioni")+" in allerta oggi:"}</span>
    {!slug&&<div style={{display:"flex",flexWrap:"wrap",gap:8}}>{lista.map(x=><span key={x.regione} style={{display:"inline-flex",alignItems:"center",gap:6,background:"#fff",borderRadius:999,padding:"5px 12px",fontSize:15,fontWeight:600,color:M.navy}}><span style={{width:10,height:10,borderRadius:"50%",background:col[liv(x)]||col.gialla}}/>{x.regione}</span>)}</div>}
    {slug&&lista[0].testo&&<span style={{fontSize:15,color:"#3D2E00",lineHeight:1.5}}>{lista[0].testo}</span>}
    <span style={{fontSize:13,color:M.yellowInk}}>Fonte: bollettino di criticità del Dipartimento della Protezione Civile. Per gli aggiornamenti seguite i canali ufficiali della vostra Regione.</span>
  </div>;
}

function Grafico({punti,scelte,iniziale,nota,onCambia}){
  const [c,setC0]=useState(iniziale);
  const setC=(n)=>{ setC0(n); onCambia&&onCambia(n); };
  const p=punti.find(x=>x.nome===c)||punti[0];
  if(!p) return null;
  const arr=(p.ore||[]).map(v=>v||0);
  const mx=Math.max(0,...arr), tot=arr.reduce((a,b)=>a+b,0);
  const altri=punti.filter(x=>scelte.indexOf(x.nome)<0);
  return <div style={{display:"flex",flexDirection:"column",gap:14}}>
    <Intestazione titolo="Quando piove, ora per ora">
      <div style={{display:"flex",flexWrap:"wrap",gap:8,alignItems:"center"}}>
        {scelte.map(n=><button key={n} onClick={()=>setC(n)} style={pill(c===n)}>{n}</button>)}
        {altri.length>0&&<select value={scelte.indexOf(c)<0?c:""} onChange={e=>e.target.value&&setC(e.target.value)} aria-label="Scegli un'altra città" style={{border:"2px solid "+M.blue,borderRadius:999,padding:"8px 12px",fontSize:15,fontWeight:700,color:M.blue,background:"#fff",fontFamily:"Barlow"}}>
          <option value="">Altra città…</option>
          {altri.map(x=><option key={x.nome} value={x.nome}>{x.nome}</option>)}
        </select>}
      </div>
    </Intestazione>
    <div style={{...card,padding:24,display:"flex",flexDirection:"column",gap:12}}>
      <div style={{display:"flex",flexWrap:"wrap",gap:"6px 22px",alignItems:"baseline"}}>
        <span style={{fontFamily:"Anton",fontSize:30,color:M.navy}}>{p.nome}</span>
        <span style={{fontSize:17,color:M.soft}}>Totale della giornata: <b>{mm(tot)}</b>{mx>0&&<React.Fragment> · picco alle <b>{String(arr.indexOf(mx)).padStart(2,"0")}:00</b> ({virg(mx)} mm)</React.Fragment>}</span>
      </div>
      <div role="img" aria-label={"Pioggia ora per ora a "+p.nome+": totale "+mm(tot)} style={{display:"flex",alignItems:"flex-end",gap:"clamp(1px,.4vw,4px)",height:190,borderBottom:"2px solid #CBD3E1"}}>
        {arr.map((v,i)=><div key={i} title={String(i).padStart(2,"0")+":00 · "+virg(v)+" mm"} style={{flex:"1 1 0",minWidth:0,height:"100%",display:"flex",alignItems:"flex-end"}}>
          <div style={{width:"100%",borderRadius:"4px 4px 0 0",background:M.rain,height:(mx>0?Math.max(v/mx*100,v>0?3:0):0)+"%"}}/>
        </div>)}
      </div>
      <div style={{display:"flex",justifyContent:"space-between",fontSize:13,color:M.gray,fontWeight:600}}>{["00","04","08","12","16","20","23"].map(x=><span key={x}>{x}</span>)}</div>
      {mx===0&&<span style={{fontSize:15,color:M.soft}}>Nessuna pioggia prevista a {p.nome}.</span>}
      <span style={{fontSize:13.5,color:M.gray}}>{nota||"Millimetri di pioggia per ora, modello ICON-2I."}</span>
    </div>
  </div>;
}

function Fonti({riga}){
  const ora=riga.aggiornato_il? new Date(riga.aggiornato_il).toLocaleString("it-IT",{timeZone:"Europe/Rome",day:"numeric",month:"long",hour:"2-digit",minute:"2-digit"}):null;
  return <footer style={{borderTop:"1px solid #CBD3E1",paddingTop:18,fontSize:14,lineHeight:1.6,color:M.gray,maxWidth:820}}>
    Fonti: ItaliaMeteo-ARPAE ICON-2I ed ECMWF IFS (CC BY 4.0) via Open-Meteo; Dipartimento della Protezione Civile, bollettino di criticità (CC BY 4.0).{ora&&" Dati elaborati il "+ora+"."} Le previsioni oltre le 48 ore sono una tendenza e possono cambiare: per le decisioni di sicurezza seguite sempre gli avvisi ufficiali.
  </footer>;
}

function Segui(){
  return <section style={{display:"flex",flexWrap:"wrap",gap:16,alignItems:"center",background:M.navy,color:"#fff",borderRadius:16,padding:"24px 28px"}}>
    <div style={{flex:"1 1 320px",display:"flex",flexDirection:"column",gap:6}}>
      <span style={{fontFamily:"Anton",fontSize:26}}>Il meteo di ogni mattina, in un video</span>
      <span style={{fontSize:17,lineHeight:1.5,opacity:.9}}>Ogni giorno alle 7:30 su Instagram e Facebook, con Lorenzo. Questa pagina si aggiorna da sola con i dati del mattino.</span>
    </div>
    <a href={INSTAGRAM} target="_blank" rel="noopener" style={{background:M.gold,color:M.navy,textDecoration:"none",fontWeight:700,fontSize:17,padding:"14px 24px",borderRadius:10}}>Segui MeteoIAttualità</a>
  </section>;
}

function Stato({testo,errore,onRiprova}){
  return <div style={{...card,textAlign:"center",padding:"36px 20px"}}>
    <div style={{fontFamily:"Anton",fontSize:24,color:M.navy,marginBottom:8}}>{testo}</div>
    {errore&&<button onClick={onRiprova} style={pill(false)}>Riprova</button>}
  </div>;
}


// Condividi: sul telefono il menu nativo (WhatsApp, Instagram, Telegram...), sul
// computer WhatsApp, Facebook e "Copia link". Si condivide sempre un indirizzo che
// non cambia (il giorno o la regione), non /meteo che domani mostra un altro meteo.
function Condividi({url,testo,scuro}){
  const [aperto,setAperto]=useState(false);
  const [copiato,setCopiato]=useState(false);
  const pieno="https://iattualita.it"+url;
  const btn={display:"inline-flex",alignItems:"center",gap:8,background:scuro?"rgba(255,255,255,.12)":"#fff",color:scuro?"#fff":M.navy,border:"2px solid "+(scuro?"rgba(255,255,255,.5)":M.navy),borderRadius:10,padding:"10px 18px",fontWeight:700,fontSize:16,cursor:"pointer",fontFamily:"Barlow"};
  const copia=()=>{ const ok=()=>{ setCopiato(true); setTimeout(()=>setCopiato(false),2000); };
    try{ navigator.clipboard.writeText(pieno).then(ok,ok); }catch(e){ ok(); } };
  const clic=()=>{
    if(navigator.share&&/Android|iPhone|iPad|iPod|Mobile/i.test(navigator.userAgent)){ navigator.share({title:testo,text:testo,url:pieno}).catch(()=>{}); return; }
    setAperto(a=>!a);
  };
  const voce={display:"flex",alignItems:"center",gap:8,padding:"10px 14px",borderRadius:8,textDecoration:"none",color:M.navy,fontWeight:600,fontSize:15,background:"none",border:"none",cursor:"pointer",fontFamily:"Barlow",width:"100%",textAlign:"left"};
  return <span style={{position:"relative",display:"inline-block"}}>
    <button onClick={clic} aria-expanded={aperto} style={btn}>
      <svg viewBox="0 0 24 24" width="18" height="18" aria-hidden="true" fill="none" stroke="currentColor" strokeWidth="2" strokeLinecap="round" strokeLinejoin="round"><circle cx="18" cy="5" r="3"/><circle cx="6" cy="12" r="3"/><circle cx="18" cy="19" r="3"/><path d="M8.6 13.5l6.8 4M15.4 6.5l-6.8 4"/></svg>
      Condividi
    </button>
    {aperto&&<span role="menu" style={{position:"absolute",top:"calc(100% + 6px)",left:0,zIndex:30,background:"#fff",borderRadius:12,boxShadow:"0 6px 24px rgba(15,26,46,.18)",padding:6,minWidth:200,display:"flex",flexDirection:"column"}}>
      <a role="menuitem" href={"https://wa.me/?text="+encodeURIComponent(testo+" "+pieno)} target="_blank" rel="noopener" style={voce} onClick={()=>setAperto(false)}>WhatsApp</a>
      <a role="menuitem" href={"https://www.facebook.com/sharer/sharer.php?u="+encodeURIComponent(pieno)} target="_blank" rel="noopener" style={voce} onClick={()=>setAperto(false)}>Facebook</a>
      <button role="menuitem" onClick={copia} style={voce}>{copiato?"Link copiato ✓":"Copia link"}</button>
    </span>}
  </span>;
}

// ---------- mappa d'Italia ----------
function MappaItalia({riga,geo,onNav}){
  const box=useRef(null); const s=useScala(box,540);
  const R=riga.regioni||{};
  const punti=(riga.punti||[]).filter(p=>!p.mont);
  const conFasce=punti.some(p=>Array.isArray(p.fasce)&&p.fasce.length);
  const [f,setF]=useState("giornata");
  // per regione: etichetta (capoluogo) e colore (pioggia massima tra i capoluoghi) della fascia scelta
  const dato=(r)=>{
    const x=R[r.slug]; if(!x) return null;
    if(f==="giornata") return {cod:x.cod,t:x.max,mm:x.mm||0};
    const qui=punti.filter(p=>p.regione===r.slug);
    const fa=(p)=>(p&&Array.isArray(p.fasce)?p.fasce.find(y=>y.f===f):null);
    const c=fa(qui.find(p=>p.nome===r.capoluogo)); if(!c) return {cod:x.cod,t:x.max,mm:x.mm||0};
    return {cod:c.cod,t:c.t,mm:Math.max(0,...qui.map(p=>(fa(p)||{}).mm||0))};
  };
  const scelte=[["giornata","Giornata"],["mattina","Mattina"],["pomeriggio","Pomeriggio"],["sera","Sera"]];
  return <div style={{...card,flex:"1 1 440px",maxWidth:600,padding:18,margin:"0 auto"}}>
    {conFasce&&<div role="tablist" aria-label="Momento della giornata" style={{display:"flex",flexWrap:"wrap",gap:8,marginBottom:12}}>
      {scelte.map(([k,t])=><button key={k} role="tab" aria-selected={f===k} onClick={()=>setF(k)} style={{...pill(f===k),padding:"7px 14px",fontSize:14}}>{t}</button>)}
    </div>}
    <div ref={box} style={{position:"relative",width:"100%",aspectRatio:"567/666"}}>
      <svg viewBox="0 0 567 666" style={{position:"absolute",inset:0,width:"100%",height:"100%"}} role="img" aria-label={"Mappa dell'Italia con la pioggia massima prevista "+(f==="giornata"?"oggi":"di "+f)+" per regione"}>
        {METEO_REGIONI.map(r=><path key={r.slug} d={geo.mappe[r.slug].d} fill={pioggiaCol((dato(r)||{}).mm||0)} stroke="#fff" strokeWidth="1.5" strokeLinejoin="round" style={{cursor:"pointer"}} onClick={()=>onNav("/meteo/"+r.slug)}><title>{r.nome}</title></path>)}
      </svg>
      {METEO_REGIONI.map(r=>{ const x=dato(r); const pos=geo.pos[r.capoluogo]; if(!x||!pos) return null; const l=pos.itl||pos.it;
        return <Link key={r.slug} href={"/meteo/"+r.slug} onNav={onNav} title={"Meteo "+r.nome} style={{position:"absolute",left:l[0]+"%",top:l[1]+"%",transform:"translate(-50%,-50%) scale("+s+")",display:"flex",flexDirection:"column",alignItems:"center",background:"#fff",borderRadius:10,padding:"2px 7px 3px",boxShadow:"0 1px 6px rgba(15,26,46,.28)",textDecoration:"none"}}>
          <span style={{fontSize:10,fontWeight:700,color:M.gray,whiteSpace:"nowrap",lineHeight:1.3}}>{r.capoluogo}</span>
          <span style={{display:"flex",alignItems:"center",gap:2}}><Icona cod={x.cod} s={20} notte={f==="sera"}/><span style={{fontSize:15,fontWeight:700,color:M.ink}}>{int(x.t)}°</span></span>
        </Link>; })}
    </div>
    <div style={{display:"flex",flexWrap:"wrap",gap:"6px 14px",alignItems:"center",marginTop:12,fontSize:13,color:M.soft}}>
      <span style={{fontWeight:700}}>Pioggia massima nella regione{f==="giornata"?"":" ("+f+")"}</span>
      {[["#DCE6F5","asciutto"],["#BFD3EE","fino a 2 mm"],["#8FB2E3","2-10 mm"],["#3F77C8","oltre 10 mm"]].map(([c,t])=><span key={t} style={{display:"flex",alignItems:"center",gap:6}}><span style={{width:18,height:12,borderRadius:3,background:c}}/>{t}</span>)}
    </div>
    <div style={{fontSize:13,color:M.gray,marginTop:6}}>{f==="giornata"?"Sulle etichette: tempo e massima del capoluogo di regione.":"Sulle etichette: tempo e temperatura del capoluogo "+(f==="mattina"?"alle 9":f==="pomeriggio"?"alle 15":"alle 21")+"."} Tocca una regione per i suoi capoluoghi.</div>
  </div>;
}

function Reel({riga}){
  const su=(u)=>u&&u.indexOf(SUPA)===0;
  const video=su(riga.reel_url)?riga.reel_url:null, cover=su(riga.cover_url)?riga.cover_url:null;
  const box={flex:"1 1 260px",maxWidth:340,minWidth:240,aspectRatio:"9/16",borderRadius:16,overflow:"hidden",margin:"0 auto",position:"relative",background:"linear-gradient(180deg,#1E2F52 0%,#2C4A7C 55%,#16243F 100%)"};
  if(video) return <div style={box}><video src={video} poster={cover||undefined} controls playsInline preload="none" style={{width:"100%",height:"100%",objectFit:"cover",display:"block",background:"#000"}} aria-label="Reel del giorno con Lorenzo"/></div>;
  return <a href={INSTAGRAM} target="_blank" rel="noopener" style={{...box,display:"flex",flexDirection:"column",justifyContent:"space-between",padding:20,color:"#fff",textDecoration:"none",backgroundImage:cover?"url("+cover+")":box.background,backgroundSize:"cover",backgroundPosition:"center"}}>
    <span style={{fontSize:13,fontWeight:700,letterSpacing:".12em",color:M.gold}}>REEL DEL GIORNO</span>
    <span style={{alignSelf:"center",width:72,height:72,borderRadius:"50%",background:"rgba(255,255,255,.92)",display:"flex",alignItems:"center",justifyContent:"center"}}><svg viewBox="0 0 24 24" width="30" height="30" aria-hidden="true"><path d="M8 5v14l11-7z" fill={M.navy}/></svg></span>
    <span style={{fontSize:15,fontWeight:600}}>Guarda il video su Instagram</span>
  </a>;
}

// ---------- Adesso: tempo osservato negli aeroporti (METAR), non previsto ----------
// Lo aggiorna meteo-ora ogni 30 minuti in public.meteo_ora; qui lo si legge a parte,
// cosi' se manca la pagina resta uguale (la sezione semplicemente non compare).
let ORA=null, ORA_T=0;
function useOra(){
  const [d,setD]=useState(ORA);
  useEffect(()=>{
    if(ORA&&Date.now()-ORA_T<5*60000) return;
    let vivo=true;
    fetch(SUPA+"/rest/v1/meteo_ora?select=stazioni,aggiornato_il&id=eq.1",{headers:{apikey:KEY}})
      .then(r=>r.ok?r.json():[]).then(j=>{ ORA=j[0]||{stazioni:[]}; ORA_T=Date.now(); if(vivo) setD(ORA); }).catch(()=>{});
    return ()=>{ vivo=false; };
  },[]);
  return d;
}
const oraRoma=(iso)=>Number(new Intl.DateTimeFormat("it-IT",{timeZone:"Europe/Rome",hour:"2-digit",hour12:false}).format(new Date(iso)));
// Una fascia scura stile "in diretta": una voce per regione nell'hub (il capoluogo, o
// l'aeroporto osservato piu' vicino), tutte le stazioni nella pagina della regione.
function sceltaHub(lista){
  return METEO_REGIONI.map(r=>{
    const qui=lista.filter(x=>x.regione===r.slug);
    return qui.find(x=>!x.stima&&x.citta===r.capoluogo)||qui.find(x=>x.stima&&x.citta===r.capoluogo&&!qui.some(y=>!y.stima&&y.citta.startsWith(r.capoluogo)))||qui.find(x=>!x.stima)||qui[0];
  }).filter(Boolean);
}
function Adesso({slug,citta,onNav}){
  const d=useOra();
  const fresche=((d&&d.stazioni)||[]).filter(x=>Date.now()-new Date(x.quando).getTime()<3*3600000);
  const delReg=slug?fresche.filter(x=>x.regione===slug):[];
  // pagina di una citta': prima la sua stazione (o la stima), poi il resto della regione
  const proprie=citta?delReg.filter(x=>x.citta===citta||x.citta.startsWith(citta+" ")):[];
  const lista=citta?[...proprie,...delReg.filter(x=>proprie.indexOf(x)<0)]:slug?delReg:sceltaHub(fresche);
  if(!lista.length) return null;
  const ultima=lista.filter(x=>!x.stima).map(x=>x.ora).sort().pop()||lista[0].ora;
  const stime=lista.some(x=>x.stima);
  const voce=(x)=>{ const h=oraRoma(x.quando); const notte=h<7||h>=17;
    const dentro=<React.Fragment>
      <span style={{fontSize:13,fontWeight:600,color:"#AFC0DD",whiteSpace:"nowrap"}}>{x.citta.replace(/ \(.*\)$/,"")}{x.stima?"*":""}</span>
      <span style={{display:"flex",alignItems:"center",gap:7}}><Icona cod={x.cod} s={26} notte={notte}/><span style={{fontFamily:"Anton",fontSize:27,lineHeight:1,color:"#fff"}}>{int(x.t)}°</span></span>
    </React.Fragment>;
    const st={display:"flex",flexDirection:"column",gap:5,padding:"2px 18px",borderLeft:"1px solid rgba(255,255,255,.14)",textDecoration:"none",flexShrink:0};
    const tip=cap(x.desc)+(x.stima?" · stima del modello":" · osservato all'aeroporto")+" · ore "+x.ora;
    return slug? <div key={x.icao} title={tip} style={st}>{dentro}</div>
      : <Link key={x.icao} href={"/meteo/"+x.regione} onNav={onNav} title={tip} style={st}>{dentro}</Link>; };
  return <section aria-label="Il tempo adesso" style={{background:M.navy,borderRadius:16,padding:"16px 0 14px",display:"flex",flexDirection:"column",gap:10,overflow:"hidden"}}>
    <style>{"@keyframes ia-live{0%{box-shadow:0 0 0 0 rgba(226,35,26,.7)}70%{box-shadow:0 0 0 9px rgba(226,35,26,0)}100%{box-shadow:0 0 0 0 rgba(226,35,26,0)}} .ia-adesso::-webkit-scrollbar{display:none}"}</style>
    <div style={{display:"flex",alignItems:"stretch"}}>
      <div style={{display:"flex",flexDirection:"column",justifyContent:"center",gap:4,padding:"0 18px 0 20px",flexShrink:0}}>
        <span style={{display:"flex",alignItems:"center",gap:9}}><span style={{width:10,height:10,borderRadius:"50%",background:"#E2231A",animation:"ia-live 1.8s infinite"}}/><span style={{fontFamily:"Anton",fontSize:24,letterSpacing:".06em",color:"#fff"}}>ADESSO</span></span>
        <span style={{fontSize:13,color:"#AFC0DD"}}>ore {ultima}</span>
      </div>
      <div className="ia-adesso" style={{display:"flex",overflowX:"auto",scrollbarWidth:"none",paddingRight:12}}>{lista.map(voce)}</div>
    </div>
    <span style={{fontSize:12.5,color:"#8EA2C4",padding:"0 20px"}}>Tempo osservato negli aeroporti (bollettini METAR){stime?" · * stima del modello dove non c'è un aeroporto":""}{slug?"":" · tocca una città per la sua regione"}</span>
  </section>;
}

// ---------- /meteo ----------
function Hub({riga,archivio,geo,onNav}){
  const g=riga.giorno;
  const titolo=riga.titolo||("Il meteo di "+dataLunga(g));
  const zone=Array.isArray(riga.zone)?riga.zone:[];
  return <React.Fragment>
    <section style={{display:"flex",flexWrap:"wrap",gap:32,alignItems:"stretch"}}>
      <div style={{flex:"999 1 480px",minWidth:0,display:"flex",flexDirection:"column",gap:18,justifyContent:"center"}}>
        <span style={kicker}>Meteo · {dataLunga(g)}</span>
        <h1 style={h1}>{titolo}</h1>
        {riga.sottotitolo&&<p style={lead}>{riga.sottotitolo}</p>}
        <div style={{display:"flex",flexWrap:"wrap",gap:12,marginTop:4}}>
          <Link href={urlDaGiorno(g)} onNav={onNav} style={{background:M.blue,color:"#fff",textDecoration:"none",fontWeight:700,fontSize:17,padding:"14px 24px",borderRadius:10}}>Tutti i dati di oggi</Link>
          <a href={INSTAGRAM} target="_blank" rel="noopener" style={{background:"#fff",color:M.navy,textDecoration:"none",fontWeight:700,fontSize:17,padding:"12px 22px",borderRadius:10,border:"2px solid "+M.navy}}>Segui MeteoIAttualità</a>
          <Condividi url={urlDaGiorno(g)} testo={"Il meteo di "+dataLunga(g)+": "+titolo}/>
        </div>
        <span style={{fontSize:14,color:M.gray}}>Dati ItaliaMeteo-ARPAE ICON-2I ed ECMWF via Open-Meteo, aggiornati sei volte al giorno</span>
      </div>
      <Reel riga={riga}/>
    </section>

    <Adesso onNav={onNav}/>

    <section style={{display:"flex",flexDirection:"column",gap:18}}>
      <Intestazione titolo="L'Italia oggi" sotto="Tutte le regioni: tempo, massima e pioggia prevista"/>
      <div style={{display:"flex",flexWrap:"wrap",gap:24,alignItems:"flex-start"}}>
        <MappaItalia riga={riga} geo={geo} onNav={onNav}/>
        <div style={{flex:"1 1 360px",minWidth:0,display:"flex",flexDirection:"column",gap:14}}>
          {zone.map(z=><article key={z.nome} style={{...card,display:"flex",flexDirection:"column",gap:8,borderLeft:"6px solid "+M.blue}}>
            <div style={{display:"flex",flexWrap:"wrap",justifyContent:"space-between",alignItems:"baseline",gap:8}}>
              <h3 style={{margin:0,fontFamily:"Anton",fontWeight:400,fontSize:25,letterSpacing:".02em",color:M.navy}}>{z.nome}</h3>
              <span style={{fontSize:17,fontWeight:700,color:M.blue}}>{z.range}</span>
            </div>
            <p style={{margin:0,fontSize:17,lineHeight:1.5,color:M.soft}}>{z.testo}</p>
          </article>)}
          <Allerte riga={riga}/>
        </div>
      </div>
      <nav aria-label="Meteo per regione" style={{display:"flex",flexWrap:"wrap",gap:8}}>
        {METEO_REGIONI.map(r=><Link key={r.slug} href={"/meteo/"+r.slug} onNav={onNav} style={{background:"#fff",borderRadius:999,padding:"8px 14px",textDecoration:"none",fontWeight:600,fontSize:15,color:M.navy}}>{r.nome}</Link>)}
      </nav>
    </section>

    {(riga.tendenza||[]).length>0&&<section style={{display:"flex",flexDirection:"column",gap:18}}>
      <Intestazione titolo="I prossimi giorni" sotto="Tendenza ECMWF: massime di Milano, Roma e Palermo. Oltre domani può cambiare."/>
      <div style={{display:"grid",gridTemplateColumns:"repeat(auto-fit,minmax(160px,1fr))",gap:14}}>
        {riga.tendenza.map(t=><div key={t.d} style={{...card,padding:18,display:"flex",flexDirection:"column",gap:10,borderTop:"4px solid "+M.gold}}>
          <div style={{display:"flex",flexDirection:"column"}}><span style={{fontFamily:"Anton",fontSize:23,color:M.navy}}>{nomeGiorno(t.d)}</span><span style={{fontSize:14,color:M.gray}}>{dataBreve(t.d)}</span></div>
          {t.righe.map(x=><div key={x.zona} title={x.citta+": "+(DESC[x.cod]||"")} style={{display:"flex",alignItems:"center",gap:8,fontSize:16}}>
            <span style={{width:54,color:M.gray,fontSize:14,fontWeight:600}}>{x.zona}</span><Icona cod={x.cod}/><span style={{fontWeight:700}}>{int(x.max)}°</span>
            {x.mm>=0.5&&<span style={{fontSize:13,color:M.rain,fontWeight:600,whiteSpace:"nowrap"}}>{virg(x.mm)} mm</span>}
          </div>)}
        </div>)}
      </div>
    </section>}

    {archivio.length>0&&<section style={{display:"flex",flexDirection:"column",gap:14,maxWidth:720}}>
      <h2 style={{...h2,fontSize:30}}>Archivio dei giorni</h2>
      {archivio.slice(0,14).map(a=><Link key={a.giorno} href={urlDaGiorno(a.giorno)} onNav={onNav} style={{...card,padding:"14px 20px",textDecoration:"none",color:M.ink,display:"flex",flexDirection:"column",gap:2}}>
        <span style={{fontSize:14,color:M.gray}}>{cap(dataLunga(a.giorno))}</span>
        <span style={{fontSize:18,fontWeight:600}}>{a.titolo||("Il meteo di "+dataLunga(a.giorno))}</span>
      </Link>)}
    </section>}
    <Fonti riga={riga}/>
  </React.Fragment>;
}

// ---------- /meteo/gg-mm-aa ----------
function Giorno({riga,archivio,onNav}){
  const g=riga.giorno;
  const [tab,setTab]=useState("Regioni");
  const [reg,setReg]=useState("");
  const punti=(riga.punti||[]).filter(p=>!p.mont);
  const mont=(riga.punti||[]).filter(p=>p.mont);
  const k=riga.kpi||{};
  const lista=archivio.map(a=>a.giorno).sort();
  const i=lista.indexOf(g), prev=i>0?lista[i-1]:null, next=i>=0&&i<lista.length-1?lista[i+1]:null;
  const ordine=METEO_REGIONI.map(r=>r.slug);
  const righe=punti.filter(p=>(reg? p.regione===reg : tab==="Tutte"||(tab==="Regioni"?p.cap:p.zona===tab))).sort((a,b)=>ordine.indexOf(a.regione)-ordine.indexOf(b.regione)||(b.cap?1:0)-(a.cap?1:0));
  const piovose=[...punti].sort((a,b)=>b.mm-a.mm).filter(p=>p.mm>=0.5).slice(0,3).map(p=>p.nome);
  const scelte=[...piovose,...["Roma","Milano","Napoli"].filter(n=>piovose.indexOf(n)<0)].slice(0,4);
  const zone=Array.isArray(riga.zone)?riga.zone:[];
  const zt=["Milano","Roma","Palermo"].map(n=>punti.find(p=>p.nome===n)).filter(Boolean);
  const kc=(t,v,u,sotto,col)=><div style={{...card,padding:20,display:"flex",flexDirection:"column",gap:4,borderTop:"4px solid "+col}}>
    <span style={{fontSize:14,fontWeight:600,color:M.gray}}>{t}</span>
    <span style={{fontFamily:"Anton",fontSize:"clamp(34px,5vw,44px)",color:M.navy,lineHeight:1.1}}>{v} <span style={{fontSize:20}}>{u}</span></span>
    <span style={{fontSize:15,color:M.soft}}>{sotto}</span>
  </div>;
  const nav={background:"#fff",borderRadius:8,padding:"9px 14px",textDecoration:"none",fontWeight:700,color:M.navy,fontSize:15};
  return <React.Fragment>
    <section style={{display:"flex",flexDirection:"column",gap:14}}>
      <div style={{display:"flex",flexWrap:"wrap",justifyContent:"space-between",gap:12,alignItems:"center",fontSize:15}}>
        <span style={{color:M.gray}}><Link href="/meteo" onNav={onNav} style={{fontWeight:600,color:M.blue}}>Meteo</Link> / {breve(g)}</span>
        <span style={{display:"flex",flexWrap:"wrap",gap:10}}>
          <Link href="/meteo" onNav={onNav} style={{background:"#fff",borderRadius:8,padding:"9px 14px",textDecoration:"none",fontWeight:700,color:M.navy}}>← Pagina meteo</Link>
          {prev&&<Link href={urlDaGiorno(prev)} onNav={onNav} style={nav}>← {breve(prev)}</Link>}
          {next&&<Link href={urlDaGiorno(next)} onNav={onNav} style={nav}>{breve(next)} →</Link>}
        </span>
      </div>
      <span style={kicker}>Previsione del mattino · {dataLunga(g)}</span>
      <h1 style={{...h1,fontSize:"clamp(34px,6vw,58px)"}}>{riga.titolo||("Il meteo di "+dataLunga(g))}</h1>
      {riga.sottotitolo? <p style={lead}>{riga.sottotitolo}</p> : zone.length>0&&<p style={lead}>{zone.map(z=>z.testo).join(" ")}</p>}
      <div><Condividi url={urlDaGiorno(g)} testo={"Il meteo di "+dataLunga(g)+": "+(riga.titolo||"tutte le città")}/></div>
    </section>

    <section style={{display:"grid",gridTemplateColumns:"repeat(auto-fit,minmax(220px,1fr))",gap:14}}>
      {k.raffica&&kc("Raffica più forte",int(k.raffica.valore),"km/h",k.raffica.citta+(k.raffica.dir?", vento da "+k.raffica.dir:""),M.blue)}
      {k.pioggia&&kc("Pioggia massima",virg(k.pioggia.valore),"mm",k.pioggia.citta+(k.pioggia.quando?", "+k.pioggia.quando:""),M.blue)}
      {k.massima&&kc("Massima più alta",int(k.massima.valore),"°C",k.massima.citta,M.gold)}
      {k.minima&&kc("Minima più bassa",virg(k.minima.valore),"°C",k.minima.citta+(k.minima.neve?", "+virg(k.minima.neve)+" cm di neve":""),M.gold)}
    </section>

    <Allerte riga={riga}/>

    {zone.length>0&&<section style={{display:"grid",gridTemplateColumns:"repeat(auto-fit,minmax(260px,1fr))",gap:14}}>
      {zone.map(z=><article key={z.nome} style={{...card,display:"flex",flexDirection:"column",gap:6,borderLeft:"6px solid "+M.blue}}>
        <div style={{display:"flex",flexWrap:"wrap",justifyContent:"space-between",gap:8,alignItems:"baseline"}}><h3 style={{margin:0,fontFamily:"Anton",fontWeight:400,fontSize:23,color:M.navy}}>{z.nome}</h3><span style={{fontSize:15,fontWeight:700,color:M.blue}}>{z.range}</span></div>
        <p style={{margin:0,fontSize:16,lineHeight:1.5,color:M.soft}}>{z.testo}</p>
      </article>)}
    </section>}

    <section style={{display:"flex",flexDirection:"column",gap:14}}>
      <Intestazione titolo="Città per città">
        <div style={{display:"flex",flexWrap:"wrap",gap:8,alignItems:"center"}}>
          {[["Regioni","Capoluoghi di regione"],...ZONE.map(z=>[z,z]),["Tutte","Tutti i 110"]].map(([n,t])=><button key={n} onClick={()=>{setTab(n);setReg("");}} style={pill(tab===n&&!reg,M.navy)}>{t}</button>)}
          <select value={reg} onChange={e=>{setReg(e.target.value);setTab("Tutte");}} aria-label="Filtra per regione" style={{border:"2px solid "+M.navy,borderRadius:999,padding:"8px 12px",fontSize:15,fontWeight:700,color:M.navy,background:"#fff",fontFamily:"Barlow"}}>
            <option value="">Regione…</option>{METEO_REGIONI.map(r=><option key={r.slug} value={r.slug}>{r.nome}</option>)}
          </select>
        </div>
      </Intestazione>
      <div style={{...card,padding:8,overflowX:"auto"}}>
        <table style={{width:"100%",borderCollapse:"collapse",fontSize:16,minWidth:680}}>
          <thead><tr style={{textAlign:"left",color:M.gray,fontSize:12.5,letterSpacing:".06em"}}>
            {["CITTÀ","MATTINA","POMERIGGIO","SERA","MIN","MAX","PIOGGIA","RAFFICA","VENTO DA"].map((t,i)=><th key={t} scope="col" style={{padding:"12px 14px",fontWeight:700,textAlign:i>=4&&i<=7?"right":"left"}}>{t}</th>)}
          </tr></thead>
          <tbody>{righe.map(p=><tr key={p.nome} style={{borderTop:"1px solid "+M.line}}>
            <td style={{padding:"11px 14px",fontWeight:700,color:M.navy}}><Link href={"/meteo/"+p.regione} onNav={onNav} style={{color:M.navy,textDecoration:"none"}}>{p.nome}</Link><div style={{fontSize:12.5,fontWeight:500,color:M.gray}}>{regNome(p.regione)}</div></td>
            {(Array.isArray(p.fasce)&&p.fasce.length===3?p.fasce:[{f:"g",cod:p.cod},null,null]).map((x,i)=><td key={i} style={{padding:"11px 14px"}}>{x&&<span title={(NOMEF[x.f]||"")+" "+(DESC[x.cod]||"")} style={{display:"flex",alignItems:"center",gap:6}}><Icona cod={x.cod} notte={x.f==="sera"}/>{x.t!=null&&<span style={{fontSize:15,fontWeight:600}}>{int(x.t)}°</span>}{x.mm>=0.5&&<span style={{fontSize:13,color:M.rain,fontWeight:700}}>{virg(x.mm)}</span>}</span>}</td>)}
            <td style={{padding:"11px 14px",textAlign:"right",color:M.soft}}>{int(p.min)}°</td>
            <td style={{padding:"11px 14px",textAlign:"right",fontWeight:700}}>{int(p.max)}°</td>
            <td style={{padding:"11px 14px",textAlign:"right",color:M.rain,fontWeight:600}}>{p.mm>=0.1?virg(p.mm)+" mm":"–"}</td>
            <td style={{padding:"11px 14px",textAlign:"right"}}>{int(p.raff)} km/h</td>
            <td style={{padding:"11px 14px",color:M.soft}}>{bussola(p.dir)}</td>
          </tr>)}</tbody>
        </table>
      </div>
    </section>

    <Grafico punti={punti} scelte={scelte} iniziale={scelte[0]}/>

    <section style={{display:"flex",flexWrap:"wrap",gap:22,alignItems:"stretch"}}>
      <div style={{...card,flex:"1 1 420px",minWidth:0,padding:24,display:"flex",flexDirection:"column",gap:14}}>
        <h2 style={{...h2,fontSize:28}}>Neve e quota dello zero termico</h2>
        <div style={{display:"flex",flexDirection:"column",gap:10,fontSize:17,lineHeight:1.5,color:M.soft}}>
          {mont.map(p=><span key={p.nome}><b style={{color:M.navy}}>{p.nome}</b>: da {virg(p.min)} a {virg(p.max)} °C, {p.neve>=0.1?virg(p.neve)+" cm di neve":"nessuna neve prevista"}.</span>)}
          {punti.filter(p=>p.neve>=0.5).slice(0,4).map(p=><span key={p.nome}><b style={{color:M.navy}}>{p.nome}</b>: {virg(p.neve)} cm di neve.</span>)}
        </div>
        {zt.some(p=>p.zt&&p.zt.some(x=>x!=null))&&<div style={{display:"grid",gridTemplateColumns:"auto repeat(3,1fr)",gap:"8px 16px",fontSize:16,alignItems:"center",marginTop:4}}>
          <span/>{["ORE 6","ORE 12","ORE 18"].map(t=><span key={t} style={{fontSize:12.5,fontWeight:700,color:M.gray,textAlign:"right"}}>{t}</span>)}
          {zt.map(p=><React.Fragment key={p.nome}><span style={{fontWeight:700,color:M.navy}}>{p.nome}</span>{(p.zt||[]).map((v,j)=><span key={j} style={{textAlign:"right"}}>{v==null?"–":Number(v).toLocaleString("it-IT")+" m"}</span>)}</React.Fragment>)}
        </div>}
      </div>
      <div style={{...card,flex:"1 1 360px",minWidth:0,padding:24,display:"flex",flexDirection:"column",gap:14,borderTop:"4px solid "+M.gold}}>
        <h2 style={{...h2,fontSize:28}}>Dove i modelli non concordano</h2>
        <p style={{margin:0,fontSize:17,lineHeight:1.5,color:M.soft}}>Confrontiamo ICON-2I (ItaliaMeteo-ARPAE) con ECMWF. Dove le due previsioni divergono lo diciamo, e nel video usiamo il condizionale.</p>
        <div style={{display:"flex",flexDirection:"column",gap:8,fontSize:16,color:M.soft}}>
          {(riga.differenze||[]).length? riga.differenze.map(d=><span key={d.citta} style={{background:M.bg,borderRadius:10,padding:"10px 14px"}}><b style={{color:M.navy}}>{d.citta}</b>: {d.testo}</span>)
            : <span style={{background:M.bg,borderRadius:10,padding:"10px 14px"}}>Oggi i due modelli sono d'accordo su tutti i capoluoghi.</span>}
        </div>
      </div>
    </section>
    <Segui/>
    <Fonti riga={riga}/>
  </React.Fragment>;
}

// ---------- /meteo/<regione> ----------
function Regione({riga,slug,geo,onNav}){
  const r=regioneDaSlug(slug);
  const x=(riga.regioni||{})[slug]||{};
  const punti=(riga.punti||[]).filter(p=>!p.mont&&p.regione===slug);
  const ord=r.citta; punti.sort((a,b)=>ord.indexOf(a.nome)-ord.indexOf(b.nome));
  const box=useRef(null); const s=useScala(box,520);
  const capo=punti.find(p=>p.nome===r.capoluogo)||punti[0];
  // La citta' scelta nel grafico della pioggia comanda anche "I prossimi giorni a ..."
  const iniziale=(capo||{}).nome;
  const [sc,setSc]=useState(null);
  // arrivo dalla barra di ricerca: seleziona la citta' e porta la sua scheda in vista
  useEffect(()=>{
    const f=()=>{ const c=CERCATA; if(!c||c.slug!==slug) return; CERCATA=null; setSc({slug,nome:c.nome});
      setTimeout(()=>{ const el=document.getElementById("citta-"+normC(c.nome)); if(el){ el.scrollIntoView({behavior:"smooth",block:"center"}); el.animate&&el.animate([{boxShadow:"0 0 0 4px "+M.blue},{boxShadow:"0 0 0 0 transparent"}],{duration:1600}); } },250); };
    f(); window.addEventListener("ia-cerca",f); return ()=>window.removeEventListener("ia-cerca",f);
  },[slug]);
  const scelta=punti.find(p=>p.nome===(sc&&sc.slug===slug?sc.nome:iniziale))||capo;
  const g=riga.giorno;
  const mp=geo.mappe[slug]; const [vb0,vb1]=mp.vb;
  return <React.Fragment>
    <section style={{display:"flex",flexDirection:"column",gap:14}}>
      <div style={{display:"flex",flexWrap:"wrap",justifyContent:"space-between",gap:12,alignItems:"center",fontSize:15}}>
        <span style={{color:M.gray}}><Link href="/meteo" onNav={onNav} style={{fontWeight:600,color:M.blue}}>Meteo</Link> / <Link href={urlDaGiorno(g)} onNav={onNav} style={{fontWeight:600,color:M.blue}}>{breve(g)}</Link> / {r.nome}</span>
        <Link href="/meteo" onNav={onNav} style={{background:"#fff",borderRadius:8,padding:"9px 14px",textDecoration:"none",fontWeight:700,color:M.navy}}>← Tutta l'Italia</Link>
      </div>
      <span style={kicker}>{r.nome} · {dataLunga(g)}</span>
      <h1 style={{...h1,fontSize:"clamp(34px,6vw,58px)"}}>{x.titolo||("Meteo "+r.nome)}</h1>
      {x.testo&&<p style={lead}>{x.testo}</p>}
      <div><Condividi url={"/meteo/"+slug} testo={"Il meteo di oggi · "+(x.titolo||r.nome)}/></div>
    </section>

    <Adesso slug={slug}/>

    <section style={{display:"flex",flexWrap:"wrap",gap:24,alignItems:"flex-start"}}>
      <div style={{...card,flex:"1 1 420px",maxWidth:560,padding:18,margin:"0 auto"}}>
        <div ref={box} style={{position:"relative",width:"100%",aspectRatio:vb0+"/"+vb1}}>
          <svg viewBox={"0 0 "+vb0+" "+vb1} style={{position:"absolute",inset:0,width:"100%",height:"100%"}} role="img" aria-label={"Mappa della regione "+r.nome+" con i capoluoghi di provincia"}>
            <path d={mp.mappa} fill={pioggiaCol(x.mm||0)} stroke="#fff" strokeWidth="2" strokeLinejoin="round"/>
          </svg>
          {punti.map(p=>{ const pos=(geo.pos[p.nome]||{}).rg; if(!pos) return null;
            return <div key={p.nome} style={{position:"absolute",left:pos[0]+"%",top:pos[1]+"%",transform:"translate(-50%,-50%) scale("+s+")",display:"flex",flexDirection:"column",alignItems:"center",background:"#fff",borderRadius:10,padding:"3px 9px 4px",boxShadow:"0 1px 6px rgba(15,26,46,.3)"}}>
              <span style={{fontSize:12,fontWeight:700,color:M.gray,whiteSpace:"nowrap",lineHeight:1.3}}>{p.nome}</span>
              <span style={{display:"flex",alignItems:"center",gap:3}}><Icona cod={p.cod} s={22}/><span style={{fontSize:17,fontWeight:700,color:M.ink}}>{int(p.max)}°</span>{p.mm>=0.5&&<span style={{fontSize:13,fontWeight:700,color:M.rain}}>{virg(p.mm)}</span>}</span>
            </div>; })}
        </div>
        <div style={{fontSize:13,color:M.gray,marginTop:10}}>Tempo, massima e pioggia prevista (mm) nei capoluoghi di provincia. Colore: pioggia massima nella regione.</div>
      </div>
      <div style={{flex:"1 1 380px",minWidth:0,display:"flex",flexDirection:"column",gap:12}}>
        {punti.map(p=><article key={p.nome} id={"citta-"+normC(p.nome)} style={{...card,padding:"16px 20px",scrollMarginTop:160,display:"flex",flexDirection:"column",gap:6,borderLeft:"6px solid "+(p.cap?M.gold:M.blue)}}>
          <div style={{display:"flex",flexWrap:"wrap",justifyContent:"space-between",alignItems:"baseline",gap:8}}>
            <h3 style={{margin:0,fontFamily:"Anton",fontWeight:400,fontSize:23,letterSpacing:".02em",color:M.navy}}><Link href={urlCitta(slug,p.nome)} onNav={onNav} style={{color:M.navy,textDecoration:"none"}}>{p.nome} <span style={{fontFamily:"Barlow",fontSize:14,fontWeight:700,color:M.blue}}>→</span></Link></h3>
            <span style={{fontSize:17,fontWeight:700,color:M.blue}}>{int(p.min)}° / {int(p.max)}°</span>
          </div>
          <div style={{display:"flex",flexWrap:"wrap",gap:"4px 18px",fontSize:16,color:M.soft,alignItems:"center"}}>
            <span style={{display:"flex",alignItems:"center",gap:6}}><Icona cod={p.cod} s={22}/>{DESC[p.cod]||""}</span>
            <span style={{color:M.rain,fontWeight:600}}>{mm(p.mm)}{Array.isArray(p.fasce)&&p.mm>=0.5&&p.fasce.reduce((a,x)=>a+(x.mm||0),0)<0.5?" nella notte":""}</span>
            {p.raff!=null&&<span>Raffica {int(p.raff)} km/h{p.dir!=null?" da "+bussola(p.dir):""}</span>}
            {p.neve>=0.1&&<span>Neve {virg(p.neve)} cm</span>}
          </div>
          <Fasce p={p}/>
        </article>)}
      </div>
    </section>

    <Allerte riga={riga} slug={slug}/>

    {punti.length>0&&<Grafico key={slug+"|"+(scelta?scelta.nome:"")} punti={punti} scelte={punti.slice(0,6).map(p=>p.nome)} iniziale={scelta?scelta.nome:iniziale} onCambia={(n)=>setSc({slug,nome:n})}/>}

    {scelta&&(scelta.tend||[]).length>0&&<section style={{display:"flex",flexDirection:"column",gap:14}}>
      <Intestazione titolo={"I prossimi giorni "+a_(scelta.nome)} sotto="Tendenza ECMWF. Oltre domani può cambiare."/>
      <div style={{display:"grid",gridTemplateColumns:"repeat(auto-fit,minmax(150px,1fr))",gap:12}}>
        {scelta.tend.map(t=><div key={t.d} style={{...card,padding:16,display:"flex",flexDirection:"column",gap:6,borderTop:"4px solid "+M.gold}}>
          <span style={{fontFamily:"Anton",fontSize:21,color:M.navy}}>{nomeGiorno(t.d)}</span>
          <span style={{fontSize:13,color:M.gray}}>{dataBreve(t.d)}</span>
          <span style={{display:"flex",alignItems:"center",gap:8}}><Icona cod={t.cod} s={26}/><span style={{fontSize:18,fontWeight:700}}>{int(t.min)}° / {int(t.max)}°</span></span>
          <span style={{fontSize:14,color:M.soft}}>{(DESC[t.cod]||"")+(t.mm>=0.5?", "+virg(t.mm)+" mm":"")}</span>
        </div>)}
      </div>
    </section>}

    <ComuniRegione slug={slug} onNav={onNav}/>

    <section style={{display:"flex",flexWrap:"wrap",gap:10,alignItems:"center"}}>
      <span style={{fontSize:16,fontWeight:700,color:M.navy,marginRight:6}}>Regioni vicine</span>
      {r.vicine.map(v=><Link key={v} href={"/meteo/"+v} onNav={onNav} style={{background:"#fff",borderRadius:999,padding:"9px 16px",textDecoration:"none",fontWeight:700,color:M.blue}}>{regNome(v)}</Link>)}
    </section>
    <Fonti riga={riga}/>
  </React.Fragment>;
}

// ---------- /meteo/<regione>/<citta> ----------
function Citta({riga,slug,nome,onNav}){
  const r=regioneDaSlug(slug);
  const p=(riga.punti||[]).find(x=>!x.mont&&x.nome===nome);
  const g=riga.giorno;
  if(!p) return <Stato testo={"Previsioni di "+nome+" non disponibili oggi"}/>;
  const altre=r.citta.filter(c=>c!==nome);
  const zt=(p.zt||[]).filter(x=>x!=null);
  const frase=[cap((DESC[p.cod]||"").toLowerCase()), "minima "+int(p.min)+"°, massima "+int(p.max)+"°",
    p.mm>=0.5?virg(p.mm)+" mm di pioggia"+(Array.isArray(p.fasce)&&p.fasce.reduce((a,x)=>a+(x.mm||0),0)<0.5?" nella notte":""):"niente pioggia",
    p.raff!=null?"raffiche fino a "+int(p.raff)+" km/h"+(p.dir!=null?" da "+bussola(p.dir):""):null].filter(Boolean).join(", ")+".";
  return <React.Fragment>
    <section style={{display:"flex",flexDirection:"column",gap:14}}>
      <div style={{display:"flex",flexWrap:"wrap",justifyContent:"space-between",gap:12,alignItems:"center",fontSize:15}}>
        <span style={{color:M.gray}}><Link href="/meteo" onNav={onNav} style={{fontWeight:600,color:M.blue}}>Meteo</Link> / <Link href={"/meteo/"+slug} onNav={onNav} style={{fontWeight:600,color:M.blue}}>{r.nome}</Link> / {nome}</span>
        <span style={{display:"flex",flexWrap:"wrap",gap:10}}>
          <Link href={"/meteo/"+slug} onNav={onNav} style={{background:"#fff",borderRadius:8,padding:"9px 14px",textDecoration:"none",fontWeight:700,color:M.navy}}>← {r.nome}</Link>
          <Link href="/meteo" onNav={onNav} style={{background:"#fff",borderRadius:8,padding:"9px 14px",textDecoration:"none",fontWeight:700,color:M.navy}}>Tutta l'Italia</Link>
        </span>
      </div>
      <span style={kicker}>{nome} · {dataLunga(g)}</span>
      <h1 style={{...h1,fontSize:"clamp(36px,6.4vw,62px)"}}>Meteo {nome} oggi</h1>
      <p style={lead}>{frase}</p>
      <div><Condividi url={urlCitta(slug,nome)} testo={"Il meteo di oggi a "+nome}/></div>
    </section>

    <Adesso slug={slug} citta={nome}/>

    <section style={{...card,display:"flex",flexDirection:"column",gap:14,borderLeft:"6px solid "+M.gold}}>
      <div style={{display:"flex",flexWrap:"wrap",alignItems:"center",gap:"10px 24px"}}>
        <span style={{display:"flex",alignItems:"center",gap:10}}><Icona cod={p.cod} s={52}/><span style={{fontFamily:"Anton",fontSize:44,color:M.ink}}>{int(p.min)}° / {int(p.max)}°</span></span>
        <span style={{display:"flex",flexDirection:"column",gap:4,fontSize:17,color:M.soft}}>
          <span style={{fontWeight:700,color:M.navy}}>{DESC[p.cod]||""}</span>
          <span><span style={{color:M.rain,fontWeight:700}}>{mm(p.mm)}</span>{p.raff!=null?" · raffica "+int(p.raff)+" km/h"+(p.dir!=null?" da "+bussola(p.dir):""):""}{p.neve>=0.1?" · neve "+virg(p.neve)+" cm":""}</span>
          {zt.length>0&&<span style={{fontSize:15,color:M.gray}}>Zero termico intorno a {int(Math.round(zt.reduce((a,b)=>a+b,0)/zt.length/50)*50)} m</span>}
        </span>
      </div>
      <Fasce p={p}/>
    </section>

    <Grafico punti={[p]} scelte={[p.nome]} iniziale={p.nome}/>

    {(p.tend||[]).length>0&&<section style={{display:"flex",flexDirection:"column",gap:14}}>
      <Intestazione titolo={"I prossimi giorni "+a_(nome)} sotto="Tendenza ECMWF. Oltre domani può cambiare."/>
      <div style={{display:"grid",gridTemplateColumns:"repeat(auto-fit,minmax(150px,1fr))",gap:12}}>
        {p.tend.map(t=><div key={t.d} style={{...card,padding:16,display:"flex",flexDirection:"column",gap:6,borderTop:"4px solid "+M.gold}}>
          <span style={{fontFamily:"Anton",fontSize:21,color:M.navy}}>{nomeGiorno(t.d)}</span>
          <span style={{fontSize:13,color:M.gray}}>{dataBreve(t.d)}</span>
          <span style={{display:"flex",alignItems:"center",gap:8}}><Icona cod={t.cod} s={26}/><span style={{fontSize:18,fontWeight:700}}>{int(t.min)}° / {int(t.max)}°</span></span>
          <span style={{fontSize:14,color:M.soft}}>{(DESC[t.cod]||"")+(t.mm>=0.5?", "+virg(t.mm)+" mm":"")}</span>
        </div>)}
      </div>
    </section>}

    <section style={{display:"flex",flexWrap:"wrap",gap:10,alignItems:"center"}}>
      <span style={{fontSize:16,fontWeight:700,color:M.navy,marginRight:6}}>Altre città {r.nome==="Valle d'Aosta"?"della":"in"} {r.nome}</span>
      {altre.length? altre.map(c=><Link key={c} href={urlCitta(slug,c)} onNav={onNav} style={{background:"#fff",borderRadius:999,padding:"9px 16px",textDecoration:"none",fontWeight:700,color:M.blue}}>{c}</Link>)
        : <Link href={"/meteo/"+slug} onNav={onNav} style={{background:"#fff",borderRadius:999,padding:"9px 16px",textDecoration:"none",fontWeight:700,color:M.blue}}>Tutta la regione</Link>}
    </section>
    <Fonti riga={riga}/>
  </React.Fragment>;
}

// ---------- tutti i comuni (dal 27/11/2026) ----------
// /meteo-comuni.json: [nome, indice regione, sigla provincia, slug se diverso dal nome, capoluogo]
// Si scarica solo quando serve (ricerca, pagina di una regione o di un comune).
let COMUNI=null, COMUNI_P=null;
function caricaComuni(){
  if(COMUNI) return Promise.resolve(COMUNI);
  if(!COMUNI_P) COMUNI_P=fetch("/meteo-comuni.json").then(r=>{ if(!r.ok) throw new Error("comuni "+r.status); return r.json(); })
    .then(j=>(COMUNI=j.comuni.map(c=>({nome:c[0],reg:j.regioni[c[1]],prov:c[2],slug:c[3]||cittaSlug(c[0]),cap:!!c[4]}))))
    .catch(e=>{ COMUNI_P=null; throw e; });
  return COMUNI_P;
}
function useComuni(attivo=true){
  const [c,setC]=useState(COMUNI);
  useEffect(()=>{ if(!attivo||COMUNI){ if(COMUNI&&!c) setC(COMUNI); return; } let vivo=true; caricaComuni().then(x=>{ if(vivo) setC(x); }).catch(()=>{}); return ()=>{ vivo=false; }; },[attivo]);
  return c;
}
const urlComune=(x)=>"/meteo/"+x.reg+"/"+x.slug;

// Elenco di tutti i comuni di una regione, per provincia (nella pagina della regione)
function ComuniRegione({slug,onNav}){
  const tutti=useComuni();
  if(!tutti) return null;
  const qui=tutti.filter(x=>x.reg===slug&&!x.cap);
  if(!qui.length) return null;
  const prov=[...new Set(qui.map(x=>x.prov))].sort();
  return <section style={{display:"flex",flexDirection:"column",gap:12}}>
    <Intestazione titolo={"Tutti i comuni ("+qui.length+")"} sotto="Ogni comune ha la sua pagina: oggi, mattina, pomeriggio e sera e i prossimi giorni."/>
    {prov.map(pv=>{ const l=qui.filter(x=>x.prov===pv);
      return <details key={pv} style={{...card,padding:"12px 18px"}}>
        <summary style={{cursor:"pointer",fontWeight:700,color:M.navy,fontSize:16}}>Provincia {pv} · {l.length} comuni</summary>
        <div style={{display:"flex",flexWrap:"wrap",gap:"6px 14px",marginTop:10}}>
          {l.map(x=><Link key={x.slug} href={urlComune(x)} onNav={onNav} style={{color:M.blue,fontWeight:600,fontSize:15,textDecoration:"none"}}>{x.nome}</Link>)}
        </div>
      </details>; })}
  </section>;
}

// ---------- /meteo/<regione>/<comune> (comuni che non sono capoluogo) ----------
const FUNZ_COMUNI=SUPA+"/functions/v1/meteo-comuni";
function Comune({slug,cs,onNav}){
  const r=regioneDaSlug(slug);
  const [st,setSt]=useState({carica:true});
  const tutti=useComuni();
  useEffect(()=>{
    let vivo=true; setSt({carica:true});
    fetch(FUNZ_COMUNI,{method:"POST",headers:{"Content-Type":"application/json",apikey:KEY},body:JSON.stringify({comune:{regione:slug,slug:cs}})})
      .then(x=>x.status===404?{nessuno:true}:x.json())
      .then(d=>{ if(!vivo) return; if(d.nessuno) setSt({nessuno:true}); else if(d.comune) setSt({c:d.comune}); else throw new Error(d.errore||"errore"); })
      .catch(()=>fetch(SUPA+"/rest/v1/meteo_comuni?select=*&regione=eq."+slug+"&slug=eq."+cs,{headers:{apikey:KEY}}).then(x=>x.json()).then(a=>{ if(vivo) setSt(a[0]?{c:a[0]}:{nessuno:true}); }).catch(()=>{ if(vivo) setSt({errore:true}); }));
    return ()=>{ vivo=false; };
  },[slug,cs]);
  useEffect(()=>{ const c=st.c; if(!c) return; const p=c.dati||{};
    seo("Meteo "+c.nome+" oggi e prossimi giorni · Iattualità","Meteo a "+c.nome+" ("+c.prov+") oggi: "+(p.cod!=null?(DESC[p.cod]||"")+", minima "+int(p.min)+"°, massima "+int(p.max)+"°"+(p.mm>=0.5?", "+virg(p.mm)+" mm di pioggia":"")+". ":"")+"Mattina, pomeriggio e sera, pioggia ora per ora e tendenza dei prossimi giorni.","/meteo/"+slug+"/"+cs); },[st.c]);
  if(st.carica) return <Stato testo="Carico le previsioni…"/>;
  if(st.nessuno) return <Stato testo="Questo comune non esiste"/>;
  if(st.errore||!st.c) return <Stato testo="Non riesco a caricare il meteo" errore onRiprova={()=>setSt({carica:true})}/>;
  const c=st.c, p=c.dati;
  const vicini=(tutti||[]).filter(x=>x.prov===c.prov&&x.slug!==c.slug&&x.reg===slug);
  const capo=(tutti||[]).find(x=>x.prov===c.prov&&x.cap);
  const testata=<section style={{display:"flex",flexDirection:"column",gap:14}}>
      <div style={{display:"flex",flexWrap:"wrap",justifyContent:"space-between",gap:12,alignItems:"center",fontSize:15}}>
        <span style={{color:M.gray}}><Link href="/meteo" onNav={onNav} style={{fontWeight:600,color:M.blue}}>Meteo</Link> / <Link href={"/meteo/"+slug} onNav={onNav} style={{fontWeight:600,color:M.blue}}>{r.nome}</Link> / {c.nome}</span>
        <span style={{display:"flex",flexWrap:"wrap",gap:10}}>
          <Link href={"/meteo/"+slug} onNav={onNav} style={{background:"#fff",borderRadius:8,padding:"9px 14px",textDecoration:"none",fontWeight:700,color:M.navy}}>← {r.nome}</Link>
          <Link href="/meteo" onNav={onNav} style={{background:"#fff",borderRadius:8,padding:"9px 14px",textDecoration:"none",fontWeight:700,color:M.navy}}>Tutta l'Italia</Link>
        </span>
      </div>
      <span style={kicker}>{c.nome} ({c.prov}){p&&p.giorno?" · "+dataLunga(p.giorno):""}</span>
      <h1 style={{...h1,fontSize:"clamp(36px,6.4vw,62px)"}}>Meteo {c.nome} oggi</h1>
    </section>;
  if(!p) return <React.Fragment>{testata}<Stato testo="Le previsioni di questo comune arrivano entro le 7 di ogni mattina: riprova tra poco."/></React.Fragment>;
  const frase=[cap((DESC[p.cod]||"").toLowerCase()),"minima "+int(p.min)+"°, massima "+int(p.max)+"°",
    p.mm>=0.5?virg(p.mm)+" mm di pioggia"+(Array.isArray(p.fasce)&&p.fasce.reduce((a,x)=>a+(x.mm||0),0)<0.5?" nella notte":""):"niente pioggia",
    p.raff!=null?"raffiche fino a "+int(p.raff)+" km/h"+(p.dir!=null?" da "+bussola(p.dir):""):null].filter(Boolean).join(", ")+".";
  const pp={...p,nome:c.nome};
  const ora=c.aggiornato_il?new Intl.DateTimeFormat("it-IT",{timeZone:"Europe/Rome",hour:"2-digit",minute:"2-digit"}).format(new Date(c.aggiornato_il)):null;
  return <React.Fragment>
    {testata}
    <p style={{...lead,marginTop:-30}}>{frase}</p>
    <div style={{marginTop:-30}}><Condividi url={"/meteo/"+slug+"/"+cs} testo={"Il meteo di oggi a "+c.nome}/></div>

    <Adesso slug={slug} citta={capo?capo.nome:null}/>

    <section style={{...card,display:"flex",flexDirection:"column",gap:14,borderLeft:"6px solid "+M.gold}}>
      <div style={{display:"flex",flexWrap:"wrap",alignItems:"center",gap:"10px 24px"}}>
        <span style={{display:"flex",alignItems:"center",gap:10}}><Icona cod={p.cod} s={52}/><span style={{fontFamily:"Anton",fontSize:44,color:M.ink}}>{int(p.min)}° / {int(p.max)}°</span></span>
        <span style={{display:"flex",flexDirection:"column",gap:4,fontSize:17,color:M.soft}}>
          <span style={{fontWeight:700,color:M.navy}}>{DESC[p.cod]||""}</span>
          <span><span style={{color:M.rain,fontWeight:700}}>{mm(p.mm)}</span>{p.raff!=null?" · raffica "+int(p.raff)+" km/h"+(p.dir!=null?" da "+bussola(p.dir):""):""}{p.neve>=0.1?" · neve "+virg(p.neve)+" cm":""}</span>
          {ora&&<span style={{fontSize:14,color:M.gray}}>Aggiornato alle {ora}</span>}
        </span>
      </div>
      <Fasce p={p}/>
    </section>

    <Grafico punti={[pp]} scelte={[c.nome]} iniziale={c.nome}/>

    {(p.tend||[]).length>0&&<section style={{display:"flex",flexDirection:"column",gap:14}}>
      <Intestazione titolo={"I prossimi giorni "+a_(c.nome)} sotto="Tendenza ECMWF. Oltre domani può cambiare."/>
      <div style={{display:"grid",gridTemplateColumns:"repeat(auto-fit,minmax(150px,1fr))",gap:12}}>
        {p.tend.map(t=><div key={t.d} style={{...card,padding:16,display:"flex",flexDirection:"column",gap:6,borderTop:"4px solid "+M.gold}}>
          <span style={{fontFamily:"Anton",fontSize:21,color:M.navy}}>{nomeGiorno(t.d)}</span>
          <span style={{fontSize:13,color:M.gray}}>{dataBreve(t.d)}</span>
          <span style={{display:"flex",alignItems:"center",gap:8}}><Icona cod={t.cod} s={26}/><span style={{fontSize:18,fontWeight:700}}>{int(t.min)}° / {int(t.max)}°</span></span>
          <span style={{fontSize:14,color:M.soft}}>{(DESC[t.cod]||"")+(t.mm>=0.5?", "+virg(t.mm)+" mm":"")}</span>
        </div>)}
      </div>
    </section>}

    {(capo||vicini.length>0)&&<section style={{display:"flex",flexDirection:"column",gap:10}}>
      <span style={{fontSize:16,fontWeight:700,color:M.navy}}>Altri comuni della provincia</span>
      <div style={{display:"flex",flexWrap:"wrap",gap:8}}>
        {capo&&<Link href={urlCitta(slug,capo.nome)} onNav={onNav} style={{background:M.navy,borderRadius:999,padding:"8px 14px",textDecoration:"none",fontWeight:700,color:"#fff"}}>{capo.nome}</Link>}
        {vicini.filter(x=>!x.cap).slice(0,40).map(x=><Link key={x.slug} href={urlComune(x)} onNav={onNav} style={{background:"#fff",borderRadius:999,padding:"8px 14px",textDecoration:"none",fontWeight:700,color:M.blue}}>{x.nome}</Link>)}
        {vicini.length>40&&<Link href={"/meteo/"+slug} onNav={onNav} style={{padding:"8px 6px",fontWeight:700,color:M.navy}}>Tutti i comuni →</Link>}
      </div>
    </section>}
    <p style={{fontSize:13,color:M.gray,margin:0}}>Fonti: ItaliaMeteo-ARPAE ICON-2I ed ECMWF IFS (CC BY 4.0) via Open-Meteo. "Adesso": bollettini METAR degli aeroporti o stima del modello.</p>
  </React.Fragment>;
}

// ---------- Cerca una citta' (solo pagine meteo) ----------
// 110 capoluoghi + le 20 regioni, senza chiamate: l'elenco e' in shared/meteo-geo.js.
const normC=(t)=>String(t||"").normalize("NFD").replace(/[\u0300-\u036f]/g,"").toLowerCase().replace(/[^a-z]/g,"");
const INDICE=[...METEO_REGIONI.flatMap(r=>r.citta.map(c=>({nome:c,slug:r.slug,reg:r.nome,tipo:"citta"}))),...METEO_REGIONI.map(r=>({nome:r.nome,slug:r.slug,reg:"Regione",tipo:"regione"}))];
let CERCATA=null;
function Cerca({onNav}){
  const [q,setQ]=useState(""); const [sel,setSel]=useState(0); const [aperto,setAperto]=useState(false);
  const [top,setTop]=useState(0);
  useEffect(()=>{ const h=document.querySelector("header"); const f=()=>setTop(h?h.offsetHeight:0); f(); window.addEventListener("resize",f); return ()=>window.removeEventListener("resize",f); },[]);
  const [voglio,setVoglio]=useState(false);
  const tutti=useComuni(voglio);
  const n=normC(q);
  const indice=tutti?[...INDICE,...tutti.filter(x=>!x.cap).map(x=>({nome:x.nome,slug:x.reg,reg:x.prov+" · "+regNome(x.reg),tipo:"comune",cs:x.slug}))]:INDICE;
  const ris=n.length<2?[]:[...indice.filter(x=>normC(x.nome)===n),...indice.filter(x=>normC(x.nome)!==n&&normC(x.nome).startsWith(n)),...indice.filter(x=>!normC(x.nome).startsWith(n)&&normC(x.nome).includes(n))].slice(0,8);
  const vai=(x)=>{ if(!x) return; setQ(""); setAperto(false); setSel(0);
    onNav(x.tipo==="citta"?urlCitta(x.slug,x.nome):x.tipo==="comune"?"/meteo/"+x.slug+"/"+x.cs:"/meteo/"+x.slug); };
  const tasto=(e)=>{ if(e.key==="ArrowDown"){ e.preventDefault(); setSel(i=>Math.min(i+1,ris.length-1)); }
    else if(e.key==="ArrowUp"){ e.preventDefault(); setSel(i=>Math.max(i-1,0)); }
    else if(e.key==="Enter"){ e.preventDefault(); vai(ris[sel]); }
    else if(e.key==="Escape"){ setAperto(false); } };
  return <div style={{position:"sticky",top,zIndex:15,background:M.bg,padding:"10px 18px",borderBottom:"1px solid "+M.line}}>
    <div style={{maxWidth:1200,margin:"0 auto",position:"relative"}}>
      <div style={{display:"flex",alignItems:"center",gap:10,background:"#fff",border:"2px solid "+M.line,borderRadius:12,padding:"0 14px"}}>
        <svg viewBox="0 0 24 24" width="20" height="20" aria-hidden="true"><circle cx="10.5" cy="10.5" r="6.5" fill="none" stroke={M.gray} strokeWidth="2.2"/><path d="M15.5 15.5L21 21" stroke={M.gray} strokeWidth="2.2" strokeLinecap="round"/></svg>
        <input type="search" value={q} placeholder="Cerca il meteo di un comune o di una regione" aria-label="Cerca il meteo di un comune o di una regione" role="combobox" aria-expanded={aperto&&ris.length>0} aria-controls="ia-cerca-lista" autoComplete="off"
          onChange={e=>{ setQ(e.target.value); setSel(0); setAperto(true); setVoglio(true); }} onFocus={()=>{ setAperto(true); setVoglio(true); }} onBlur={()=>setTimeout(()=>setAperto(false),150)} onKeyDown={tasto}
          style={{flex:1,border:"none",outline:"none",fontSize:17,padding:"12px 0",fontFamily:"Barlow",background:"transparent",color:M.ink,minWidth:0}}/>
      </div>
      {aperto&&ris.length>0&&<ul id="ia-cerca-lista" role="listbox" style={{position:"absolute",left:0,right:0,top:"100%",marginTop:6,listStyle:"none",padding:6,background:"#fff",borderRadius:12,boxShadow:"0 8px 28px rgba(15,26,46,.18)",zIndex:16}}>
        {ris.map((x,i)=><li key={x.tipo+x.nome+(x.cs||"")} role="option" aria-selected={i===sel} onMouseDown={e=>{ e.preventDefault(); vai(x); }} onMouseEnter={()=>setSel(i)}
          style={{display:"flex",justifyContent:"space-between",gap:12,padding:"10px 12px",borderRadius:8,cursor:"pointer",background:i===sel?M.bg:"transparent"}}>
          <span style={{fontWeight:700,color:M.navy}}>{x.nome}</span><span style={{color:M.gray,fontSize:14}}>{x.reg}</span>
        </li>)}
      </ul>}
      {aperto&&n.length>=2&&!ris.length&&<div style={{position:"absolute",left:0,right:0,top:"100%",marginTop:6,background:"#fff",borderRadius:12,boxShadow:"0 8px 28px rgba(15,26,46,.18)",padding:"12px 16px",color:M.soft,fontSize:15}}>Nessun comune con questo nome.</div>}
    </div>
  </div>;
}

// ---------- pagina ----------
export function meteoRoute(path){
  const mc=/^\/meteo\/([^/]+)\/([^/]+)\/?$/.exec(path||"");
  if(mc){ const rg=decodeURIComponent(mc[1]).toLowerCase(), cs=decodeURIComponent(mc[2]).toLowerCase(); const c=cittaDaSlug(rg,cs);
    if(c) return {tipo:"citta",regione:rg,citta:c};
    return regioneDaSlug(rg)&&/^[a-z-]+$/.test(cs)?{tipo:"comune",regione:rg,slug:cs}:{tipo:"nessuna"}; }
  const m=/^\/meteo(?:\/([^/]+))?\/?$/.exec(path||"");
  if(!m) return null;
  if(!m[1]) return {tipo:"hub"};
  const s=decodeURIComponent(m[1]).toLowerCase();
  const g=giornoDaUrl(s); if(g) return {tipo:"giorno",giorno:g};
  if(regioneDaSlug(s)) return {tipo:"regione",regione:s};
  return {tipo:"nessuna"};
}

const SITO="https://iattualita.it";
function seo(titolo,desc,url){
  document.title=titolo;
  let m=document.querySelector('meta[name="description"]'); if(!m){ m=document.createElement("meta"); m.setAttribute("name","description"); document.head.appendChild(m); }
  m.setAttribute("content",desc);
  const c=document.querySelector('link[rel="canonical"]'); if(c) c.setAttribute("href",SITO+url);
}

export function MeteoPage({path,onNav}){
  const rt=meteoRoute(path)||{tipo:"hub"};
  const [stato,setStato]=useState({carica:true});
  const [tent,setTent]=useState(0);
  const chiave=rt.tipo==="giorno"?rt.giorno:"ultimo";
  useEffect(()=>{
    let vivo=true; setStato(s=>({...s,carica:true,errore:null}));
    const q= rt.tipo==="giorno" ? "select=*&giorno=eq."+rt.giorno : "select=*&order=giorno.desc&limit=1";
    Promise.all([leggi(q), leggi("select=giorno,titolo&order=giorno.desc&limit=60"), (rt.tipo==="giorno"||rt.tipo==="citta"||rt.tipo==="comune")?Promise.resolve(null):caricaGeo()])
      .then(([r,a,geo])=>{ if(vivo) setStato({carica:false,riga:r[0]||null,archivio:a,geo}); })
      .catch(e=>{ if(vivo) setStato({carica:false,errore:String(e)}); });
    return ()=>{ vivo=false; };
  },[chiave,tent]);
  const riga=stato.riga;
  useEffect(()=>{
    if(!riga) return;
    if(rt.tipo==="hub") seo("Meteo di oggi in Italia · "+cap(dataLunga(riga.giorno))+" · Iattualità",(riga.titolo?riga.titolo+". ":"")+"Previsioni per tutte le regioni e 110 capoluoghi, con mappa, allerte della Protezione Civile e tendenza dei prossimi giorni. Dati ICON-2I ed ECMWF.","/meteo");
    else if(rt.tipo==="giorno") seo("Meteo di "+dataLunga(riga.giorno)+" · Iattualità",(riga.titolo?riga.titolo+". ":"")+"Città per città: minime, massime, pioggia ora per ora, raffiche, neve e zero termico.",urlDaGiorno(riga.giorno));
    else if(rt.tipo==="citta"){ const p=(riga.punti||[]).find(x=>x.nome===rt.citta); seo("Meteo "+rt.citta+" oggi e prossimi giorni · Iattualità","Meteo a "+rt.citta+" oggi: "+(p?((DESC[p.cod]||"")+", minima "+int(p.min)+"°, massima "+int(p.max)+"°"+(p.mm>=0.5?", "+virg(p.mm)+" mm di pioggia":"")+". "):"")+"Mattina, pomeriggio e sera, pioggia ora per ora, tempo osservato adesso e tendenza dei prossimi giorni.",urlCitta(rt.regione,rt.citta)); }
    else if(rt.tipo==="regione"){ const r=regioneDaSlug(rt.regione); const x=(riga.regioni||{})[rt.regione]||{}; seo("Meteo "+r.nome+" oggi · Iattualità",(x.testo||("Previsioni per i capoluoghi di provincia della regione "+r.nome+"."))+"","/meteo/"+rt.regione); }
    return ()=>{ document.title="Iattualità · L'informazione intelligente e in tempo reale"; const c=document.querySelector('link[rel="canonical"]'); if(c)c.setAttribute("href",SITO+"/"); };
  },[riga,path]);

  let corpo;
  if(rt.tipo==="nessuna") corpo=<Stato testo="Questa pagina del meteo non esiste"/>;
  else if((stato.carica&&!riga)||(rt.tipo!=="giorno"&&rt.tipo!=="citta"&&rt.tipo!=="comune"&&riga&&!(stato.geo||GEO)&&!stato.errore)) corpo=<Stato testo="Carico le previsioni…"/>;
  else if(stato.errore) corpo=<Stato testo="Non riesco a caricare il meteo" errore onRiprova={()=>setTent(t=>t+1)}/>;
  else if(!riga) corpo=<Stato testo={rt.tipo==="giorno"?"Nessuna previsione salvata per questo giorno":"Le previsioni di oggi stanno arrivando"}/>;
  else if(rt.tipo==="giorno") corpo=<Giorno riga={riga} archivio={stato.archivio||[]} onNav={onNav}/>;
  else if(rt.tipo==="comune") corpo=<Comune slug={rt.regione} cs={rt.slug} onNav={onNav}/>;
  else if(rt.tipo==="citta") corpo=<Citta riga={riga} slug={rt.regione} nome={rt.citta} onNav={onNav}/>;
  else if(rt.tipo==="regione") corpo=<Regione riga={riga} slug={rt.regione} geo={stato.geo||GEO} onNav={onNav}/>;
  else corpo=<Hub riga={riga} archivio={stato.archivio||[]} geo={stato.geo||GEO} onNav={onNav}/>;
  return <div style={{background:M.bg,color:M.ink,fontFamily:"Barlow",minHeight:"70vh"}}>
    {rt.tipo!=="nessuna"&&<Cerca onNav={onNav}/>}
    <main id="top" style={{maxWidth:1200,margin:"0 auto",padding:"28px 18px 56px",display:"flex",flexDirection:"column",gap:44,boxSizing:"border-box"}}>{corpo}</main>
  </div>;
}
