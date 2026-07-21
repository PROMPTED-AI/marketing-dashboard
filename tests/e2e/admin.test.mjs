// Beheeromgeving: de vier pagina's renderen en het facturatieformulier slaat op.
import { BASE, launch, login, collectErrors, fail } from "./helpers.mjs";

const b = await launch();
const p = await b.newPage({ viewport: { width: 1440, height: 900 } });
const errs = collectErrors(p);
await login(p, "admin@prompted-ai.nl", "admin123");
await p.goto(`${BASE}/admin`, { waitUntil: "domcontentloaded" });
await p.waitForTimeout(2000);

async function open(label) {
  await p.getByText(label, { exact: true }).click();
  await p.waitForTimeout(1000);
  return p.locator("body").innerText();
}

let body = await open("Gebruikers & rollen");
if (!/admin@prompted-ai\.nl/.test(body) || !/bureau-admin/i.test(body)) fail("Gebruikers & rollen rendert niet");

body = await open("Koppelingen");
if (!/laatste sync/i.test(body)) fail("Koppelingen rendert niet");

body = await open("Pakketten & facturatie");
if (!/€ 100/.test(body) || !/€ 300/.test(body) || !/500 eenmalige onboarding/i.test(body)) fail("pakketten ontbreken");
await p.getByPlaceholder("Bedrijf B.V.").fill("Janssen Media B.V.");
await p.getByRole("button", { name: /gegevens opslaan/i }).click();
await p.waitForTimeout(1200);
if (!/opgeslagen/i.test(await p.locator("body").innerText())) fail("facturatie opslaan faalt");

body = await open("Activiteitenlog");
if (!/activiteitenlog/i.test(body) || !/(geleden|zojuist)/i.test(body)) fail("Activiteitenlog rendert niet");

if (errs.length) fail(`page errors: ${errs.join("; ")}`);
await b.close();
console.log("admin OK (vier pagina's + facturatie opslaan)");
