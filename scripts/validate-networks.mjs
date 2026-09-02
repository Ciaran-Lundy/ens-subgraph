#!/usr/bin/env node
// Validates that every data source's (network, address) pair in
// subgraph.yaml is consistent with networks.json — the gap that let a
// mainnet-labeled-but-Sepolia-addressed manifest ship unguarded (audit
// finding 1 / #27, finding 17). No YAML dependency: subgraph.yaml's data
// source blocks are flat `key: value` lines at a fixed indent, so a plain
// line scan is enough for the three fields this checks and avoids adding a
// new dependency to a package.json that currently has none.
//
// Usage: node scripts/validate-networks.mjs
// Exits non-zero (and prints every mismatch) if a static data source's
// address doesn't match networks.json's entry for its own declared
// network, or if a network appears in subgraph.yaml with no networks.json
// coverage at all for that data source name.

import { readFileSync } from "fs";
import { fileURLToPath } from "url";
import { dirname, join } from "path";

const __dirname = dirname(fileURLToPath(import.meta.url));
const repoRoot = join(__dirname, "..");

function parseDataSources(yamlText) {
  // Matches both the `dataSources:` and `templates:` sections — both use
  // the same "- kind: ethereum/contract" block shape and indentation.
  const lines = yamlText.split("\n");
  const sources = [];
  let current = null;
  for (const line of lines) {
    if (/^\s{2}-\s+kind:\s+ethereum\/contract\s*$/.test(line)) {
      if (current) sources.push(current);
      current = { name: null, network: null, address: null };
      continue;
    }
    if (!current) continue;
    let m;
    if ((m = line.match(/^\s{4}name:\s*(.+?)\s*$/))) {
      current.name = m[1];
    } else if ((m = line.match(/^\s{4}network:\s*(.+?)\s*$/))) {
      current.network = m[1];
    } else if ((m = line.match(/^\s{6}address:\s*"?([0-9a-fA-Fx]+)"?\s*$/))) {
      current.address = m[1].toLowerCase();
    }
  }
  if (current) sources.push(current);
  return sources;
}

function main() {
  const yamlText = readFileSync(join(repoRoot, "subgraph.yaml"), "utf8");
  const networks = JSON.parse(
    readFileSync(join(repoRoot, "networks.json"), "utf8")
  );

  const sources = parseDataSources(yamlText);
  const problems = [];

  for (const src of sources) {
    if (!src.name || !src.network) continue;

    const networkEntries = networks[src.network];
    if (!networkEntries) {
      problems.push(
        `${src.name}: subgraph.yaml declares network "${src.network}", but networks.json has no "${src.network}" block at all.`
      );
      continue;
    }

    const entry = networkEntries[src.name];
    if (!entry) {
      // A template (no static address) has nothing to cross-check beyond
      // "does this network exist in networks.json" — already handled above.
      if (src.address) {
        problems.push(
          `${src.name}: subgraph.yaml hardcodes address ${src.address} under network "${src.network}", but networks.json's "${src.network}" block has no entry for "${src.name}" at all — a plain \`graph deploy --network ${src.network}\` would leave this address exactly as committed, unsubstituted.`
        );
      }
      continue;
    }

    if (src.address && entry.address && entry.address.toLowerCase() !== src.address) {
      problems.push(
        `${src.name}: subgraph.yaml hardcodes ${src.address} for network "${src.network}", but networks.json's "${src.network}" entry says ${entry.address.toLowerCase()}.`
      );
    }
  }

  if (problems.length > 0) {
    console.error(`validate-networks: ${problems.length} problem(s) found:\n`);
    for (const p of problems) console.error(`  - ${p}`);
    console.error(
      "\nSee docs/ENSv2_Subgraph_Audit.md (Finding 1) / issue #27 for the incident this check exists to catch."
    );
    process.exit(1);
  }

  console.log(
    `validate-networks: OK — ${sources.length} data source(s)/template(s) checked, no network/address mismatches.`
  );
}

main();
