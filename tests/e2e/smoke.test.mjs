// Rooktest: demo-login, dashboard rendert, KPI-kaarten even hoog, geen errors.
import { BASE, launch, login, collectErrors, fail } from "./helpers.mjs";

const b = await launch();
const p = await b.newPage({ viewport: { width: 1280, height: 900 } });
const errs = collectErrors(p);

await login(p, "info@janssen.nl", "janssen123");
await p.goto(`${BASE}/app/analytics`, { waitUntil: "domcontentloaded" });
await p.waitForTimeout(2500);

const body = await p.locator("body").innerText();
if (!/analytics/i.test(body)) fail("Analytics-view rendert niet");

// KPI-kaarten (kaart met een .display-waarde, kleiner dan grafiekkaarten)
// moeten allemaal exact even hoog zijn.
const heights = await p.$$eval(".card", (cards) =>
  cards
    .filter((c) => c.querySelector(".display"))
    .map((c) => Math.round(c.getBoundingClientRect().height))
    .filter((h) => h > 0 && h < 200));
const unique = [...new Set(heights)];
if (heights.length < 4 || unique.length > 1) fail(`KPI-hoogtes ongelijk: ${JSON.stringify(unique)}`);

if (errs.length) fail(`page errors: ${errs.join("; ")}`);
await b.close();
console.log(`smoke OK (${heights.length} KPI-kaarten op ${unique[0]}px)`);
