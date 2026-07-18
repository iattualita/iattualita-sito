// netlify/functions/digest-cron.mjs
// Invio automatico del digest: ogni domenica alle 07:00 UTC (8-9 in Italia).
// SPENTO di default: parte solo se la variabile d'ambiente NEWSLETTER_AUTO
// vale "on". Cosi' l'invio resta manuale finche' non decidi tu.
import L from "./_newsletter-lib.js";

export default async () => {
  if ((process.env.NEWSLETTER_AUTO || "").toLowerCase() !== "on") {
    console.log("digest-cron: NEWSLETTER_AUTO non è 'on', nessun invio.");
    return new Response("auto off", { status: 200 });
  }
  try {
    const out = await L.runDigest({ dry: false });
    console.log("digest-cron:", JSON.stringify(out));
    return new Response(JSON.stringify(out), { status: 200 });
  } catch (e) {
    console.error("digest-cron errore:", e && e.message);
    return new Response("errore: " + (e && e.message), { status: 500 });
  }
};

export const config = { schedule: "0 7 * * 0" };
