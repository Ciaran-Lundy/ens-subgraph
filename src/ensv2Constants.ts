// Per-network ENSv2 constants that networks.json has no room for (it only
// covers data-source address/startBlock). Branches on dataSource.network().
//
// Every function below fails loudly (log.critical) on an unrecognized
// network instead of silently defaulting to a zero-value/empty sentinel
// (audit finding 1). A silent default here doesn't just look wrong in
// isolation — getEthRegistryAddress()/getRootRegistryAddress() feed
// directly into entity-id construction (ensv2Registrar.ts) and registry
// classification (ensv2Discovery.ts::kindForAddress), so a silent
// Address.zero() collapses every entity id onto one bogus bucket rather
// than failing the indexer where the misconfiguration actually is.
import { Address, BigInt, dataSource, log } from "@graphprotocol/graph-ts";

export function getMigrationControllers(): Address[] {
  let network = dataSource.network();
  if (network == "sepolia") {
    return [
      Address.fromString("0x5c39e36A69a9897f08954C71acB1f36e0bD4f409"), // LockedMigrationController
      Address.fromString("0x2fCf83232B93bd29C59db18AAa1d4b62E9F9fc73"), // UnlockedMigrationController
    ];
  }
  log.critical(
    "getMigrationControllers: no migration controller addresses configured for network '{}'. Refusing to silently return an empty list (which would make isMigrationController() always return false) — add real addresses for this network or fix the manifest's network label.",
    [network]
  );
  return [];
}

// Manual loop with .equals() rather than Array<Address>.includes() — this
// codebase has repeatedly hit real AssemblyScript compiler issues around
// reference-type comparisons in unusual contexts, and .equals() is the
// already-proven-safe pattern used throughout (see kindForAddress).
export function isMigrationController(sender: Address): boolean {
  let controllers = getMigrationControllers();
  for (let i = 0; i < controllers.length; i++) {
    if (controllers[i].equals(sender)) {
      return true;
    }
  }
  return false;
}

export function getV2GracePeriod(): BigInt {
  // GRACE_PERIOD is an ETHRegistrar *constructor argument*, not a compiled-in
  // protocol constant (contracts-v2/contracts/src/registrar/ETHRegistrar.sol)
  // — a different deployment can legitimately be constructed with a
  // different value, so this must be network-branched like its siblings in
  // this file, not returned unconditionally (audit finding 14).
  let network = dataSource.network();
  if (network == "sepolia") {
    // 28 days (2,419,200s) — contracts-v2/contracts/script/deploy-constants.ts
    // sets GRACE_PERIOD_V2 to this. Verified against the live deployment, not
    // just the source script (fix plan Phase 2): ETHRenewerV1's public
    // GRACE_PERIOD() getter on Sepolia (0x1be516ae1b72765ae55bd5e9ca628c9058a1c622)
    // returns 7776001, which is exactly PREMIGRATION_BONUS_PERIOD (5356801) +
    // GRACE_PERIOD_V2 (2419200) computed from that same source file — the
    // deployed contract's constructor args match its constants, confirmed
    // live via eth_call, not assumed.
    return BigInt.fromI32(2419200);
  }
  log.critical(
    "getV2GracePeriod: no grace period configured for network '{}'. GRACE_PERIOD is a per-deployment constructor argument — confirm the real on-chain value for this network's ETHRegistrar/ETHRenewerV1 (e.g. via GRACE_PERIOD()) before adding it here; do not assume the Sepolia value applies.",
    [network]
  );
  return BigInt.zero();
}

// graph-ts 0.31.0's `dataSource` host API has no `.name()` (only
// address()/network()/context()), so RootRegistry/ETHRegistry can't be told
// apart from a template-discovered registry by data source name — compare
// event.address against these instead. Network-branched for when real
// mainnet ENSv2 addresses exist.
export function getRootRegistryAddress(): Address {
  let network = dataSource.network();
  if (network == "sepolia") {
    return Address.fromString("0x8115186e8f2e0B0281E86Ab91f0f48Ba90364354");
  }
  log.critical(
    "getRootRegistryAddress: no RootRegistry address configured for network '{}'. Refusing to silently return the zero address (which would collapse every registry-id/kind lookup onto one bogus bucket) — add the real address for this network or fix the manifest's network label.",
    [network]
  );
  return Address.zero();
}

export function getEthRegistryAddress(): Address {
  let network = dataSource.network();
  if (network == "sepolia") {
    return Address.fromString("0xbDC85dD5b15D7ECb354Cd7cb6f2C50B4f2C4f0e2");
  }
  log.critical(
    "getEthRegistryAddress: no ETHRegistry address configured for network '{}'. Refusing to silently return the zero address (which would collapse every ENSv2Registration id onto one bogus bucket) — add the real address for this network or fix the manifest's network label.",
    [network]
  );
  return Address.zero();
}
