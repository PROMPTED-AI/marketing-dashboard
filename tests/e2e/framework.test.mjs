// Raamwerk: de variant volgt het bedrijfstype van de organisatie (geen toggle),
// e-commerce heeft geen rij Kosten Beslist, een invulveld slaat op en blijft
// staan na herladen, en een leadgen-organisatie ziet de leadgen-rijen.
import { BASE, launch, login, collectErrors, fail } from "./helpers.mjs";

const b = await launch();
const p = await b.newPage({ viewport: { width: 1440, height: 900 } });
const errs = collectErrors(p);

await login(p, "info@janssen.nl", "janssen123");
await p.goto(`${BASE}/app/framework`, { waitUntil: "domcontentloaded" });
await p.waitForTimeout(2500);

// Sidebar-item aanwezig.
if (!(await p.locator('a[href="/app/framework"]').count())) fail("Sidebar-item Raamwerk ontbreekt");

// Demo-org is e-commerce: het e-commerce raamwerk hoort actief te zijn, zonder
// wisselknop (de variant volgt het bedrijfstype uit de instellingen).
let body = await p.locator("body").innerText();
for (const rij of ["Bureaukosten", "Advertentiekosten", "Opbrengst excl. btw", "ROAS campagne", "POAS", "Retouren"]) {
  if (!body.includes(rij)) fail(`E-commerce rij ontbreekt: ${rij}`);
}
if (/kosten beslist/i.test(body)) fail("Rij Kosten Beslist mag niet in het e-commerce raamwerk staan");
if (await p.getByRole("button", { name: "Leadgeneratie" }).count()) fail("De raamwerk-toggle hoort verwijderd te zijn");

// Uitklapbare advertentiekosten: subrijen Google Ads en META Ads verschijnen.
await p.locator('button[title="Toon de uitsplitsing"]').first().click();
await p.waitForTimeout(300);
body = await p.locator("body").innerText();
if (!body.includes("Google Ads") || !body.includes("META Ads")) fail("Uitsplitsing advertentiekosten ontbreekt");

// Invulveld: bureaukosten van de nieuwste maand invullen, opslaan bij blur en
// terugzien na herladen.
const inputs = p.locator('input[aria-label^="Bureaukosten"]');
const laatste = inputs.last();
await laatste.fill("1234");
await laatste.blur();
await p.waitForTimeout(1200);
await p.reload({ waitUntil: "domcontentloaded" });
await p.waitForTimeout(2500);
const waarde = await p.locator('input[aria-label^="Bureaukosten"]').last().inputValue();
if (waarde !== "1234") fail(`Bureaukosten niet bewaard na herladen: "${waarde}"`);

// Opruimen zodat de test herhaalbaar blijft.
const veld = p.locator('input[aria-label^="Bureaukosten"]').last();
await veld.fill("");
await veld.blur();
await p.waitForTimeout(800);

// Leadgen-organisatie (Testklant) krijgt automatisch de leadgen-rijen.
await p.goto(`${BASE}/api/auth/logout`, { waitUntil: "domcontentloaded" });
await login(p, "test@testklant.nl", "test123");
await p.goto(`${BASE}/app/framework`, { waitUntil: "domcontentloaded" });
await p.waitForTimeout(2500);
body = await p.locator("body").innerText();
for (const rij of ["Kosten per lead", "Kosten per klant", "Aantal conversies"]) {
  if (!body.includes(rij)) fail(`Leadgen rij ontbreekt: ${rij}`);
}
if (body.includes("POAS")) fail("POAS hoort niet in het leadgen-raamwerk");

if (errs.length) fail(`page errors: ${errs.join("; ")}`);
await b.close();
console.log("framework OK (variant per bedrijfstype, uitsplitsing en opslaan)");
