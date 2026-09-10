// Shared EACRolesChanged handling — identical event
// signature on PermissionedRegistry and PermissionedResolver, but distinct
// generated TypeScript classes (different codegen paths) and AssemblyScript
// has no union types (same constraint hit in Phase 7 for
// NamedTextResource/NamedDataResource), so this takes primitives rather
// than either event class; ensv2Registry.ts and ensv2Resolver.ts's
// handleEACRolesChanged are both thin wrappers over this.
import { Address, BigInt, Bytes, ethereum } from "@graphprotocol/graph-ts";
import { concat, createOrLoadAccount, uint256ToByteArray } from "./utils";
import { resourceId } from "./ensv2Utils";
import { ENSv2Resource, ENSv2RoleAssignment, ENSv2RoleChange } from "./types/schema";

export function processEACRolesChanged(
  contract: Address,
  resource: BigInt,
  account: Address,
  oldRoleBitmap: BigInt,
  newRoleBitmap: BigInt,
  block: ethereum.Block,
  transactionID: Bytes,
  logIndex: BigInt
): void {
  // A registry-emitted EACRolesChanged is dispatched here TWICE for the
  // same physical log: once via the address-bound registry data source,
  // once via the addressless PermissionedResolver wildcard source, since
  // both bind the byte-identical event signature (audit finding 11).
  // historyId is a deterministic function of the log itself (block +
  // logIndex), so checking for it first is a free, exact way to detect and
  // skip the second dispatch — no address-based source-type check needed.
  let historyId = Bytes.fromByteArray(
    concat(uint256ToByteArray(block.number), uint256ToByteArray(logIndex))
  );
  if (ENSv2RoleChange.load(historyId) != null) {
    return;
  }

  let contractId: Bytes = contract;
  let accountEntity = createOrLoadAccount(account);

  // Fixed-width concatenation, no delimiter needed (fix plan Phase 5
  // Decision 1): contract/account are 20-byte addresses, resource is a
  // 32-byte big-endian BigInt.
  let id = Bytes.fromByteArray(
    concat(concat(contractId, uint256ToByteArray(resource)), accountEntity.id)
  );
  let assignment = ENSv2RoleAssignment.load(id);
  if (assignment == null) {
    assignment = new ENSv2RoleAssignment(id);
    assignment.contract = contract;
    assignment.resource = resource;
    assignment.account = accountEntity.id;
  }
  // ENSv2Resource is always registry-address-prefixed (Phase 3) — this
  // lookup naturally (and correctly) finds nothing for a resolver-sourced
  // event, no need to know or check which kind of contract this is.
  let resourceEntity = ENSv2Resource.load(resourceId(contractId, resource));
  if (resourceEntity != null) {
    assignment.resourceEntity = resourceEntity.id;
  }
  assignment.roleBitmap = newRoleBitmap;
  assignment.updatedAtBlock = block.number;
  assignment.save();

  // historyId computed once, above (also serves as this function's own
  // dedup check for the double-dispatch case).
  let history = new ENSv2RoleChange(historyId);
  history.contract = contract;
  history.resource = resource;
  history.account = accountEntity.id;
  history.oldRoleBitmap = oldRoleBitmap;
  history.newRoleBitmap = newRoleBitmap;
  history.blockNumber = block.number;
  history.transactionID = transactionID;
  history.logIndex = logIndex;
  history.save();
}
