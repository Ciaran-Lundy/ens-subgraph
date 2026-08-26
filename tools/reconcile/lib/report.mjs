import { appendFileSync, existsSync, readFileSync, writeFileSync } from "node:fs";
import { fileURLToPath } from "node:url";
import path from "node:path";

const __dirname = path.dirname(fileURLToPath(import.meta.url));
const JSONL_PATH = path.join(__dirname, "..", "report.jsonl");

// Append-only JSONL — safe against an interrupted run losing prior results;
// re-running from scratch just overwrites (callers that want resumability
// across process restarts should check readCompletedIds() first).
export function resetReport() {
  writeFileSync(JSONL_PATH, "");
}

export function readCompletedIds() {
  if (!existsSync(JSONL_PATH)) return new Set();
  const lines = readFileSync(JSONL_PATH, "utf8").split("\n").filter(Boolean);
  return new Set(lines.map((l) => JSON.parse(l).id));
}

export function recordResult(result) {
  appendFileSync(JSONL_PATH, JSON.stringify(result) + "\n");
}

// Builds one result record and compares expected vs actual field-by-field.
// `expected`/`actual` are flat { fieldName: value } objects; values are
// compared as strings (both sides should already be normalised — lowercase
// hex addresses, decimal-string BigInts — by the caller) so a type
// mismatch (e.g. number vs string) can't hide a real value mismatch.
export function compareFields(expected, actual) {
  const fields = [];
  let allMatch = true;
  for (const key of Object.keys(expected)) {
    const exp = expected[key] === undefined || expected[key] === null ? null : String(expected[key]);
    const act =
      actual == null || actual[key] === undefined || actual[key] === null
        ? null
        : String(actual[key]);
    const match = exp === act;
    if (!match) allMatch = false;
    fields.push({ field: key, expected: exp, actual: act, match });
  }
  return { allMatch, fields };
}

export function makeCheck({ category, contract, event, block, txHash, logIndex, entityType, entityId }) {
  return {
    id: `${category}:${contract}:${event}:${txHash}-${logIndex}`,
    category,
    contract,
    event,
    block,
    txHash,
    logIndex,
    entityType,
    entityId,
  };
}
