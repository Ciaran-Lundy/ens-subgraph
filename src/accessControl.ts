// Shared access/admin-visibility handlers (fix plan Phase 3,
// docs/ENS_Subgraph_Audit.md findings 1 and 6). ApprovalForAll and
// OwnershipTransferred are emitted, with identical meaning, by several
// unrelated contracts (ENSRegistry, BaseRegistrar, NameWrapper, ENSv2
// PermissionedRegistry instances) — each with its own generated event
// class (AssemblyScript has no union types, the same constraint hit
// repeatedly since Phase 7/8) and, for ApprovalForAll specifically, a real
// ABI inconsistency: the "approving account" parameter is named `owner` on
// ENSRegistry/BaseRegistrar but `account` on NameWrapper/PermissionedRegistry.
// Every call site here takes primitives so the caller unpacks whatever its
// own event actually calls that field.
import { Address, Bytes, ethereum } from "@graphprotocol/graph-ts";
import { concat, createOrLoadAccount } from "./utils";
import { ContractOwnership, OperatorApproval, RegistrarController } from "./types/schema";

// Fixed-width Bytes concatenation, no delimiter needed: contract/owner/
// operator/controller are all 20-byte addresses (fix plan Phase 5 Decision 1).
export function processApprovalForAll(
  contract: Address,
  owner: Address,
  operator: Address,
  approved: boolean,
  block: ethereum.Block
): void {
  let ownerAccount = createOrLoadAccount(owner);
  let operatorAccount = createOrLoadAccount(operator);
  let id = Bytes.fromByteArray(
    concat(concat(contract, ownerAccount.id), operatorAccount.id)
  );

  let entity = OperatorApproval.load(id);
  if (entity == null) {
    entity = new OperatorApproval(id);
    entity.contract = contract;
    entity.owner = ownerAccount.id;
    entity.operator = operatorAccount.id;
  }
  entity.approved = approved;
  entity.updatedAtBlock = block.number;
  entity.save();
}

export function processOwnershipTransferred(
  contract: Address,
  newOwner: Address,
  block: ethereum.Block
): void {
  let ownerAccount = createOrLoadAccount(newOwner);
  let id = contract;

  let entity = ContractOwnership.load(id);
  if (entity == null) {
    entity = new ContractOwnership(id);
    entity.contract = contract;
  }
  entity.owner = ownerAccount.id;
  entity.updatedAtBlock = block.number;
  entity.save();
}

export function processControllerStatus(
  contract: Address,
  controller: Address,
  active: boolean,
  block: ethereum.Block
): void {
  let id = Bytes.fromByteArray(concat(contract, controller));

  let entity = RegistrarController.load(id);
  if (entity == null) {
    entity = new RegistrarController(id);
    entity.contract = contract;
    entity.controller = controller;
  }
  entity.active = active;
  entity.updatedAtBlock = block.number;
  entity.save();
}
