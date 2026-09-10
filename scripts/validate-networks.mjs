#!/usr/bin/env node
// Two independent drift-detection checks, both catching the same class of
// bug: a hardcoded address silently going stale against its real source of
// truth after a contract redeploy.
//
// 1. subgraph.yaml vs networks.json — every data source's (network,
//    address) pair in subgraph.yaml is consistent with networks.json. The
//    gap that let a mainnet-labeled-but-Sepolia-addressed manifest ship
//    unguarded (audit finding 1 / #27, finding 17).
// 2. src/ensv2Constants.ts vs contracts-v2's own deployment artifacts —
//    ensv2Constants.ts's hardcoded per-network Address.fromString(...)
//    literals (RootRegistry/ETHRegistry/migration controllers/registry &
//    resolver implementation addresses) aren't data sources, so
//    networks.json has no room for them and check 1 can't see them at all.
//    This project has already had one real incident from exactly this gap:
//    "Phase 10" existed specifically because these addresses changed under
//    a contract redeploy and every hardcoded reference had to be found and
//    updated by hand (audit finding 34 / #34). Cross-checks against
//    contracts-v2/contracts/deployments/sepolia/*.json — the actual
//    deployment records these addresses were originally sourced from —
//    skipped gracefully (not a failure) if that submodule isn't checked
//    out, since contracts-v2 is a third-party submodule that won't exist
//    in a standalone `ens-subgraph` clone.
//
// No YAML/JS-parser dependency for either check: subgraph.yaml's data
// source blocks are flat `key: value` lines at a fixed indent, and
// ensv2Constants.ts's address literals follow one consistent
// `Address.fromString("0x...")` shape — plain line/regex scans are enough
// for both, avoiding a new dependency in a package.json that currently has
// none.
//
// Usage: node scripts/validate-networks.mjs
// Exits non-zero (and prints every problem, from both checks) if anything
// is found. Missing contracts-v2 is reported informationally, not counted
// as a problem.

import { readFileSync, existsSync } from "fs";
import { fileURLToPath } from "url";
import { dirname, join } from "path";

const __dirname = dirname(fileURLToPath(import.meta.url));
const repoRoot = join(__dirname, "..");
const workspaceRoot = join(repoRoot, "..");

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

function checkSubgraphYamlVsNetworksJson() {
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

  console.log(
    `[1/2] subgraph.yaml vs networks.json: ${sources.length} data source(s)/template(s) checked.`
  );
  return problems;
}

// function name -> ordered list of contracts-v2/.../sepolia/*.json files
// whose own "address" field is that function's real source of truth. Order
// matters for getMigrationControllers, whose array literal in
// ensv2Constants.ts is [Locked, Unlocked] in that exact order.
const CONSTANTS_TO_DEPLOYMENT = {
  getRootRegistryAddress: ["RootRegistry.json"],
  getEthRegistryAddress: ["ETHRegistry.json"],
  getUserRegistryImplAddress: ["UserRegistryImpl.json"],
  getWrapperRegistryImplAddress: ["WrapperRegistryImpl.json"],
  getPermissionedResolverImplAddress: ["PermissionedResolverImpl.json"],
  getMigrationControllers: [
    "LockedMigrationController.json",
    "UnlockedMigrationController.json",
  ],
};

// Extracts every Address.fromString("0x...") literal that textually
// appears within one exported function's body (from `export function
// <name>` up to the next `export function`, or end of file). Each of
// these functions has exactly one such literal per address it returns (the
// only other return path is `Address.zero()`, never a second
// Address.fromString call), so a plain regex scan over that slice is
// unambiguous — no need to parse the "sepolia" branch out specifically.
function extractAddressLiterals(tsText, functionName) {
  const startMarker = `export function ${functionName}(`;
  const startIdx = tsText.indexOf(startMarker);
  if (startIdx === -1) return null;
  const nextExportIdx = tsText.indexOf("export function ", startIdx + startMarker.length);
  const body = tsText.slice(startIdx, nextExportIdx === -1 ? undefined : nextExportIdx);
  const matches = [...body.matchAll(/Address\.fromString\(\s*"(0x[0-9a-fA-F]+)"\s*\)/g)];
  return matches.map((m) => m[1].toLowerCase());
}

function checkEnsv2ConstantsVsContractsV2() {
  const deploymentsDir = join(
    workspaceRoot,
    "contracts-v2",
    "contracts",
    "deployments",
    "sepolia"
  );
  if (!existsSync(deploymentsDir)) {
    console.log(
      "[2/2] src/ensv2Constants.ts vs contracts-v2: SKIPPED (contracts-v2 submodule not checked out at ../contracts-v2 — expected for a standalone ens-subgraph clone; not a failure)."
    );
    return [];
  }

  const constantsText = readFileSync(
    join(repoRoot, "src", "ensv2Constants.ts"),
    "utf8"
  );
  const problems = [];
  let checkedCount = 0;

  for (const [functionName, deploymentFiles] of Object.entries(
    CONSTANTS_TO_DEPLOYMENT
  )) {
    const literals = extractAddressLiterals(constantsText, functionName);
    if (literals === null) {
      problems.push(
        `${functionName}: expected to find this function in src/ensv2Constants.ts, but it's gone — this check's CONSTANTS_TO_DEPLOYMENT mapping is now stale and needs updating alongside whatever renamed/removed it.`
      );
      continue;
    }
    if (literals.length !== deploymentFiles.length) {
      problems.push(
        `${functionName}: found ${literals.length} Address.fromString(...) literal(s) in src/ensv2Constants.ts, but expected ${deploymentFiles.length} (one per ${deploymentFiles.join(", ")}) — this check's assumptions about this function's shape no longer hold, review by hand.`
      );
      continue;
    }

    for (let i = 0; i < deploymentFiles.length; i++) {
      const deploymentPath = join(deploymentsDir, deploymentFiles[i]);
      if (!existsSync(deploymentPath)) {
        console.log(
          `[2/2] ${functionName} / ${deploymentFiles[i]}: SKIPPED (no such deployment file in the currently-checked-out contracts-v2 commit).`
        );
        continue;
      }
      const deployment = JSON.parse(readFileSync(deploymentPath, "utf8"));
      const realAddress = (deployment.address || "").toLowerCase();
      checkedCount++;
      if (!realAddress) {
        problems.push(
          `${functionName} / ${deploymentFiles[i]}: deployment record has no "address" field at all — can't cross-check.`
        );
        continue;
      }
      if (realAddress !== literals[i]) {
        problems.push(
          `${functionName}: src/ensv2Constants.ts hardcodes ${literals[i]}, but contracts-v2/contracts/deployments/sepolia/${deploymentFiles[i]} (the currently-checked-out commit) says ${realAddress}. Either ensv2Constants.ts is stale and needs updating, or contracts-v2 has moved ahead of what this subgraph has synced to — check which before assuming.`
        );
      }
    }
  }

  console.log(
    `[2/2] src/ensv2Constants.ts vs contracts-v2: ${checkedCount} address(es) checked.`
  );
  return problems;
}

function main() {
  const problems = [
    ...checkSubgraphYamlVsNetworksJson(),
    ...checkEnsv2ConstantsVsContractsV2(),
  ];

  if (problems.length > 0) {
    console.error(`\nvalidate-networks: ${problems.length} problem(s) found:\n`);
    for (const p of problems) console.error(`  - ${p}`);
    console.error(
      "\nSee docs/ENSv2_Subgraph_Audit.md (Finding 1) / issue #27 for check 1's incident, and issue #34 for check 2's."
    );
    process.exit(1);
  }

  console.log("\nvalidate-networks: OK — no problems found.");
}

main();
