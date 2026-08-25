// Per-network ENSv2 constants that networks.json has no room for (it only
// covers data-source address/startBlock). Branches on dataSource.network().
import { Address, BigInt, dataSource } from "@graphprotocol/graph-ts";

export function getMigrationControllers(): Address[] {
  let network = dataSource.network();
  if (network == "sepolia") {
    return [
      Address.fromString("0xF91c34ED840889Ed96F806f882fD50506A336Edb"), // LockedMigrationController
      Address.fromString("0x056138Ef5660F7113a3B0ADC08ac3683310e7FBC"), // UnlockedMigrationController
    ];
  }
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
