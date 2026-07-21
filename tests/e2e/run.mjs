// Draait alle e2e-tests na elkaar; stopt met exitcode 1 zodra er één faalt.
import { execFileSync } from "node:child_process";
import { readdirSync } from "node:fs";
import { fileURLToPath } from "node:url";
import { dirname, join } from "node:path";

const dir = dirname(fileURLToPath(import.meta.url));
const tests = readdirSync(dir).filter((f) => f.endsWith(".test.mjs")).sort();
for (const t of tests) {
  console.log(`\n=== ${t} ===`);
  try {
    execFileSync(process.execPath, [join(dir, t)], { stdio: "inherit" });
  } catch {
    console.error(`\n${t} FAALDE`);
    process.exit(1);
  }
}
console.log(`\nALLE E2E-TESTS OK (${tests.length})`);
