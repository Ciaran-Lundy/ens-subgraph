// Orchestrator — reconcile plan Design decision 5 (resumable, incremental
// report writes). Run with: node run.mjs
import { CONTRACTS } from "./config.mjs";
import { getBlockNumber } from "./lib/rpc.mjs";
import { query, queryAll } from "./lib/subgraph.mjs";
import { resetReport } from "./lib/report.mjs";
import {
  discoverRegistries,
  discoverResolvers,
  fetchDecodedLogs,
  checkRegistrySlots,
  checkRegistryHistory,
  checkResourcesAndTokens,
  checkRoleAssignments,
  checkRegistrations,
  checkProxyDeployed,
  checkResolverAliases,
} from "./checks/ensv2.mjs";
import {
  fetchEvents,
  checkEnsRegistryHistory,
  checkDomainsCurrentState,
  checkBaseRegistrar,
  checkControllerRegistrations,
  checkNameWrapper,
  checkResolverEvents,
  checkResolverCurrentState,
} from "./checks/ensv1.mjs";

// Tuned down from an initial 100k-block window after a live timing test:
// ENSRegistry alone averages ~5 checks/sec against the Studio GraphQL
// endpoint (sequential round trips), and a single 100k-block window on a
// contract with ~210k lifetime raw logs took long enough to make the full
// multi-window sweep impractical within this session. 5k blocks keeps each
// window's check count in the low hundreds.
const RECENT_WINDOW_BLOCKS = 5_000;
const RANDOM_WINDOWS_PER_CONTRACT = 5;
const RESOLVER_INSTANCE_CAP = 15; // separate sampling dimension from block-range — see README

function log(msg) {
  console.log(`[${new Date().toISOString()}] ${msg}`);
}

function pickRandomWindows(startBlock, endBlock, count, windowSize = 5_000) {
  const windows = [];
  const span = Math.max(0, endBlock - startBlock - windowSize);
  for (let i = 0; i < count; i++) {
    const from = startBlock + Math.floor((span * i) / count);
    windows.push([from, Math.min(from + windowSize - 1, endBlock)]);
  }
  return windows;
}

function shuffled(arr) {
  const a = [...arr];
  for (let i = a.length - 1; i > 0; i--) {
    const j = Math.floor(Math.random() * (i + 1));
    [a[i], a[j]] = [a[j], a[i]];
  }
  return a;
}

// Safety net around every batch check call — this run can take a long
// time (hundreds of windows × multiple contracts/resolvers), and one
// unexpected error (a GraphQL schema surprise like the dangling-relation
// bug this tool found in NewResolver, a transient network blip a check
// function didn't itself guard against, etc.) shouldn't be able to lose
// everything already recorded. Logs and continues rather than crashing;
// already-completed checks stay in report.jsonl either way since it's
// written incrementally per-check, not batched.
async function safe(label, fn) {
  try {
    return await fn();
  } catch (err) {
    log(`  !! ERROR in ${label}: ${err.message || err} — skipping this batch, continuing.`);
    return 0;
  }
}

async function runEnsv2() {
  log("=== ENSv2: full coverage ===");
  const head = await getBlockNumber();

  const registries = await discoverRegistries();
  log(`Discovered ${registries.length} ENSv2 registries: ${registries.join(", ")}`);
  let totalChecked = 0;
  for (const registry of registries) {
    const fromBlock = CONTRACTS.RootRegistry.startBlock; // shared floor; pre-deployment ranges just return no logs
    log(`  Registry ${registry}: fetching logs ${fromBlock}-${head}...`);
    const events = await fetchDecodedLogs(registry, "PermissionedRegistry.json", fromBlock, head);
    log(`    ${events.length} events decoded`);
    totalChecked += await safe(`checkRegistrySlots(${registry})`, () => checkRegistrySlots(registry, events));
    totalChecked += await safe(`checkRegistryHistory(${registry})`, () => checkRegistryHistory(registry, events));
    totalChecked += await safe(`checkResourcesAndTokens(${registry})`, () => checkResourcesAndTokens(registry, events));
    totalChecked += await safe(`checkRoleAssignments(${registry})`, () => checkRoleAssignments(registry, events));
  }

  log("  ETHRegistrar...");
  const registrarEvents = await fetchDecodedLogs(
    CONTRACTS.ETHRegistrar.address,
    "ETHRegistrar.json",
    CONTRACTS.ETHRegistrar.startBlock,
    head
  );
  totalChecked += await safe("checkRegistrations", () => checkRegistrations(registrarEvents));

  log("  VerifiableFactory...");
  const factoryEvents = await fetchDecodedLogs(
    CONTRACTS.VerifiableFactory.address,
    "VerifiableFactory.json",
    CONTRACTS.VerifiableFactory.startBlock,
    head
  );
  totalChecked += await safe("checkProxyDeployed", () => checkProxyDeployed(factoryEvents));

  const resolvers = await discoverResolvers();
  log(`  Discovered ${resolvers.length} ENSv2 resolvers`);
  for (const resolver of resolvers) {
    const events = await fetchDecodedLogs(resolver, "PermissionedResolver.json", CONTRACTS.RootRegistry.startBlock, head);
    totalChecked += await safe(`checkResolverAliases(${resolver})`, () => checkResolverAliases(resolver, events));
    totalChecked += await safe(`checkRoleAssignments(${resolver})`, () => checkRoleAssignments(resolver, events));
  }

  log(`ENSv2 phase done: ${totalChecked} checks recorded.`);
  return totalChecked;
}

async function runEnsv1() {
  log("=== ENSv1: bounded sample + edge cases ===");
  const head = await getBlockNumber();
  let totalChecked = 0;

  const plainContracts = [
    "ENSRegistry",
    "BaseRegistrar",
    "LegacyEthRegistrarController",
    "WrappedEthRegistrarController",
    "UnwrappedEthRegistrarController",
    "NameWrapper",
  ];

  // Bounded sample, not full history — real event volume turned out to be
  // in the hundreds of thousands per contract (ENSRegistry: 209,716 raw
  // logs; BaseRegistrar: 149,327 — confirmed live with the fixed adaptive
  // RPC path before this scope was finalized, not guessed), so full
  // per-event GraphQL cross-checking isn't practical. Every event type
  // still gets real exact-match checks: a recent window plus several
  // random historical windows per contract, each fully decoded and
  // reconciled within itself (not sub-sampled further) — see README.
  for (const key of plainContracts) {
    const c = CONTRACTS[key];
    const windows = [
      [Math.max(c.startBlock, head - RECENT_WINDOW_BLOCKS), head],
      ...pickRandomWindows(c.startBlock, head, RANDOM_WINDOWS_PER_CONTRACT),
    ];
    log(`  ${key}: ${windows.length} sample windows (recent + ${RANDOM_WINDOWS_PER_CONTRACT} random)`);
    for (const [from, to] of windows) {
      if (to < c.startBlock) continue;
      const fromClamped = Math.max(from, c.startBlock);
      const events = await fetchEvents(key, fromClamped, to);
      if (events.length === 0) continue;
      log(`    window ${fromClamped}-${to}: ${events.length} events`);
      if (key === "ENSRegistry") {
        totalChecked += await safe("checkEnsRegistryHistory", () => checkEnsRegistryHistory(events));
        totalChecked += await safe("checkDomainsCurrentState", () => checkDomainsCurrentState(events));
      } else if (key === "BaseRegistrar") {
        totalChecked += await safe("checkBaseRegistrar", () => checkBaseRegistrar(events));
      } else if (key === "NameWrapper") {
        totalChecked += await safe("checkNameWrapper", () => checkNameWrapper(events));
      } else {
        totalChecked += await safe(`checkControllerRegistrations(${key})`, () => checkControllerRegistrations(key, events));
      }
    }
  }

  // Resolver instances: a bounded sample of discovered addresses (614+
  // unique instances found — a separate sampling dimension from block
  // range), each sampled over the same recent+random windows.
  const resolverRows = await queryAll("resolvers", "id address");
  const allResolverAddresses = [...new Set(resolverRows.map((r) => r.address.toLowerCase()))];
  const resolverAddresses = shuffled(allResolverAddresses).slice(0, RESOLVER_INSTANCE_CAP);
  log(`  Discovered ${allResolverAddresses.length} unique ENSv1 resolver instances (from ${resolverRows.length} Resolver rows); sampling ${resolverAddresses.length}`);
  for (const addr of resolverAddresses) {
    const windows = [
      [Math.max(CONTRACTS.ENSRegistry.startBlock, head - RECENT_WINDOW_BLOCKS), head],
      ...pickRandomWindows(CONTRACTS.ENSRegistry.startBlock, head, 3),
    ];
    for (const [from, to] of windows) {
      const events = await fetchDecodedLogs(addr, "PublicResolver.json", from, to);
      if (events.length === 0) continue;
      totalChecked += await safe(`checkResolverEvents(${addr})`, () => checkResolverEvents(addr, events));
      totalChecked += await safe(`checkResolverCurrentState(${addr})`, () => checkResolverCurrentState(addr, events));
    }
  }

  log(`ENSv1 phase done: ${totalChecked} checks recorded.`);
  return totalChecked;
}

// Edge cases: specific interesting real rows found via the subgraph itself
// (not blind sampling), each independently re-verified via a single-block
// eth_getLogs call scoped to the row's own blockNumber — not
// eth_getTransactionReceipt, which this session found returns null for
// confirmed transactions on this public RPC (verified live: a transaction
// hash the subgraph itself reported, confirmed present via
// eth_getBlockByNumber, still came back null from
// eth_getTransactionReceipt on 3 retries) — eth_getLogs has been reliable
// throughout this tool, so edge cases reuse that same path instead.
async function checkAtBlock(contractKey, blockNumber, checkFn) {
  const c = CONTRACTS[contractKey];
  const events = await fetchDecodedLogs(c.address, c.abi, blockNumber, blockNumber);
  if (events.length === 0) {
    log(`    (no ${contractKey} events at block ${blockNumber} — row may be from a different contract instance)`);
    return 0;
  }
  return safe(`${contractKey}@${blockNumber}`, () => checkFn(events));
}

async function runEdgeCases() {
  log("=== Edge cases (targeted, subgraph-discovered) ===");
  let totalChecked = 0;

  // Wrapped names with non-zero fuses (locked/permission-restricted) —
  // re-verify via their FusesSet history (has a real blockNumber).
  const wd = await query(`{ wrappedDomains(first: 3, where: { fuses_gt: 0 }) { id fuses } }`);
  log(`  Wrapped domains with fuses > 0: ${wd.wrappedDomains.length}`);
  for (const w of wd.wrappedDomains) {
    const fs = await query(`{ fusesSets(first: 1, orderBy: blockNumber, orderDirection: desc, where: { domain: "${w.id}" }) { id blockNumber } }`);
    if (fs.fusesSets.length === 0) continue;
    totalChecked += await checkAtBlock("NameWrapper", Number(fs.fusesSets[0].blockNumber), checkNameWrapper);
  }

  // Renewed BaseRegistrar registrations.
  const renewals = await query(`{ nameReneweds(first: 5, orderBy: blockNumber, orderDirection: desc) { id blockNumber } }`);
  log(`  Renewed registrations sampled: ${renewals.nameReneweds.length}`);
  for (const r of renewals.nameReneweds) {
    totalChecked += await checkAtBlock("BaseRegistrar", Number(r.blockNumber), checkBaseRegistrar);
  }

  // Names that were wrapped then later unwrapped (WrappedDomain should now
  // be gone — checkNameWrapper's NameUnwrapped branch verifies the removal
  // as a real invariant, not just event-entity existence).
  const unwrapped = await query(`{ nameUnwrappeds(first: 5, orderBy: blockNumber, orderDirection: desc) { id blockNumber } }`);
  log(`  Unwrap events sampled: ${unwrapped.nameUnwrappeds.length}`);
  for (const u of unwrapped.nameUnwrappeds) {
    totalChecked += await checkAtBlock("NameWrapper", Number(u.blockNumber), checkNameWrapper);
  }

  // Multi-transfer ownership chains on BaseRegistrar (each individual
  // Transfer event, re-verified regardless of which block it's in).
  const transfers = await query(`{ nameTransferreds(first: 5, orderBy: blockNumber, orderDirection: desc) { id blockNumber } }`);
  log(`  BaseRegistrar transfers sampled: ${transfers.nameTransferreds.length}`);
  for (const t of transfers.nameTransferreds) {
    totalChecked += await checkAtBlock("BaseRegistrar", Number(t.blockNumber), checkBaseRegistrar);
  }

  log(`  Edge-case checks recorded: ${totalChecked}.`);
  return totalChecked;
}

async function main() {
  // Only wipes prior results with an explicit flag — this session lost a
  // substantial (1749-check) partial run to an unconditional reset here
  // when relaunching after a rate-limit crash. Default is to append to
  // whatever report.jsonl already has (duplicates across runs are fine —
  // summarize.mjs doesn't dedupe, but that only affects counts, not
  // correctness of any individual check).
  if (process.argv.includes("--fresh")) {
    resetReport();
    log("--fresh: cleared report.jsonl");
  }
  log(`Starting reconciliation run.`);
  const ensv2Checked = await runEnsv2();
  const ensv1Checked = await runEnsv1();
  const edgeChecked = await runEdgeCases();
  log(`Total checks recorded: ${ensv2Checked + ensv1Checked + edgeChecked}`);
  log("Run summarize.mjs to produce the human-readable report.");
}

main().catch((err) => {
  console.error("Fatal error:", err);
  process.exit(1);
});
