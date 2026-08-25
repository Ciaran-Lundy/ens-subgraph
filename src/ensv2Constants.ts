// Per-network ENSv2 constants that networks.json has no room for (it only
// covers data-source address/startBlock). Branches on dataSource.network().
//
// Not called by anything until Phase 6 (registrar & migration handling) —
// values below are TODO pending docs/plan.md's open prerequisites.
import { Address, BigInt, dataSource } from "@graphprotocol/graph-ts";

export function getMigrationControllers(): Address[] {
  let network = dataSource.network();
  if (network == "sepolia") {
    // TODO(Phase 6): LockedMigrationController / UnlockedMigrationController
    // addresses for the Sepolia deployment matching this subgraph's
    // RootRegistry/ETHRegistry addresses. docs/plan.md prerequisite #5 —
    // still open as of Phase 1; do not guess these.
    return [];
  }
  return [];
}

export function getV2GracePeriod(): BigInt {
  // TODO(Phase 6): contracts-v2/contracts/script/deploy-constants.ts sets
  // GRACE_PERIOD_V2 = 28 days (2,419,200s) at the source level. High
  // confidence but unverified against the live ETHRenewerV1 deployment
  // (docs/plan.md prerequisite #6) — confirm via eth_call before using.
  return BigInt.fromI32(2419200);
}

// graph-ts 0.31.0's `dataSource` host API has no `.name()` (only
// address()/network()/context()), so RootRegistry/ETHRegistry can't be told
// apart from a template-discovered registry by data source name — compare
// event.address against these instead. Network-branched for when real
// mainnet ENSv2 addresses exist.
export function getRootRegistryAddress(): Address {
  let network = dataSource.network();
  if (network == "sepolia") {
    return Address.fromString("0xc960F7217d3643B525Ef36Bec8Adf86953CD9aB8");
  }
  return Address.zero();
}

export function getEthRegistryAddress(): Address {
  let network = dataSource.network();
  if (network == "sepolia") {
    return Address.fromString("0xDEDB92913A25abE1f7BCDD85D8A344a43B398B67");
  }
  return Address.zero();
}
