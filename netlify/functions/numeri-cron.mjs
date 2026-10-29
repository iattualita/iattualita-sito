// netlify/functions/numeri-cron.mjs
// Ogni notte alle 03:20 UTC (4-5 in Italia) aggiorna follower e
// visualizzazioni di YouTube, Instagram e Facebook per la pagina /numeri.
// Le piattaforme senza variabili d'ambiente vengono saltate (vedi
// _numeri-lib.js).
import N from "./_numeri-lib.js";

export default async () => {
  try {
    const esito = await N.aggiornaTutto();
    console.log("numeri-cron:", JSON.stringify(esito));
    return new Response(JSON.stringify(esito), { status: 200 });
  } catch (e) {
    console.error("numeri-cron errore:", e && e.message);
    return new Response("errore: " + (e && e.message), { status: 500 });
  }
};

export const config = { schedule: "20 3 * * *" };
