// Shared handlers for the RootRegistry/ETHRegistry static sources and the
// ENSv2Registry template (dynamically discovered UserRegistry/WrapperRegistry
// instances) — all three are PermissionedRegistry instances emitting the
// same event set, so one set of handler functions serves all of them
// (event-type imports below are taken from RootRegistry's generated types
// per this repo's existing precedent in ensRegistry.ts, which does the same
// for its dual ENSRegistry/ENSRegistryOld sources — structurally identical
// classes regardless of which data source's codegen output they come from).
//
// Phase 1 landed stub handlers plus the root/eth registry-row bootstrap.
// Phase 2 (this file) fills in real logic for the 4 label-lifecycle events;
// the rest stay stubs for Phases 3-4/8.
import { Address, BigInt, Bytes, ethereum, log } from "@graphprotocol/graph-ts";

import { getOrCreateRegistry, getOrCreateRootNamespace } from "./ensv2Discovery";
import { nameSlotId, resourceId, toSlotId, tokenEntityId } from "./ensv2Utils";
import { checkValidLabel, createEventID, createOrLoadAccount } from "./utils";
import {
  getEthRegistryAddress,
  getV2GracePeriod,
  isMigrationController,
} from "./ensv2Constants";
import { correctMigratedLegacyOwner, getEthDomainId } from "./ensv2Domain";
import { processEACRolesChanged } from "./ensv2Roles";
import {
  handleParentUpdated as handleParentUpdatedPaths,
  handleResolverUpdated as handleResolverUpdatedPaths,
  handleSubregistryUpdated as handleSubregistryUpdatedPaths,
  materializePathsForSlot,
} from "./ensv2Paths";
import {
  Domain,
  ENSv2LabelRegistered,
  ENSv2LabelRenewed,
  ENSv2LabelUnregistered,
  ENSv2NameSlot,
  ENSv2Registry,
  ENSv2Resource,
  ENSv2Token,
  ENSv2TokenRegenerated,
  ENSv2TokenTransferred,
  Registration,
} from "./types/schema";

import {
  EACRolesChanged,
  ExpiryUpdated,
  LabelRegistered,
  LabelReserved,
  LabelUnregistered,
  ParentUpdated,
  ResolverUpdated,
  SubregistryUpdated,
  TokenRegenerated,
  TokenResource,
  TransferBatch,
  TransferSingle,
} from "./types/RootRegistry/PermissionedRegistry";

// Ensures an ENSv2Registry row exists for whichever data source (static
// Root/ETH, or a template-discovered instance) fired the current event, and
// bootstraps the root namespace the first time any RootRegistry event
// arrives (RootRegistry has no parent to emit a SubregistryUpdated that
// would otherwise create it).
function bootstrapRegistry(address: Address, block: ethereum.Block): void {
  let registry = getOrCreateRegistry(address.toHexString(), address, block);
  let kind = registry.kind;
  if (kind == "ROOT") {
    getOrCreateRootNamespace(registry.id, block);
  }
}

export function handleLabelRegistered(event: LabelRegistered): void {
  bootstrapRegistry(event.address, event.block);

  let registryId = event.address.toHexString();
  let slotId = toSlotId(event.params.tokenId);
  let id = nameSlotId(registryId, slotId);

  let slot = ENSv2NameSlot.load(id);
  let isReRegistration = slot != null;
  if (slot == null) {
    slot = new ENSv2NameSlot(id);
    slot.registry = registryId;
    slot.slotId = slotId;
    slot.pathCount = 0;
    slot.createdAt = event.block.timestamp;
    slot.createdAtBlock = event.block.number;
  }

  slot.labelhash = event.params.labelHash;
  if (checkValidLabel(event.params.label)) {
    slot.label = event.params.label;
  }
  let account = createOrLoadAccount(event.params.owner.toHexString());
  let isV1Migration = isMigrationController(event.params.sender);
  slot.owner = account.id;
  slot.registrant = account.id;
  slot.status = "REGISTERED";
  slot.expiryDate = event.params.expiry;
  slot.migratedFromV1 = isV1Migration;
  slot.updatedAt = event.block.timestamp;
  slot.updatedAtBlock = event.block.number;
  slot.save();

  let history = new ENSv2LabelRegistered(createEventID(event));
  history.slot = slot.id;
  history.blockNumber = event.block.number;
  history.transactionID = event.transaction.hash;
  history.logIndex = event.logIndex;
  history.owner = account.id;
  history.expiryDate = event.params.expiry;
  history.isReRegistration = isReRegistration;
  history.sender = event.params.sender;
  history.isV1Migration = isV1Migration;
  history.save();

  // This reload looks redundant with bootstrapRegistry's own internal
  // getOrCreateRegistry call above (fix-plan audit finding 9 originally
  // flagged it as exactly that) — it is NOT. For a ROOT registry,
  // bootstrapRegistry also calls getOrCreateRootNamespace, which does its
  // OWN independent ENSv2Registry.load(...)/namespaceCount+=1/.save() on
  // the same id (ensv2Discovery.ts). graph-ts entities are snapshots, not
  // live references, so that mutation is invisible to any registry object
  // obtained before it ran — only a fresh load after bootstrapRegistry
  // returns sees the incremented namespaceCount materializePathsForSlot's
  // loop below depends on. Passing bootstrapRegistry's own returned
  // registry object here instead (removing this "redundant" reload) was
  // tried and reverted after it silently broke path materialisation for
  // every name under root — see docs/phases/fix-phase-2-*.md.
  let registry = ENSv2Registry.load(registryId)!;
  // The other bounded loop (docs/plan.md Phase 4): materialise a path for
  // each namespace this registry currently, actively serves.
  materializePathsForSlot(registry, slot, event, isV1Migration);
}

export function handleLabelReserved(event: LabelReserved): void {
  bootstrapRegistry(event.address, event.block);

  let registryId = event.address.toHexString();
  let slotId = toSlotId(event.params.tokenId);
  let id = nameSlotId(registryId, slotId);

  let slot = ENSv2NameSlot.load(id);
  if (slot == null) {
    slot = new ENSv2NameSlot(id);
    slot.registry = registryId;
    slot.slotId = slotId;
    slot.pathCount = 0;
    slot.migratedFromV1 = false;
    slot.createdAt = event.block.timestamp;
    slot.createdAtBlock = event.block.number;
  }

  slot.labelhash = event.params.labelHash;
  if (checkValidLabel(event.params.label)) {
    slot.label = event.params.label;
  }
  slot.status = "RESERVED";
  slot.expiryDate = event.params.expiry;
  slot.updatedAt = event.block.timestamp;
  slot.updatedAtBlock = event.block.number;
  slot.save();
  // No history entity — LabelReserved isn't in the proposal's history-entity
  // event list (docs/plan.md Phase 2 Decision 3).
}

export function handleLabelUnregistered(event: LabelUnregistered): void {
  bootstrapRegistry(event.address, event.block);

  let registryId = event.address.toHexString();
  let slotId = toSlotId(event.params.tokenId);
  let id = nameSlotId(registryId, slotId);

  let slot = ENSv2NameSlot.load(id);
  if (slot == null) {
    log.warning(
      "LabelUnregistered for unknown slot {} on registry {}",
      [slotId.toString(), registryId]
    );
    return;
  }

  // status is the authoritative signal; owner/registrant/expiryDate are left
  // as last-known values, not nulled (docs/plan.md Phase 2 Decision 4).
  slot.status = "AVAILABLE";
  slot.updatedAt = event.block.timestamp;
  slot.updatedAtBlock = event.block.number;
  slot.save();

  let history = new ENSv2LabelUnregistered(createEventID(event));
  history.slot = slot.id;
  history.blockNumber = event.block.number;
  history.transactionID = event.transaction.hash;
  history.logIndex = event.logIndex;
  history.sender = event.params.sender;
  history.save();
}

export function handleExpiryUpdated(event: ExpiryUpdated): void {
  bootstrapRegistry(event.address, event.block);

  let registryId = event.address.toHexString();
  let slotId = toSlotId(event.params.tokenId);
  let id = nameSlotId(registryId, slotId);

  let slot = ENSv2NameSlot.load(id);
  if (slot == null) {
    log.warning(
      "ExpiryUpdated for unknown slot {} on registry {}",
      [slotId.toString(), registryId]
    );
    return;
  }

  slot.expiryDate = event.params.newExpiry;
  slot.updatedAt = event.block.timestamp;
  slot.updatedAtBlock = event.block.number;
  slot.save();

  // Legacy .eth sync — REGISTERED only. ExpiryUpdated also fires for
  // premigrated RESERVED names renewed through ETHRenewerV1, whose renew()
  // already calls the authoritative v1 BaseRegistrarImplementation.renew()
  // in the same transaction; the existing v1 handlers correctly maintain
  // Registration/Domain for those from that event. Syncing the v2 side too
  // for a RESERVED slot would race with, and could overwrite, the correct
  // v1-derived values — so do nothing there (docs/plan.md Phase 6).
  let isEth = slot.registry == getEthRegistryAddress().toHexString();
  if (isEth && slot.status == "REGISTERED") {
    let registration = Registration.load(slot.labelhash.toHexString());
    if (registration != null) {
      registration.expiryDate = event.params.newExpiry;
      registration.save();
    }
    let domainId = getEthDomainId(slot);
    if (domainId !== null) {
      let domain = Domain.load(domainId as string);
      if (domain != null) {
        domain.expiryDate = event.params.newExpiry.plus(getV2GracePeriod());
        domain.save();
      }
    }
  }

  let history = new ENSv2LabelRenewed(createEventID(event));
  history.slot = slot.id;
  history.blockNumber = event.block.number;
  history.transactionID = event.transaction.hash;
  history.logIndex = event.logIndex;
  history.newExpiryDate = event.params.newExpiry;
  history.save();
}

export function handleSubregistryUpdated(event: SubregistryUpdated): void {
  bootstrapRegistry(event.address, event.block);
  handleSubregistryUpdatedPaths(event);
}

export function handleResolverUpdated(event: ResolverUpdated): void {
  bootstrapRegistry(event.address, event.block);
  handleResolverUpdatedPaths(event);
}

export function handleTokenResource(event: TokenResource): void {
  bootstrapRegistry(event.address, event.block);

  let registryId = event.address.toHexString();
  let slotId = toSlotId(event.params.tokenId);
  let slot = ENSv2NameSlot.load(nameSlotId(registryId, slotId));
  if (slot == null) {
    log.warning(
      "TokenResource for unknown slot {} on registry {}",
      [slotId.toString(), registryId]
    );
    return;
  }

  let resourceEntity = ENSv2Resource.load(
    resourceId(registryId, event.params.resource)
  );
  if (resourceEntity == null) {
    resourceEntity = new ENSv2Resource(
      resourceId(registryId, event.params.resource)
    );
    resourceEntity.registry = registryId;
    resourceEntity.resource = event.params.resource;
    resourceEntity.active = true;
    resourceEntity.createdAt = event.block.timestamp;
    resourceEntity.createdAtBlock = event.block.number;
  }
  resourceEntity.slot = slot.id;
  resourceEntity.updatedAtBlock = event.block.number;

  let token = ENSv2Token.load(tokenEntityId(registryId, event.params.tokenId));
  if (token == null) {
    token = new ENSv2Token(tokenEntityId(registryId, event.params.tokenId));
    token.registry = registryId;
    token.tokenId = event.params.tokenId;
    token.active = true;
    token.createdAtBlock = event.block.number;
  }
  token.slot = slot.id;
  token.resource = event.params.resource;
  token.resourceEntity = resourceEntity.id;
  token.updatedAtBlock = event.block.number;
  token.save();

  resourceEntity.currentToken = token.id;
  resourceEntity.save();

  let previousResourceId = slot.currentResource;
  if (previousResourceId !== null) {
    let previousResourceIdStr: string = previousResourceId as string;
    let newResourceIdStr: string = resourceEntity.id;
    let isDifferentResource: bool = previousResourceIdStr != newResourceIdStr;
    if (isDifferentResource) {
      let oldResource = ENSv2Resource.load(previousResourceIdStr);
      if (oldResource != null) {
        oldResource.active = false;
        oldResource.endedAt = event.block.timestamp;
        oldResource.save();
      }
    }
  }

  slot.currentResource = resourceEntity.id;
  slot.currentToken = token.id;
  slot.updatedAt = event.block.timestamp;
  slot.updatedAtBlock = event.block.number;
  slot.save();
}

export function handleTokenRegenerated(event: TokenRegenerated): void {
  bootstrapRegistry(event.address, event.block);

  let registryId = event.address.toHexString();
  let oldToken = ENSv2Token.load(
    tokenEntityId(registryId, event.params.oldTokenId)
  );
  if (oldToken == null) {
    log.warning("TokenRegenerated for unknown old token {} on registry {}", [
      event.params.oldTokenId.toString(),
      registryId,
    ]);
    return;
  }

  let newToken = new ENSv2Token(
    tokenEntityId(registryId, event.params.newTokenId)
  );
  newToken.registry = registryId;
  newToken.tokenId = event.params.newTokenId;
  newToken.slot = oldToken.slot;
  newToken.resource = oldToken.resource;
  newToken.resourceEntity = oldToken.resourceEntity;
  newToken.owner = oldToken.owner;
  newToken.active = true;
  newToken.createdAtBlock = event.block.number;
  newToken.updatedAtBlock = event.block.number;
  newToken.save();

  oldToken.active = false;
  oldToken.updatedAtBlock = event.block.number;
  oldToken.save();

  // ENSv2TokenRegenerated.slot is non-null — only write history (and
  // repoint the slot/resource's currentToken) when the old token actually
  // had a resolved slot (docs/plan.md Phase 3 Decision 3's constraint).
  let oldTokenSlotId = oldToken.slot;
  if (oldTokenSlotId !== null) {
    let oldTokenSlotIdStr: string = oldTokenSlotId as string;
    let slot = ENSv2NameSlot.load(oldTokenSlotIdStr);
    if (slot != null) {
      slot.currentToken = newToken.id;
      slot.updatedAtBlock = event.block.number;
      slot.save();
    }
    let oldTokenResourceEntityId = oldToken.resourceEntity;
    if (oldTokenResourceEntityId !== null) {
      let oldTokenResourceEntityIdStr: string = oldTokenResourceEntityId as string;
      let resourceEntity = ENSv2Resource.load(oldTokenResourceEntityIdStr);
      if (resourceEntity != null) {
        resourceEntity.currentToken = newToken.id;
        resourceEntity.updatedAtBlock = event.block.number;
        resourceEntity.save();
      }
    }

    let history = new ENSv2TokenRegenerated(createEventID(event));
    history.slot = oldTokenSlotIdStr;
    history.blockNumber = event.block.number;
    history.transactionID = event.transaction.hash;
    history.logIndex = event.logIndex;
    history.oldTokenId = event.params.oldTokenId;
    history.newTokenId = event.params.newTokenId;
    history.save();
  }
}

function makeTokenTransfer(
  registryId: string,
  tokenId: BigInt,
  from: Address,
  to: Address,
  block: ethereum.Block,
  transactionID: Bytes,
  logIndex: BigInt,
  eventId: string
): void {
  let token = ENSv2Token.load(tokenEntityId(registryId, tokenId));
  if (token == null) {
    // Fresh mint's TransferSingle can arrive before TokenResource — create
    // a placeholder now, TokenResource reconciles slot/resource later
    // (docs/plan.md Phase 3 Decision 3, mirrors nameWrapper.ts's
    // placeholder-then-reconcile pattern for WrappedDomain).
    token = new ENSv2Token(tokenEntityId(registryId, tokenId));
    token.registry = registryId;
    token.tokenId = tokenId;
    token.active = true;
    token.createdAtBlock = block.number;
  }
  let toAccount = createOrLoadAccount(to.toHexString());
  token.owner = toAccount.id;
  token.updatedAtBlock = block.number;
  token.save();

  let tokenSlotId = token.slot;
  if (tokenSlotId !== null) {
    let tokenSlotIdStr: string = tokenSlotId as string;
    let slot = ENSv2NameSlot.load(tokenSlotIdStr);
    if (slot != null) {
      slot.owner = toAccount.id;
      slot.updatedAtBlock = block.number;
      slot.save();

      // Subsequent transfers on a migrated slot keep writing to the same
      // legacy field the migration event corrected (docs/plan.md Phase 6).
      let isEth = slot.registry == getEthRegistryAddress().toHexString();
      if (slot.migratedFromV1 && isEth) {
        let domainId = getEthDomainId(slot);
        if (domainId !== null) {
          correctMigratedLegacyOwner(
            domainId as string,
            slot.labelhash.toHexString(),
            toAccount.id
          );
        }
      }
    }

    let history = new ENSv2TokenTransferred(eventId);
    history.slot = tokenSlotIdStr;
    history.blockNumber = block.number;
    history.transactionID = transactionID;
    history.logIndex = logIndex;
    history.from = createOrLoadAccount(from.toHexString()).id;
    history.to = toAccount.id;
    history.tokenId = tokenId;
    history.save();
  }
  // token.slot == null: current-state token row is still updated above, but
  // ENSv2TokenTransferred.slot is non-null so no history row can be written
  // for this transfer until a later TokenResource resolves the slot.
}

export function handleTransferSingle(event: TransferSingle): void {
  bootstrapRegistry(event.address, event.block);

  makeTokenTransfer(
    event.address.toHexString(),
    event.params.id,
    event.params.from,
    event.params.to,
    event.block,
    event.transaction.hash,
    event.logIndex,
    createEventID(event).concat("-0")
  );
}

export function handleTransferBatch(event: TransferBatch): void {
  bootstrapRegistry(event.address, event.block);

  let registryId = event.address.toHexString();
  let ids = event.params.ids;
  for (let i = 0; i < ids.length; i++) {
    makeTokenTransfer(
      registryId,
      ids[i],
      event.params.from,
      event.params.to,
      event.block,
      event.transaction.hash,
      event.logIndex,
      createEventID(event).concat("-").concat(i.toString())
    );
  }
}

export function handleParentUpdated(event: ParentUpdated): void {
  bootstrapRegistry(event.address, event.block);
  handleParentUpdatedPaths(event);
}

export function handleEACRolesChanged(event: EACRolesChanged): void {
  bootstrapRegistry(event.address, event.block);
  processEACRolesChanged(
    event.address,
    event.params.resource,
    event.params.account,
    event.params.oldRoleBitmap,
    event.params.newRoleBitmap,
    event.block,
    event.transaction.hash,
    event.logIndex
  );
}
