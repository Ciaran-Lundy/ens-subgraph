// Shared EACRolesChanged handling (docs/plan.md Phase 8) — identical event
// signature on PermissionedRegistry and PermissionedResolver, but distinct
// generated TypeScript classes (different codegen paths) and AssemblyScript
// has no union types (same constraint hit in Phase 7 for
// NamedTextResource/NamedDataResource), so this takes primitives rather
// than either event class; ensv2Registry.ts and ensv2Resolver.ts's
// handleEACRolesChanged are both thin wrappers over this.
import { Address, BigInt, Bytes, ethereum } from "@graphprotocol/graph-ts";
import { createOrLoadAccount } from "./utils";
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
  let contractId = contract.toHexString();
  let accountEntity = createOrLoadAccount(account.toHexString());

  let id = contractId.concat("-").concat(resource.toString()).concat("-").concat(accountEntity.id);
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

  // Replicates utils.ts::createEventID's own body (block.number-logIndex) —
  // that helper takes a full ethereum.Event, not available here since only
  // its constituent fields are passed through from each wrapper.
  let historyId = block.number.toString().concat("-").concat(logIndex.toString());
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
