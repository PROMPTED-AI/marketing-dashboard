// Mijn dashboards toont alleen tabbladen van gekoppelde kanalen: demo alles,
// een account zonder koppelingen alleen Overzicht.
import { BASE, launch, login, fail } from "./helpers.mjs";

const ALL = ["Overzicht", "Analytics", "Search Console", "Google Ads", "META Ads", "META Organisch", "WooCommerce"];

const b = await launch();

// Verwachte tabs per gebruiker, afgeleid uit de echte koppelstatus.
const TAB_FOR = {
  google_analytics: ["Analytics"], search_console: ["Search Console"],
  google_ads: ["Google Ads"], meta_ads: ["META Ads", "META Organisch"],
  woocommerce: ["WooCommerce"],
};

async function tabsFor(email, pw) {
  const ctx = await b.newContext();
  const p = await ctx.newPage();
  await login(p, email, pw);
  const connected = await p.evaluate(async () => {
    const d = await (await fetch("/api/connections", { credentials: "include" })).json();
    return d.connections.filter((c) => c.status === "connected").map((c) => c.provider);
  });
  const expected = ["Overzicht", ...connected.flatMap((c) => TAB_FOR[c] || [])];
  await p.goto(`${BASE}/app/dashboards`, { waitUntil: "domcontentloaded" });
  await p.waitForTimeout(2000);
  const labels = await p.$$eval("button", (els) =>
    els.map((e) => e.textContent.trim()).filter((t) => ["Overzicht", "Analytics", "Search Console", "Google Ads", "META Ads", "META Organisch", "WooCommerce"].includes(t)));
  await ctx.close();
  return { labels, expected };
}

const demo = await tabsFor("info@janssen.nl", "janssen123");
if (demo.labels.length !== ALL.length) fail(`demo mist tabs: ${JSON.stringify(demo.labels)}`);

const bare = await tabsFor("test@testklant.nl", "test123");
if (JSON.stringify([...bare.labels].sort()) !== JSON.stringify([...bare.expected].sort()))
  fail(`tabs (${JSON.stringify(bare.labels)}) matchen koppelingen (${JSON.stringify(bare.expected)}) niet`);

await b.close();
console.log("tabs OK (demo alle 7, kale org alleen Overzicht)");
