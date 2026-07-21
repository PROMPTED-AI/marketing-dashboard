// Raamwerk: pagina rendert de juiste rijen per raamwerk, e-commerce heeft geen
// rij Kosten Beslist, een invulveld slaat op en blijft staan na herladen.
import { BASE, launch, login, collectErrors, fail } from "./helpers.mjs";

const b = await launch();
const p = await b.newPage({ viewport: { width: 1440, height: 900 } });
const errs = collectErrors(p);

await login(p, "info@janssen.nl", "janssen123");
await p.goto(`${BASE}/app/framework`, { waitUntil: "domcontentloaded" });
await p.waitForTimeout(2500);

// Sidebar-item aanwezig.
if (!(await p.locator('a[href="/app/framework"]').count())) fail("Sidebar-item Raamwerk ontbreekt");

// Demo-org is e-commerce: het e-commerce raamwerk hoort standaard actief te zijn.
let body = await p.locator("body").innerText();
for (const rij of ["Budget", "Advertentiekosten", "Opbrengst excl. btw", "ROAS campagne", "POAS", "Retouren"]) {
  if (!body.includes(rij)) fail(`E-commerce rij ontbreekt: ${rij}`);
}
if (/kosten beslist/i.test(body)) fail("Rij Kosten Beslist mag niet in het e-commerce raamwerk staan");

// Uitklapbare advertentiekosten: subrijen Google Ads en META Ads verschijnen.
await p.locator('button[title="Toon de uitsplitsing"]').first().click();
await p.waitForTimeout(300);
body = await p.locator("body").innerText();
if (!body.includes("Google Ads") || !body.includes("META Ads")) fail("Uitsplitsing advertentiekosten ontbreekt");

// Wissel naar leadgeneratie: eigen rijen, geen POAS.
await p.getByRole("button", { name: "Leadgeneratie" }).click();
await p.waitForTimeout(400);
body = await p.locator("body").innerText();
for (const rij of ["Kosten per lead", "Kosten per klant", "Aantal conversies"]) {
  if (!body.includes(rij)) fail(`Leadgen rij ontbreekt: ${rij}`);
}
if (body.includes("POAS")) fail("POAS hoort niet in het leadgen-raamwerk");

// Invulveld: budget van de nieuwste maand invullen, opslaan bij blur en
// terugzien na herladen.
const inputs = p.locator('input[aria-label^="Budget"]');
const laatste = inputs.last();
await laatste.fill("1234");
await laatste.blur();
await p.waitForTimeout(1200);
await p.reload({ waitUntil: "domcontentloaded" });
await p.waitForTimeout(2500);
const waarde = await p.locator('input[aria-label^="Budget"]').last().inputValue();
if (waarde !== "1234") fail(`Budget niet bewaard na herladen: "${waarde}"`);

// Opruimen zodat de test herhaalbaar blijft.
const veld = p.locator('input[aria-label^="Budget"]').last();
await veld.fill("");
await veld.blur();
await p.waitForTimeout(800);

if (errs.length) fail(`page errors: ${errs.join("; ")}`);
await b.close();
console.log("framework OK (rijen, uitsplitsing, wissel en opslaan)");
