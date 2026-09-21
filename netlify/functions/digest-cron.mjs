// netlify/functions/digest-cron.mjs
// Invio automatico del digest: ogni domenica alle 07:00 UTC (8-9 in Italia).
// SPENTO di default: parte solo se la variabile d'ambiente NEWSLETTER_AUTO
// vale "on". Cosi' l'invio resta manuale finche' non decidi tu.
import L from "./_newsletter-lib.js";

// Quanto tempo concedersi prima di fermarsi da soli. Le funzioni
// programmate di Netlify hanno un tetto di durata: meglio chiudere in
// ordine che essere interrotti di colpo. Fermarsi non fa danni, perche'
// l'invio e' ripartibile e chi ha gia' ricevuto viene saltato.
const BUDGET_MS = 20000;

export default async () => {
  if ((process.env.NEWSLETTER_AUTO || "").toLowerCase() !== "on") {
    console.log("digest-cron: NEWSLETTER_AUTO non è 'on', nessun invio.");
    return new Response("auto off", { status: 200 });
  }
  const scadenza = Date.now() + BUDGET_MS;
  let inviate = 0, fallite = 0, out = null;
  try {
    // A blocchi finche' non e' finito o finche' c'e' tempo.
    for (;;) {
      out = await L.runDigest({ dry: false });
      if (!out.sent) break;                     // niente articoli o niente iscritti
      inviate += out.delivered || 0;
      fallite += out.failed || 0;
      if (out.done) break;
      if (!out.delivered) {                     // guasto vero, non lentezza
        console.error("digest-cron: nessun invio riuscito, mi fermo.");
        break;
      }
      if (Date.now() > scadenza) {
        console.warn(
          "digest-cron: tempo esaurito dopo " + inviate + " iscritti, ne restano " +
          out.remaining + ". Nessun doppione: premi 'Invia newsletter' in redazione per completare."
        );
        break;
      }
    }
    const esito = { inviate, fallite, completato: !!(out && out.done), motivo: out && out.reason };
    console.log("digest-cron:", JSON.stringify(esito));
    return new Response(JSON.stringify(esito), { status: 200 });
  } catch (e) {
    console.error("digest-cron errore:", e && e.message, "— inviate finora:", inviate);
    return new Response("errore: " + (e && e.message), { status: 500 });
  }
};

export const config = { schedule: "0 7 * * 0" };
