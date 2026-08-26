// Reads report.jsonl (written incrementally by run.mjs) and produces:
// - report.json: aggregated stats + full mismatch list
// - a console summary
import { readFileSync, writeFileSync, existsSync } from "node:fs";
import { fileURLToPath } from "node:url";
import path from "node:path";

const __dirname = path.dirname(fileURLToPath(import.meta.url));
const JSONL_PATH = path.join(__dirname, "report.jsonl");
const JSON_PATH = path.join(__dirname, "report.json");

if (!existsSync(JSONL_PATH)) {
  console.error("No report.jsonl found — run `node run.mjs` first.");
  process.exit(1);
}

const results = readFileSync(JSONL_PATH, "utf8")
  .split("\n")
  .filter(Boolean)
  .map((l) => JSON.parse(l));

const byStatus = { match: [], mismatch: [], not_found: [] };
for (const r of results) {
  (byStatus[r.status] || (byStatus[r.status] = [])).push(r);
}
const byCategory = {};
for (const r of results) {
  byCategory[r.category] = byCategory[r.category] || { match: 0, mismatch: 0, not_found: 0 };
  byCategory[r.category][r.status] = (byCategory[r.category][r.status] || 0) + 1;
}

const summary = {
  total: results.length,
  match: byStatus.match.length,
  mismatch: byStatus.mismatch.length,
  not_found: byStatus.not_found.length,
  byCategory,
  mismatches: byStatus.mismatch,
  notFound: byStatus.not_found,
};

writeFileSync(JSON_PATH, JSON.stringify(summary, null, 2));

console.log(`\n=== Reconciliation summary ===`);
console.log(`Total checks: ${summary.total}`);
console.log(`  match:     ${summary.match}`);
console.log(`  mismatch:  ${summary.mismatch}`);
console.log(`  not_found: ${summary.not_found}`);
console.log(`\nBy category:`);
for (const [cat, counts] of Object.entries(byCategory)) {
  console.log(`  ${cat}: match=${counts.match || 0} mismatch=${counts.mismatch || 0} not_found=${counts.not_found || 0}`);
}
if (summary.mismatch > 0) {
  console.log(`\n=== Mismatches ===`);
  for (const m of byStatus.mismatch) {
    console.log(`- [${m.category}] ${m.contract} ${m.event} (block ${m.block}, tx ${m.txHash}) entity ${m.entityType}#${m.entityId}`);
    for (const f of m.fields.filter((f) => !f.match)) {
      console.log(`    ${f.field}: expected=${f.expected} actual=${f.actual}`);
    }
  }
}
console.log(`\nWrote ${JSON_PATH}`);
