import { chromium } from "playwright";

export const BASE = process.env.BASE_URL || "http://localhost:8000";

// Lokaal (sandbox) wijst CHROMIUM_PATH naar een systeembrowser; in CI gebruikt
// Playwright zijn eigen gedownloade Chromium.
export const launch = () =>
  chromium.launch(process.env.CHROMIUM_PATH ? { executablePath: process.env.CHROMIUM_PATH } : {});

export async function login(page, email, password) {
  await page.goto(`${BASE}/login`, { waitUntil: "networkidle" });
  await page.fill("#login-email", email);
  await page.fill("#login-password", password);
  await page.click("button[type=submit]");
  await page.waitForURL(/\/(app|onboarding)/, { timeout: 20000 });
}

export function collectErrors(page) {
  const errs = [];
  page.on("pageerror", (e) => errs.push(String(e)));
  return errs;
}

export function fail(msg) {
  console.error("FOUT:", msg);
  process.exit(1);
}
