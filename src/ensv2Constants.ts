// Per-network ENSv2 constants that networks.json has no room for (it only
// covers data-source address/startBlock). Branches on dataSource.network().
import { Address, BigInt, dataSource } from "@graphprotocol/graph-ts";

export function getMigrationControllers(): Address[] {
  let network = dataSource.network();
  if (network == "sepolia") {
    return [
      Address.fromString("0x5c39e36A69a9897f08954C71acB1f36e0bD4f409"), // LockedMigrationController
      Address.fromString("0x2fCf83232B93bd29C59db18AAa1d4b62E9F9fc73"), // UnlockedMigrationController
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
  return Address.zero();
}

export function getEthRegistryAddress(): Address {
  let network = dataSource.network();
  if (network == "sepolia") {
    return Address.fromString("0xbDC85dD5b15D7ECb354Cd7cb6f2C50B4f2C4f0e2");
  }
  return Address.zero();
}
