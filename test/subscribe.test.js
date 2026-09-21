// Esercita subscribe.js sostituendo _newsletter-lib con uno stub,
// cosi' nessuna chiamata parte davvero verso Supabase o Brevo.
const path = require("path");
const REPO = path.join(__dirname, "..");
const LIB = path.join(REPO, "netlify/functions/_newsletter-lib.js");
const SUB = path.join(REPO, "netlify/functions/subscribe.js");

let calls;
function makeStub({ existing = null, allow = () => true } = {}) {
  return {
    config: { SERVICE_ROLE: "x", BREVO_API_KEY: "y" },
    json: (statusCode, obj) => ({ statusCode, body: JSON.stringify(obj) }),
    validEmail: (e) => /^[^@\s]+@[^@\s]+\.[^@\s]+$/.test(e),
    clientIp: () => "1.2.3.4",
    rateHit: async (key, w, m) => { calls.rate.push(key); return allow(key); },
    sbSelectByEmail: async () => existing,
    sbInsert: async (email) => { calls.insert.push(email); },
    sbPatch: async (id, p) => { calls.patch.push([id, p.status]); },
    newToken: () => "tok-123",
    confirmEmailHtml: () => "<p>ciao</p>",
    confirmSender: { name: "R", email: "conferma@iattualita.it" },
    brevoSend: async (to) => { calls.sent.push(to); return true; }
  };
}

async function run(name, { body, stubOpts, expect }) {
  calls = { rate: [], insert: [], patch: [], sent: [] };
  delete require.cache[SUB];
  require.cache[LIB] = { id: LIB, filename: LIB, loaded: true, exports: makeStub(stubOpts) };
  const { handler } = require(SUB);
  const res = await handler({ httpMethod: "POST", headers: {}, body: JSON.stringify(body) });
  const got = { status: res.statusCode, state: JSON.parse(res.body).state, sent: calls.sent.length };
  const ok = got.status === expect.status && got.state === expect.state && got.sent === expect.sent;
  console.log((ok ? "  PASS  " : "> FAIL <") + name);
  if (!ok) console.log("          atteso", JSON.stringify(expect), "ottenuto", JSON.stringify(got));
  return ok;
}

(async () => {
  const results = [];

  results.push(await run("iscrizione normale: manda una mail", {
    body: { email: "nuovo@esempio.it" },
    expect: { status: 200, state: "sent", sent: 1 }
  }));

  results.push(await run("honeypot pieno: finge successo, non manda nulla", {
    body: { email: "bot@esempio.it", website: "http://spam.example" },
    expect: { status: 200, state: "sent", sent: 0 }
  }));

  results.push(await run("email non valida: 400, non manda nulla", {
    body: { email: "non-una-email" },
    expect: { status: 400, state: undefined, sent: 0 }
  }));

  results.push(await run("tetto per IP superato: 429, non manda nulla", {
    body: { email: "tizio@esempio.it" },
    stubOpts: { allow: (k) => !k.startsWith("sub:ip:") },
    expect: { status: 429, state: undefined, sent: 0 }
  }));

  results.push(await run("cooldown 15 min: risponde ok ma non manda", {
    body: { email: "vittima@esempio.it" },
    stubOpts: { allow: (k) => !k.startsWith("sub:mail:") },
    expect: { status: 200, state: "sent", sent: 0 }
  }));

  results.push(await run("tetto giornaliero: risponde ok ma non manda", {
    body: { email: "vittima@esempio.it" },
    stubOpts: { allow: (k) => !k.startsWith("sub:day:") },
    expect: { status: 200, state: "sent", sent: 0 }
  }));

  results.push(await run("gia' confermato: nessuna mail, nessun contatore email", {
    body: { email: "socio@esempio.it" },
    stubOpts: { existing: { id: 7, status: "confirmed" } },
    expect: { status: 200, state: "already_confirmed", sent: 0 }
  }));
  const noEmailCounter = !calls.rate.some((k) => k.startsWith("sub:mail:") || k.startsWith("sub:day:"));
  console.log((noEmailCounter ? "  PASS  " : "> FAIL <") + "  ^ e infatti non consuma il contatore per indirizzo");
  results.push(noEmailCounter);

  results.push(await run("re-iscrizione di un disiscritto: torna pending e manda", {
    body: { email: "tornato@esempio.it" },
    stubOpts: { existing: { id: 9, status: "unsubscribed" } },
    expect: { status: 200, state: "resent", sent: 1 }
  }));
  const wentPending = calls.patch.length === 1 && calls.patch[0][1] === "pending";
  console.log((wentPending ? "  PASS  " : "> FAIL <") + "  ^ e lo rimette in stato pending");
  results.push(wentPending);

  const failed = results.filter((r) => !r).length;
  console.log("\n" + results.length + " controlli, " + failed + " falliti");
  process.exit(failed ? 1 : 0);
})();
