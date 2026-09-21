// Verifica che conferma e disiscrizione non scattino su una semplice GET:
// e' cio' che impedisce ai filtri antivirus e ai precaricatori dei client di
// posta di iscrivere o disiscrivere qualcuno al posto suo.
const path = require("path");
const REPO = path.join(__dirname, "..");
const LIB = path.join(REPO, "netlify/functions/_newsletter-lib.js");
const vero = require(LIB);

let patch;
function stub(sub) {
  return Object.assign({}, vero, {
    sbSelectByToken: async () => sub,
    sbPatch: async (id, p) => { patch.push([id, p.status]); }
  });
}

async function call(fnFile, sub, method) {
  const F = path.join(REPO, "netlify/functions", fnFile);
  patch = [];
  delete require.cache[F];
  require.cache[LIB] = { id: LIB, filename: LIB, loaded: true, exports: stub(sub) };
  const res = await require(F).handler({ httpMethod: method, queryStringParameters: { token: "tok" } });
  return { status: res.statusCode, body: res.body, patch };
}

const results = [];
function check(name, cond, extra) {
  results.push(cond);
  console.log((cond ? "  PASS  " : "> FAIL <") + name);
  if (!cond && extra) console.log("          " + extra);
}

(async () => {
  // ---- conferma ----
  let r = await call("confirm.js", { id: 1, status: "pending" }, "GET");
  check("conferma, GET: mostra il pulsante e non conferma niente",
    r.status === 200 && r.patch.length === 0 && /<form method="post"/.test(r.body) && /Confermo l'iscrizione/.test(r.body));

  r = await call("confirm.js", { id: 1, status: "pending" }, "POST");
  check("conferma, POST: conferma davvero",
    r.status === 200 && r.patch.length === 1 && r.patch[0][1] === "confirmed", JSON.stringify(r.patch));

  r = await call("confirm.js", { id: 1, status: "confirmed" }, "GET");
  check("conferma, gia' confermato: lo dice e non riscrive nulla",
    r.status === 200 && r.patch.length === 0 && /già iscritto/.test(r.body));

  r = await call("confirm.js", null, "POST");
  check("conferma, token inesistente: 404 e nessuna scrittura", r.status === 404 && r.patch.length === 0);

  // ---- disiscrizione ----
  r = await call("unsubscribe.js", { id: 2, status: "confirmed" }, "GET");
  check("disiscrizione, GET: chiede conferma e non disiscrive",
    r.status === 200 && r.patch.length === 0 && /<form method="post"/.test(r.body));

  r = await call("unsubscribe.js", { id: 2, status: "confirmed" }, "POST");
  check("disiscrizione, POST: disiscrive davvero (e' anche la richiesta che manda Gmail)",
    r.status === 200 && r.patch.length === 1 && r.patch[0][1] === "unsubscribed", JSON.stringify(r.patch));

  r = await call("unsubscribe.js", { id: 2, status: "unsubscribed" }, "POST");
  check("disiscrizione ripetuta: nessuna riscrittura", r.status === 200 && r.patch.length === 0);

  // ---- il token finisce nell'HTML: non deve poter iniettare markup ----
  const F = path.join(REPO, "netlify/functions/confirm.js");
  delete require.cache[F];
  require.cache[LIB] = { id: LIB, filename: LIB, loaded: true, exports: stub({ id: 3, status: "pending" }) };
  const res = await require(F).handler({
    httpMethod: "GET",
    queryStringParameters: { token: '"><script>alert(1)</script>' }
  });
  check("token malevolo: non esce markup nell'attributo del form",
    !/<script>alert/.test(res.body), res.body.match(/<form[^>]*>/));

  const falliti = results.filter((x) => !x).length;
  console.log("\n" + results.length + " controlli, " + falliti + " falliti");
  process.exit(falliti ? 1 : 0);
})();
