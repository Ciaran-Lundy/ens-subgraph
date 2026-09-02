// Namespace/path materialisation — the load-bearing cost-bound mechanism.
// Two complementary bounded loops implement it, and BOTH are needed:
//
//   handleSubregistryUpdated creates namespaces by looping over the PARENT
//   slot's existing paths (bounded by parentSlot.pathCount) — never the
//   child registry's slots. This is what makes a late link cheap.
//
//   materializePathsForSlot (called from ensv2Registry.ts::handleLabelRegistered)
//   creates paths by looping over the REGISTERING slot's own registry's
//   existing namespaces (bounded by registry.namespaceCount). This is what
//   makes "project into Domain only when the namespace existed at
//   registration time" true: a namespace linked after a name is already
//   registered simply isn't in that loop yet, so no path gets materialised
//   for it — see docs/plan.md Phase 4 plan for the full reasoning.
//
// Get either loop direction backwards and the proposal's core safety
// property (no unbounded recursive backfill) breaks.
import { Address, Bytes, ethereum, log } from "@graphprotocol/graph-ts";

import { checkValidLabel, createEventID } from "./utils";
import {
  appendRegistryNamespaceIndex,
  isZeroAddress,
  nameSlotId,
  namespaceId,
  namespaceLinkId,
  pathNamehash,
  pathNamespaceIndexId,
  registryNamespaceIndexId,
  slotPathIndexId,
  toSlotId,
} from "./ensv2Utils";
import { getOrCreateRegistry } from "./ensv2Discovery";
import { getOrCreateResolver } from "./ensv2Resolver";
import { projectPathToDomain } from "./ensv2Domain";
import {
  ENSv2NamePath,
  ENSv2Namespace,
  ENSv2NamespaceLink,
  ENSv2NameSlot,
  ENSv2PathNamespaceIndex,
  ENSv2Registry,
  ENSv2RegistryNamespaceIndex,
  ENSv2ResolverUpdate,
  ENSv2Resource,
  ENSv2SlotPathIndex,
  ENSv2SubregistryUpdate,
} from "./types/schema";
import {
  LabelRegistered,
  ParentUpdated,
  ResolverUpdated,
  SubregistryUpdated,
} from "./types/RootRegistry/PermissionedRegistry";


function appendSlotPathIndex(slot: ENSv2NameSlot, path: ENSv2NamePath): void {
  let index = new ENSv2SlotPathIndex(slotPathIndexId(slot.id, slot.pathCount));
  index.slot = slot.id;
  index.index = slot.pathCount;
  index.path = path.id;
  index.save();

  slot.pathCount = slot.pathCount + 1;
  slot.save();
}

function appendPathNamespaceIndex(
  path: ENSv2NamePath,
  namespace: ENSv2Namespace
): void {
  let index = new ENSv2PathNamespaceIndex(
    pathNamespaceIndexId(path.id, path.namespaceCount)
  );
  index.path = path.id;
  index.index = path.namespaceCount;
  index.namespace = namespace.id;
  index.save();

  path.namespaceCount = path.namespaceCount + 1;
  path.save();
}

// Idempotent: sets active = true whether creating or reactivating. Caller
// checks pre-existence (ENSv2Namespace.load(id) == null, before calling
// this) to decide whether to append indices — reactivation must never
// re-append (docs/plan.md Phase 4 Decision 5).
function createOrReactivateNamespace(
  childRegistry: ENSv2Registry,
  parentSlot: ENSv2NameSlot,
  parentPath: ENSv2NamePath,
  event: SubregistryUpdated
): ENSv2Namespace {
  let id = namespaceId(childRegistry.id, parentPath.namehash);
  let namespace = ENSv2Namespace.load(id);
  if (namespace == null) {
    namespace = new ENSv2Namespace(id);
    namespace.registry = childRegistry.id;
    namespace.createdAt = event.block.timestamp;
    namespace.createdAtBlock = event.block.number;
  }
  namespace.parentPath = parentPath.id;
  namespace.parentSlot = parentSlot.id;
  namespace.parentRegistry = parentSlot.registry;
  namespace.parentSlotId = parentSlot.slotId;
  namespace.parentTokenId = event.params.tokenId;
  let parentResourceId = parentSlot.currentResource;
  if (parentResourceId) {
    let resourceEntity = ENSv2Resource.load(parentResourceId!);
    if (resourceEntity != null) {
      namespace.parentResource = resourceEntity.resource;
    }
  }
  namespace.baseName = parentPath.name;
  namespace.baseNamehash = parentPath.namehash;
  namespace.active = true;
  namespace.updatedAtBlock = event.block.number;
  namespace.transactionID = event.transaction.hash;
  namespace.logIndex = event.logIndex;
  namespace.save();
  return namespace;
}

function upsertNamespaceLink(
  parentRegistryId: Bytes,
  parentSlot: ENSv2NameSlot,
  previousChildAddress: Bytes | null,
  event: SubregistryUpdated
): void {
  // A slot can only point at one subregistry at a time — deactivate the
  // superseded link first (docs/plan.md Phase 4 Decisions 1-2). Nullable-
  // Bytes comparison, not `!==`/`==` (docs/plan.md's AssemblyScript
  // compiler gotcha, fix plan Phase 5): truthy-guard, then .equals(); an
  // empty Bytes() replaces the old "" sentinel (fix plan Phase 5 Decision
  // 5) — a real address is never zero-length, so the semantics are the same.
  if (previousChildAddress) {
    let newChildAddress: Bytes = isZeroAddress(event.params.subregistry)
      ? Bytes.empty()
      : event.params.subregistry;
    let isSameTarget = previousChildAddress!.equals(newChildAddress);
    if (!isSameTarget) {
      let oldLinkId = namespaceLinkId(
        parentRegistryId,
        parentSlot.slotId,
        previousChildAddress!
      );
      let oldLink = ENSv2NamespaceLink.load(oldLinkId);
      if (oldLink != null) {
        oldLink.active = false;
        oldLink.save();
      }
    }
  }

  if (isZeroAddress(event.params.subregistry)) {
    return;
  }

  let childAddress = event.params.subregistry;
  let linkId = namespaceLinkId(parentRegistryId, parentSlot.slotId, childAddress);
  let link = ENSv2NamespaceLink.load(linkId);
  if (link == null) {
    link = new ENSv2NamespaceLink(linkId);
    link.parentRegistry = parentRegistryId;
    link.parentSlot = parentSlot.id;
    link.parentSlotId = parentSlot.slotId;
    link.childRegistryAddress = event.params.subregistry;
    link.childRegistry = childAddress;
  }
  link.parentTokenId = event.params.tokenId;
  // Was never assigned anywhere (audit finding 16) — the sibling
  // ENSv2Namespace.parentResource is populated the same way one function
  // over (createOrReactivateNamespace), using data already in scope here.
  let parentResourceId = parentSlot.currentResource;
  if (parentResourceId) {
    let resourceEntity = ENSv2Resource.load(parentResourceId!);
    if (resourceEntity != null) {
      link.parentResource = resourceEntity.resource;
    }
  }
  link.active = true;
  link.transactionID = event.transaction.hash;
  link.blockNumber = event.block.number;
  link.logIndex = event.logIndex;
  link.save();
}

// Reconstructs the same namespace ids the creation loop would have produced
// (childRegistry + each existing path's namehash) and deactivates them —
// never deletes (docs/plan.md Phase 4 Decision 3).
function deactivateNamespacesFromParentSlot(
  parentSlot: ENSv2NameSlot,
  previousChildRegistryId: Bytes,
  block: ethereum.Block
): void {
  for (let i = 0; i < parentSlot.pathCount; i++) {
    let pathIndex = ENSv2SlotPathIndex.load(slotPathIndexId(parentSlot.id, i));
    if (pathIndex == null) {
      continue;
    }
    let parentPath = ENSv2NamePath.load(pathIndex.path);
    if (parentPath == null) {
      continue;
    }
    let namespace = ENSv2Namespace.load(
      namespaceId(previousChildRegistryId, parentPath.namehash)
    );
    if (namespace == null) {
      continue;
    }
    namespace.active = false;
    namespace.updatedAtBlock = block.number;
    namespace.save();
  }
}

export function handleSubregistryUpdated(event: SubregistryUpdated): void {
  let parentRegistryId = event.address;
  let parentSlotId = toSlotId(event.params.tokenId);
  let parentSlot = ENSv2NameSlot.load(nameSlotId(parentRegistryId, parentSlotId));
  if (parentSlot == null) {
    log.warning("SubregistryUpdated for unknown slot {} on registry {}", [
      parentSlotId.toString(),
      parentRegistryId.toHexString(),
    ]);
    return;
  }

  let previousChildAddress = parentSlot.subregistry;

  parentSlot.subregistryAddress = isZeroAddress(event.params.subregistry)
    ? null
    : event.params.subregistry;
  parentSlot.subregistry = isZeroAddress(event.params.subregistry)
    ? null
    : event.params.subregistry;
  parentSlot.updatedAt = event.block.timestamp;
  parentSlot.updatedAtBlock = event.block.number;
  parentSlot.save();

  let history = new ENSv2SubregistryUpdate(createEventID(event));
  history.slot = parentSlot.id;
  history.blockNumber = event.block.number;
  history.transactionID = event.transaction.hash;
  history.logIndex = event.logIndex;
  history.subregistryAddress = isZeroAddress(event.params.subregistry)
    ? null
    : event.params.subregistry;
  history.sender = event.params.sender;
  history.save();

  upsertNamespaceLink(parentRegistryId, parentSlot, previousChildAddress, event);

  if (isZeroAddress(event.params.subregistry)) {
    if (previousChildAddress) {
      deactivateNamespacesFromParentSlot(
        parentSlot,
        previousChildAddress!,
        event.block
      );
    }
    return;
  }

  // Direct non-zero-to-non-zero swap (registry A -> registry B, no
  // intervening clear-to-zero) — setSubregistry has no on-chain requirement
  // to pass through zero first, so this is reachable, not hypothetical.
  // Without this, namespaces from the superseded registry A stay
  // active:true forever and can resurface if A later gets its own
  // registrations (audit finding 6).
  if (previousChildAddress && !previousChildAddress!.equals(event.params.subregistry)) {
    deactivateNamespacesFromParentSlot(parentSlot, previousChildAddress!, event.block);
  }

  let childRegistry = getOrCreateRegistry(
    event.params.subregistry,
    event.params.subregistry,
    event.block
  );

  // Loop over the PARENT slot's existing paths only — never the child
  // registry's own slots. This loop direction is the entire mechanism
  // enforcing the bounded-cost projection rule.
  for (let i = 0; i < parentSlot.pathCount; i++) {
    let pathIndex = ENSv2SlotPathIndex.load(slotPathIndexId(parentSlot.id, i));
    if (pathIndex == null) {
      continue;
    }
    let parentPath = ENSv2NamePath.load(pathIndex.path);
    if (parentPath == null || !parentPath.active) {
      continue;
    }

    let isNewNamespace =
      ENSv2Namespace.load(namespaceId(childRegistry.id, parentPath.namehash)) ==
      null;
    let namespace = createOrReactivateNamespace(
      childRegistry,
      parentSlot,
      parentPath,
      event
    );
    if (isNewNamespace) {
      appendRegistryNamespaceIndex(childRegistry, namespace);
      appendPathNamespaceIndex(parentPath, namespace);
    }
  }
}

// The other bounded loop (see file header): iterates the REGISTERING
// slot's own registry's existing active namespaces, materialising or
// reactivating one path per namespace. Called from
// ensv2Registry.ts::handleLabelRegistered after the slot is saved.
export function materializePathsForSlot(
  registry: ENSv2Registry,
  slot: ENSv2NameSlot,
  event: LabelRegistered,
  isV1Migration: boolean
): void {
  for (let i = 0; i < registry.namespaceCount; i++) {
    let index = ENSv2RegistryNamespaceIndex.load(
      registryNamespaceIndexId(registry.id, i)
    );
    if (index == null) {
      continue;
    }
    let namespace = ENSv2Namespace.load(index.namespace);
    if (namespace == null || !namespace.active) {
      continue;
    }

    let pathId = pathNamehash(namespace.baseNamehash, slot.labelhash);
    let path = ENSv2NamePath.load(pathId);
    if (path == null) {
      path = materializeNamePath(pathId, namespace, slot, event);
      appendSlotPathIndex(slot, path);
    } else {
      path.active = true;
      path.updatedAt = event.block.timestamp;
      path.updatedAtBlock = event.block.number;
      path.save();
    }

    projectPathToDomain(path, slot, event, isV1Migration);
  }
}

function materializeNamePath(
  pathId: Bytes,
  namespace: ENSv2Namespace,
  slot: ENSv2NameSlot,
  event: LabelRegistered
): ENSv2NamePath {
  let path = new ENSv2NamePath(pathId);
  path.slot = slot.id;
  path.registry = slot.registry;
  path.namespace = namespace.id;

  let parentPathId = namespace.parentPath;
  let depth = 0;
  let name: string | null = null;
  let label: string | null = null;
  if (checkValidLabel(slot.label)) {
    label = slot.label;
  } else {
    label = "[" + slot.labelhash.toHexString().slice(2) + "]";
  }
  path.label = label;

  if (parentPathId) {
    path.parent = parentPathId!;
    let parentPath = ENSv2NamePath.load(parentPathId!);
    if (parentPath != null) {
      depth = parentPath.depth + 1;
      if (parentPath.name !== null && label !== null) {
        name = (label as string) + "." + (parentPath.name as string);
      }
    }
  } else {
    // Root-level namespace (e.g. the "eth" registration under RootRegistry).
    depth = 0;
    name = label;
  }

  path.name = name;
  path.labelhash = slot.labelhash;
  path.namehash = pathNamehash(namespace.baseNamehash, slot.labelhash);
  path.depth = depth;
  path.active = true;
  path.namespaceCount = 0;
  path.createdAt = event.block.timestamp;
  path.updatedAt = event.block.timestamp;
  path.createdAtBlock = event.block.number;
  path.updatedAtBlock = event.block.number;
  path.save();
  return path;
}

export function handleResolverUpdated(event: ResolverUpdated): void {
  let registryId = event.address;
  let slotId = toSlotId(event.params.tokenId);
  let slot = ENSv2NameSlot.load(nameSlotId(registryId, slotId));
  if (slot == null) {
    log.warning("ResolverUpdated for unknown slot {} on registry {}", [
      slotId.toString(),
      registryId.toHexString(),
    ]);
    return;
  }

  if (isZeroAddress(event.params.resolver)) {
    slot.resolverAddress = null;
    slot.resolver = null;
  } else {
    slot.resolverAddress = event.params.resolver;
    // Shared with ensv2Resolver.ts's own get-or-create instead of
    // maintaining a second copy here (audit finding 23).
    let resolverEntity = getOrCreateResolver(event.params.resolver);
    slot.resolver = resolverEntity.id;
  }
  slot.updatedAt = event.block.timestamp;
  slot.updatedAtBlock = event.block.number;
  slot.save();

  let history = new ENSv2ResolverUpdate(createEventID(event));
  history.slot = slot.id;
  history.blockNumber = event.block.number;
  history.transactionID = event.transaction.hash;
  history.logIndex = event.logIndex;
  history.resolverAddress = isZeroAddress(event.params.resolver)
    ? null
    : event.params.resolver;
  history.sender = event.params.sender;
  history.save();
}

// Enrichment only — must never gate other logic (dynamically-linked
// registries can legitimately return getParent() = (0x0, "")). No history
// entity (not in the proposal's history-entity list, same precedent as
// LabelReserved in Phase 2).
export function handleParentUpdated(event: ParentUpdated): void {
  let registryId = event.address;
  let registry = ENSv2Registry.load(registryId);
  if (registry == null) {
    // Unreachable through the current call graph: this function's only
    // caller (ensv2Registry.ts's wrapper) always calls bootstrapRegistry()
    // first, which unconditionally creates this exact row. Kept as a guard
    // rather than an assertion in case that invariant is ever broken by a
    // future refactor (audit finding 25) — if this ever actually logs,
    // that invariant has broken and needs investigating.
    log.warning("ParentUpdated for unknown registry {}", [
      registryId.toHexString(),
    ]);
    return;
  }

  if (isZeroAddress(event.params.parent)) {
    registry.canonicalParentRegistry = null;
    // Cleared explicitly, not via checkValidLabel("") below — an empty
    // string trivially passes that check, so relying on it here would
    // leave canonicalParentLabel as "" while canonicalParentRegistry is
    // null, two different answers to "does this have a parent" for the
    // same event (audit finding 20).
    registry.canonicalParentLabel = null;
  } else {
    let parentRegistry = getOrCreateRegistry(
      event.params.parent,
      event.params.parent,
      event.block
    );
    registry.canonicalParentRegistry = parentRegistry.id;
    if (checkValidLabel(event.params.label)) {
      registry.canonicalParentLabel = event.params.label;
    } else {
      // A malformed new label must not leave the OLD parent's label sitting
      // next to the NEW parent's registry — that mismatch is exactly what
      // audit finding 20 flagged. Clearing to null (rather than echoing the
      // still-untrusted raw string back out, which could itself carry the
      // same unsafe characters checkValidLabel exists to catch) is the safe
      // choice here.
      registry.canonicalParentLabel = null;
    }
  }
  registry.updatedAtBlock = event.block.number;
  registry.save();
}
