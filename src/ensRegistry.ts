// Import types and APIs from graph-ts
import { BigInt, crypto, ens } from "@graphprotocol/graph-ts";

import {
  checkValidLabel,
  concat,
  createEventID,
  EMPTY_ADDRESS,
  EMPTY_ADDRESS_BYTEARRAY,
  ROOT_NODE,
} from "./utils";

// Import event types from the registry contract ABI
import {
  ApprovalForAll as ApprovalForAllEvent,
  NewOwner as NewOwnerEvent,
  NewResolver as NewResolverEvent,
  NewTTL as NewTTLEvent,
  Transfer as TransferEvent,
} from "./types/ENSRegistry/EnsRegistry";

// Import entity types generated from the GraphQL schema
import {
  Account,
  Domain,
  NewOwner,
  NewResolver,
  NewTTL,
  Resolver,
  Transfer,
} from "./types/schema";

import { processApprovalForAll } from "./accessControl";

const BIG_INT_ZERO = BigInt.fromI32(0);

function createDomain(node: string, timestamp: BigInt): Domain {
  let domain = new Domain(node);
  if (node == ROOT_NODE) {
    domain = new Domain(node);
    domain.owner = EMPTY_ADDRESS;
    domain.isMigrated = true;
    domain.createdAt = timestamp;
    domain.subdomainCount = 0;
  }
  return domain;
}

function getDomain(
  node: string,
  timestamp: BigInt = BIG_INT_ZERO
): Domain | null {
  let domain = Domain.load(node);
  if (domain == null && node == ROOT_NODE) {
    return createDomain(node, timestamp);
  } else {
    return domain;
  }
}

function makeSubnode(event: NewOwnerEvent): string {
  return crypto
    .keccak256(concat(event.params.node, event.params.label))
    .toHexString();
}

function recurseDomainDelete(domain: Domain): string | null {
  if (
    (domain.resolver == null ||
      domain.resolver!.split("-")[0] == EMPTY_ADDRESS) &&
    domain.owner == EMPTY_ADDRESS &&
    domain.subdomainCount == 0
  ) {
    const parentDomain = Domain.load(domain.parent!);
    if (parentDomain != null) {
      parentDomain.subdomainCount = parentDomain.subdomainCount - 1;
      parentDomain.save();
      return recurseDomainDelete(parentDomain);
    }

    return null;
  }

  return domain.id;
}

function saveDomain(domain: Domain): void {
  recurseDomainDelete(domain);
  domain.save();
}

// Handler for NewOwner events
function _handleNewOwner(event: NewOwnerEvent, isMigrated: boolean): void {
  let account = new Account(event.params.owner.toHexString());
  account.save();

  let subnode = makeSubnode(event);
  let domain = getDomain(subnode, event.block.timestamp);
  let parent = getDomain(event.params.node.toHexString());

  if (domain == null) {
    domain = new Domain(subnode);
    domain.createdAt = event.block.timestamp;
    domain.subdomainCount = 0;
  }

  if (domain.parent == null && parent != null) {
    parent.subdomainCount = parent.subdomainCount + 1;
    parent.save();
  }

  if (domain.name == null) {
    // Get label and node names
    let label = ens.nameByHash(event.params.label.toHexString());
    if (checkValidLabel(label)) {
      domain.labelName = label;
    } else {
      label = "[" + event.params.label.toHexString().slice(2) + "]";
    }
    if (
      event.params.node.toHexString() ==
      "0x0000000000000000000000000000000000000000000000000000000000000000"
    ) {
      domain.name = label;
    } else {
      parent = parent!;
      let name = parent.name;
      if (label && name) {
        domain.name = label + "." + name;
      }
    }
  }

  domain.owner = event.params.owner.toHexString();
  domain.parent = event.params.node.toHexString();
  domain.labelhash = event.params.label;
  domain.isMigrated = isMigrated;
  saveDomain(domain);

  let domainEvent = new NewOwner(createEventID(event));
  domainEvent.blockNumber = event.block.number.toI32();
  domainEvent.transactionID = event.transaction.hash;
  domainEvent.parentDomain = event.params.node.toHexString();
  domainEvent.domain = subnode;
  domainEvent.owner = event.params.owner.toHexString();
  domainEvent.save();
}

// Handler for Transfer events
export function handleTransfer(event: TransferEvent): void {
  let node = event.params.node.toHexString();

  let account = new Account(event.params.owner.toHexString());
  account.save();

  // Update the domain owner
  let domain = getDomain(node)!;

  domain.owner = event.params.owner.toHexString();
  saveDomain(domain);

  let domainEvent = new Transfer(createEventID(event));
  domainEvent.blockNumber = event.block.number.toI32();
  domainEvent.transactionID = event.transaction.hash;
  domainEvent.domain = node;
  domainEvent.owner = event.params.owner.toHexString();
  domainEvent.save();
}

// Handler for NewResolver events
export function handleNewResolver(event: NewResolverEvent): void {
  let id: string | null;

  // if resolver is set to 0x0, set id to null
  // we don't want to create a resolver entity for 0x0
  if (event.params.resolver.equals(EMPTY_ADDRESS_BYTEARRAY)) {
    id = null;
  } else {
    id = event.params.resolver
      .toHexString()
      .concat("-")
      .concat(event.params.node.toHexString());
  }

  let node = event.params.node.toHexString();
  let domain = getDomain(node)!;
  domain.resolver = id;

  if (id) {
    let resolver = Resolver.load(id);
    if (resolver == null) {
      resolver = new Resolver(id);
      resolver.domain = event.params.node.toHexString();
      resolver.address = event.params.resolver;
      resolver.save();
      // since this is a new resolver entity, there can't be a resolved address yet so set to null
      domain.resolvedAddress = null;
    } else {
      domain.resolvedAddress = resolver.addr;
    }
  } else {
    domain.resolvedAddress = null;
  }
  saveDomain(domain);

  let domainEvent = new NewResolver(createEventID(event));
  domainEvent.blockNumber = event.block.number.toI32();
  domainEvent.transactionID = event.transaction.hash;
  domainEvent.domain = node;
  // `id` is null exactly when the resolver was cleared to address(0) — no
  // Resolver entity exists for the zero address, so storing EMPTY_ADDRESS
  // here (as this line used to) would be a non-null relation pointing at
  // an id that never resolves to anything, which makes graph-node itself
  // throw "Null value resolved for non-null field" for any consumer
  // selecting `resolver { id }` on this row (reproduced live against a
  // real deployment, not inferred — see docs/reconciliation-report.md
  // Finding 1). Leaving it unset instead, mirroring domain.resolver above.
  domainEvent.resolver = id;
  domainEvent.save();
}

// Handler for NewTTL events
export function handleNewTTL(event: NewTTLEvent): void {
  let node = event.params.node.toHexString();
  let domain = getDomain(node);
  // For the edge case that a domain's owner and resolver are set to empty
  // in the same transaction as setting TTL
  if (domain) {
    domain.ttl = event.params.ttl;
    domain.save();
  }

  let domainEvent = new NewTTL(createEventID(event));
  domainEvent.blockNumber = event.block.number.toI32();
  domainEvent.transactionID = event.transaction.hash;
  domainEvent.domain = node;
  domainEvent.ttl = event.params.ttl;
  domainEvent.save();
}

export function handleNewOwner(event: NewOwnerEvent): void {
  _handleNewOwner(event, true);
}

export function handleNewOwnerOldRegistry(event: NewOwnerEvent): void {
  let subnode = makeSubnode(event);
  let domain = getDomain(subnode);

  if (domain == null || domain.isMigrated == false) {
    _handleNewOwner(event, false);
  }
}

export function handleNewResolverOldRegistry(event: NewResolverEvent): void {
  let node = event.params.node.toHexString();
  let domain = getDomain(node, event.block.timestamp)!;
  if (node == ROOT_NODE || !domain.isMigrated) {
    handleNewResolver(event);
  }
}
export function handleNewTTLOldRegistry(event: NewTTLEvent): void {
  let domain = getDomain(event.params.node.toHexString())!;
  if (domain.isMigrated == false) {
    handleNewTTL(event);
  }
}

export function handleTransferOldRegistry(event: TransferEvent): void {
  let domain = getDomain(event.params.node.toHexString())!;
  if (domain.isMigrated == false) {
    handleTransfer(event);
  }
}

// setApprovalForAll is scoped to the calling EOA globally, not to any
// domain's isMigrated state (confirmed by reading ENSRegistryWithFallback.sol)
// — so unlike NewOwner/NewResolver/NewTTL/Transfer above, both registries
// index it unconditionally rather than gating the old one on migration status.
export function handleApprovalForAll(event: ApprovalForAllEvent): void {
  processApprovalForAll(
    event.address,
    event.params.owner,
    event.params.operator,
    event.params.approved,
    event.block
  );
}

export function handleApprovalForAllOldRegistry(
  event: ApprovalForAllEvent
): void {
  processApprovalForAll(
    event.address,
    event.params.owner,
    event.params.operator,
    event.params.approved,
    event.block
  );
}
