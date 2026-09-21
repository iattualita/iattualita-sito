// shared/site-pages.js
//
// L'unica copia dei dati che servono sia al sito che ai crawler.
//
// Prima questi testi esistevano due volte, in app.jsx e in prerender.js, e i
// commenti di entrambi i file avvisavano di ricordarsi di aggiornare l'altro.
// Bastava dimenticarsene una volta perche' il lettore vedesse la versione
// nuova e Google quella vecchia. Anche slugify() girava in quattro copie: se
// una sola fosse cambiata, sitemap e link agli articoli avrebbero smesso di
// combaciare e Google avrebbe trovato URL che non esistono.
//
// Chi importa questo file:
//   app.jsx                              (il sito che vede il lettore)
//   netlify/edge-functions/prerender.js  (l'HTML che vede il crawler)
//   netlify/edge-functions/sitemap.js
//   netlify/edge-functions/news-sitemap.js
//   netlify/edge-functions/rss.js

// Trasforma un titolo nella parte leggibile dell'indirizzo. Deve restare
// stabile nel tempo: cambiarla significa cambiare l'URL di ogni articolo
// gia' pubblicato, e quindi perdere il posizionamento acquisito.
export function slugify(s) {
  return (
    (s || "")
      .toString()
      .toLowerCase()
      .normalize("NFD")
      .replace(/[̀-ͯ]/g, "")
      .replace(/[^a-z0-9]+/g, "-")
      .replace(/^-+|-+$/g, "")
      .slice(0, 60) || "articolo"
  );
}

// URL breve per le serie che meritano un indirizzo proprio; le altre vivono
// su /serie/<slug>. Una serie ha sempre un solo URL: niente doppioni.
export const SERIE_ALIAS = { "Podcast": "/podcast" };

export function seriePath(s) {
  return SERIE_ALIAS[s] || "/serie/" + slugify(s);
}

// Le colonne di site_info che contengono l'indirizzo di un canale social.
export const SOCIALS = [
  { k: "tiktok", n: "TikTok", col: "#000000", ic: "tk" },
  { k: "instagram", n: "Instagram", col: "#C13584", ic: "ig" },
  { k: "facebook", n: "Facebook", col: "#1877F2", ic: "fb" },
  { k: "youtube", n: "YouTube", col: "#FF0000", ic: "yt" },
  { k: "threads", n: "Threads", col: "#000000", ic: "th" }
];

// Le pagine istituzionali. Sono quelle da cui Google News valuta la testata:
// chi firma, con quali regole, come si correggono gli errori, come si usa
// l'IA. Modificarle qui le aggiorna ovunque.
export const STATIC_PAGES = {
  "chi-siamo":{ title:"Chi siamo · Iattualità", desc:"Iattualità è un progetto di informazione indipendente: attualità, geopolitica, inchieste ed economia verificate con i dati, senza appartenenze politiche.", h1:"Chi siamo",
    intro:"Iattualità è un progetto di informazione indipendente. Raccontiamo attualità, geopolitica, inchieste ed economia con un metodo semplice: verificare con i dati e lasciare il giudizio a chi legge.",
    blocks:[
      {h:"La nostra missione",p:["Viviamo in un'epoca di informazione veloce e spesso urlata. Noi proviamo a fare il contrario: controllare prima di pubblicare, distinguere i fatti dalle opinioni e restare fuori dagli schieramenti. Mostriamo ciò che è documentato; le conclusioni le trai tu."]},
      {h:"Chi c'è dietro",p:["La direzione e la responsabilità editoriale di Iattualità sono di Lorenzo, che coordina le scelte editoriali, la verifica delle fonti e la produzione dei contenuti. Dietro ogni pubblicazione c'è una persona reale che se ne assume la responsabilità."]},
      {h:"Come lavoriamo",p:["Seguiamo regole precise su verifica, imparzialità e rispetto delle persone: le trovi nella pagina Standard editoriali. Quando commettiamo un errore lo correggiamo in modo trasparente, come spiegato nella pagina Rettifiche."]},
      {h:"Il presentatore in IA",p:["Il volto e la voce dei nostri video sono generati con strumenti di intelligenza artificiale, ma le decisioni editoriali restano umane. Lo raccontiamo per intero nella pagina Trasparenza sull'IA: l'IA è il volto, non il cervello."]}
    ]
  },
  "standard-editoriali":{ title:"Standard editoriali · Iattualità", desc:"Le regole che Iattualità segue prima di pubblicare: verifica con i dati, separazione tra fatti e opinioni, presunzione di innocenza, imparzialità.", h1:"Standard editoriali",
    intro:"Le regole che seguiamo prima di pubblicare qualsiasi cosa. Sono ciò che rende l'informazione di Iattualità verificata e senza appartenenze.",
    blocks:[
      {h:"Verifica con i dati",p:["Nessun contenuto esce senza un controllo delle fonti. Diamo la precedenza a fonti primarie e ufficiali e, quando possibile, incrociamo più fonti indipendenti."]},
      {h:"Fatti e opinioni separati",p:["Distinguiamo ciò che è documentato da ciò che è interpretazione. Sulle notizie non ancora confermate usiamo il condizionale — secondo, avrebbe, si ipotizza — e lo segnaliamo chiaramente."]},
      {h:"Presunzione di innocenza",p:["Sulle vicende giudiziarie vale la presunzione di innocenza: indagato non significa colpevole. Non presentiamo come responsabili persone che sono soltanto indagate o imputate, e non le indichiamo come colpevoli nelle immagini di copertina."]},
      {h:"Indipendenza e imparzialità",p:["Non abbiamo appartenenze politiche. Sui temi divisivi presentiamo le posizioni in campo senza sposarne nessuna: il nostro compito è dare gli elementi, non dire da che parte stare."]},
      {h:"Rispetto delle persone",p:["Massima cautela quando ci sono vittime, minori o situazioni personali delicate. In questi casi rinunciamo a toni sensazionalistici e a qualsiasi dettaglio non necessario."]},
      {h:"Fonti e citazioni",p:["Attribuiamo le informazioni alle loro fonti e riportiamo solo dichiarazioni verificate quando citiamo persone pubbliche."]}
    ]
  },
  "rettifiche":{ title:"Rettifiche e correzioni · Iattualità", desc:"Come Iattualità corregge gli errori in modo trasparente e come segnalarne uno.", h1:"Rettifiche e correzioni",
    intro:"Sbagliare è possibile; lasciare un errore online, no. Quando un contenuto contiene un'imprecisione, la correggiamo in modo trasparente.",
    blocks:[
      {h:"Come segnalare un errore",p:["Se noti un dato sbagliato o impreciso, scrivici indicando il contenuto e, se possibile, la fonte corretta. Valutiamo ogni segnalazione con attenzione."]},
      {h:"Come correggiamo",p:["Se la segnalazione è fondata aggiorniamo il contenuto e, quando l'errore è sostanziale, lo indichiamo apertamente invece di modificare in silenzio. Se un video già pubblicato contiene un'imprecisione, aggiungiamo una nota di rettifica nei commenti o nella descrizione."]},
      {h:"Tempi",p:["Interveniamo il prima possibile dopo aver verificato la segnalazione."]}
    ]
  },
  "trasparenza-ia":{ title:"Trasparenza sull'IA · Iattualità", desc:"Iattualità usa un avatar e una voce generati con l'intelligenza artificiale, ma le decisioni editoriali restano umane. L'IA è il volto, non il cervello.", h1:"Trasparenza sull'intelligenza artificiale",
    intro:"Usiamo l'intelligenza artificiale come strumento di produzione. Le decisioni, però, restano umane. Come diciamo noi: l'IA è il volto, non il cervello.",
    blocks:[
      {h:"Cosa fa l'IA",p:["Il presentatore che vedi nei nostri video è un avatar generato con strumenti di IA, con voce sintetizzata. Serve a dare un volto e una voce riconoscibili ai contenuti."]},
      {h:"Cosa resta umano",p:["La scelta delle notizie, la verifica dei fatti, la scrittura dei testi e la responsabilità editoriale sono di Lorenzo, direttore di Iattualità. Nessun contenuto viene pubblicato senza un controllo umano."]},
      {h:"Perché lo diciamo",p:["Crediamo che chi ci segue abbia diritto di sapere come è fatto ciò che guarda. La tecnologia cambia la forma, non il patto con il pubblico: informazione verificata con i dati e senza appartenenze."]}
    ]
  },
  "privacy":{ title:"Privacy policy · Iattualità", desc:"Come Iattualità tratta i dati personali di chi si iscrive alla newsletter, scrive dai contatti o naviga il sito. Informativa ai sensi del GDPR.", h1:"Privacy policy",
    intro:"Questa pagina spiega quali dati personali raccogliamo, perché, per quanto tempo li conserviamo e quali diritti hai. La aggiorniamo quando cambiano gli strumenti che usiamo.",
    blocks:[
      {h:"Contitolari del trattamento",p:["Iattualità è gestita da André Renzuto Iodice e Nicola Ferrone, che determinano insieme finalità e modalità del trattamento e ne sono pertanto contitolari ai sensi dell'art. 26 del Regolamento (UE) 2016/679. Puoi rivolgere a entrambi qualsiasi richiesta relativa ai tuoi dati scrivendo a redazione@iattualita.it, punto di contatto unico per gli interessati.","Recapito di riferimento: redazione@iattualita.it."]},
      {h:"Quali dati raccogliamo",p:["Newsletter: quando ti iscrivi raccogliamo il tuo indirizzo email e la data di iscrizione e di conferma. Non chiediamo altri dati.","Contatti: se ci scrivi tramite il modulo di contatto, raccogliamo i dati che inserisci (nome, email, oggetto, messaggio) per poterti rispondere.","Navigazione: raccogliamo statistiche di visita in forma aggregata e anonima, senza cookie e senza identificarti."]},
      {h:"Perché li usiamo e con quale base giuridica",p:["Newsletter: per inviarti i nostri aggiornamenti. La base giuridica è il tuo consenso, che presti confermando l'iscrizione con il doppio opt-in e che puoi revocare in ogni momento.","Contatti: per rispondere alla tua richiesta. La base giuridica è il riscontro alla tua richiesta e il nostro legittimo interesse a gestire le comunicazioni.","Statistiche: per capire quali contenuti funzionano, in forma anonima. La base giuridica è il legittimo interesse a migliorare il sito, senza profilazione."]},
      {h:"Newsletter e doppio consenso",p:["Usiamo il doppio opt-in: dopo l'iscrizione ti inviamo un'email di conferma, e sei iscritto solo se clicchi il link. Ogni email contiene un link di disiscrizione immediato. Per l'invio ci appoggiamo a Brevo (Sendinblue), che tratta il tuo indirizzo come responsabile per nostro conto."]},
      {h:"Statistiche senza cookie",p:["Per le statistiche di visita usiamo Umami, uno strumento che non installa cookie di profilazione e non raccoglie dati che permettano di identificarti. Per questo il sito non mostra un banner cookie di profilazione: non ne usiamo."]},
      {h:"Con chi condividiamo i dati",p:["Non vendiamo e non cediamo i tuoi dati a terzi per finalità commerciali. Ci avvaliamo di alcuni fornitori che trattano i dati per nostro conto, come responsabili: Brevo per l'invio della newsletter, Netlify per l'hosting del sito, Supabase per l'archiviazione degli iscritti. Alcuni di questi fornitori possono trattare i dati anche fuori dall'Unione Europea; in tal caso il trasferimento avviene con le garanzie previste dalla normativa (ad esempio le clausole contrattuali standard)."]},
      {h:"Per quanto tempo li conserviamo",p:["Conserviamo il tuo indirizzo email finché resti iscritto alla newsletter. Se ti disiscrivi, l'indirizzo viene marcato come disiscritto e non riceverai più comunicazioni. I messaggi inviati dai contatti sono conservati per il tempo necessario a gestire la richiesta."]},
      {h:"I tuoi diritti",p:["Puoi chiedere in ogni momento di accedere ai tuoi dati, correggerli, cancellarli, limitarne il trattamento o opporti, oltre a revocare il consenso alla newsletter. Per esercitare questi diritti scrivi a redazione@iattualita.it: la disiscrizione è comunque possibile con un clic dal link presente in ogni email.","Se ritieni che il trattamento violi la normativa, hai diritto di presentare reclamo all'autorità di controllo competente (in Italia, il Garante per la protezione dei dati personali)."]},
      {h:"Modifiche a questa informativa",p:["Possiamo aggiornare questa pagina se cambiano gli strumenti o le finalità del trattamento. La versione pubblicata su questa pagina è sempre quella in vigore."]}
    ]
  }
};
