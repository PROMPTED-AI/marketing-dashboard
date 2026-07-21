// Trial-flow: demo toont de balk, Instellingen toont status zonder
// intrekken-optie, en de admin ziet het verloopscherm bij overschakelen naar
// een gestopte organisatie, met doorgaan-knop.
import { BASE, launch, login, collectErrors, fail } from "./helpers.mjs";

const b = await launch();

// Reset: demo-trial vers op 14 dagen.
const ctx0 = await b.newContext();
const admin = await ctx0.newPage();
await login(admin, "admin@prompted-ai.nl", "admin123");
const demoOrgId = await admin.evaluate(async () => {
  const d = await (await fetch("/api/admin/organizations", { credentials: "include" })).json();
  const org = d.organizations.find((o) => o.domain.includes("janssen"));
  await fetch(`/api/admin/organizations/${org.id}/trial`, {
    method: "POST", credentials: "include",
    headers: { "Content-Type": "application/json" },
    body: JSON.stringify({ action: "restart", days: 14 }),
  });
  return org.id;
});

// 1) Demo-gebruiker: balk in de topbar en status in Instellingen.
{
  const ctx = await b.newContext();
  const p = await ctx.newPage();
  const errs = collectErrors(p);
  await login(p, "info@janssen.nl", "janssen123");
  await p.waitForTimeout(1500);
  const top = await p.locator("body").innerText();
  if (!/proefperiode · nog 14 dagen/i.test(top)) fail("trial-balk ontbreekt op demo");
  await p.goto(`${BASE}/app/settings`, { waitUntil: "domcontentloaded" });
  await p.waitForTimeout(1200);
  const body = await p.locator("body").innerText();
  if (!/nog 14 dagen/i.test(body) || !/overstappen naar betaald/i.test(body)) fail("Proefperiode-sectie ontbreekt");
  if (/intrekken/i.test(body)) fail("intrekken-optie hoort weg te zijn");
  if (errs.length) fail(`page errors: ${errs.join("; ")}`);
  await ctx.close();
}

// 2) Admin stopt de demo-trial en schakelt over: verloopscherm + doorgaan.
await admin.evaluate(async (id) => {
  await fetch(`/api/admin/organizations/${id}/trial`, {
    method: "POST", credentials: "include",
    headers: { "Content-Type": "application/json" },
    body: JSON.stringify({ action: "stop" }),
  });
}, demoOrgId);
await admin.evaluate((id) => localStorage.setItem("kompas-active-org", id), demoOrgId);
await admin.goto(`${BASE}/app/analytics`, { waitUntil: "domcontentloaded" });
await admin.waitForFunction(() => /proefperiode is verlopen/i.test(document.body.innerText), { timeout: 15000, polling: 400 });
const locked = await admin.locator("body").innerText();
if (!/wat de klant nu ziet/i.test(locked) || !/doorgaan als beheerder/i.test(locked)) fail("admin-variant verloopscherm ontbreekt");
await admin.getByRole("button", { name: /doorgaan als beheerder/i }).click();
await admin.waitForTimeout(1500);
if (/proefperiode is verlopen/i.test(await admin.locator("body").innerText())) fail("doorgaan als beheerder werkt niet");

// Herstel voor volgende runs.
await admin.evaluate(async (id) => {
  await fetch(`/api/admin/organizations/${id}/trial`, {
    method: "POST", credentials: "include",
    headers: { "Content-Type": "application/json" },
    body: JSON.stringify({ action: "restart", days: 14 }),
  });
}, demoOrgId);
await ctx0.close();
await b.close();
console.log("trial OK (balk, instellingen, verloopscherm + doorgaan)");
