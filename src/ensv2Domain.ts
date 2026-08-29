// Option B compatibility projection: every ENSv2NamePath materialised by
// ensv2Paths.ts::materializePathsForSlot gets a legacy Domain row (this is
// what lets existing ENSv1 consumers keep working unchanged for ENSv2-origin
// names), and real .eth registrations additionally get a legacy Registration
// row. Only ever creates rows for names that never existed in ENSv1.
//
// Migration correction (Phase 6): re-reading the proposal's migration bullet
// literally, domain.owner is never mentioned in either the wrapped or
// unwrapped branch — deliberately, since it reflects ENSv1 ENSRegistry-level
// ownership, which the migration's own "graveyard" voiding step already
// legitimately moved away from the real user (a true fact about the retired
// v1 system, not something to overwrite). wrappedOwner/registrant are
// different — they're what real consumers read to find "who controls this
// name" — so those get corrected, domain.owner does not.
import { BigInt, Bytes } from "@graphprotocol/graph-ts";
import { checkValidLabel } from "./utils";
import { getEthRegistryAddress, getV2GracePeriod } from "./ensv2Constants";
import { pathNamehash, registryNamespaceIndexId } from "./ensv2Utils";
import {
  Domain,
  ENSv2NamePath,
  ENSv2NameSlot,
  ENSv2Namespace,
  ENSv2Registry,
  ENSv2RegistryNamespaceIndex,
  Registration,
  WrappedDomain,
} from "./types/schema";
import { LabelRegistered } from "./types/RootRegistry/PermissionedRegistry";

// Recovers a slot's namehash (Domain.id) without a ENSv2NamePath in hand —
// needed at transfer time (Phase 6), when only the slot is available.
// Read-only mirror of materializePathsForSlot's namespace loop; ENSv2NameSlot
// deliberately has no direct Domain/namehash field of its own, only
// labelhash, so this has to be recomputed rather than stored.
export function getEthDomainId(slot: ENSv2NameSlot): Bytes | null {
  let registry = ENSv2Registry.load(slot.registry);
  if (registry == null) {
    return null;
  }
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
    // Nullable-Bytes truthy check, not `!== null` (docs/plan.md's
    // AssemblyScript compiler gotcha, fix plan Phase 5).
    if (path != null && path.domain) {
      return path.domain!;
    }
  }
  return null;
}

// The single reusable implementation of the wrapped/unwrapped correction
// branch — called both at initial migration-flagged registration and at
// every subsequent TransferSingle/TransferBatch on a migratedFromV1 slot
// (docs/plan.md: transfers must keep writing to "the same legacy field").
// Re-checks WrappedDomain existence fresh every call rather than caching the
// original classification.
export function correctMigratedLegacyOwner(
  domainId: Bytes,
  registrationId: Bytes,
  ownerId: Bytes
): void {
  let wrappedDomain = WrappedDomain.load(domainId);
  if (wrappedDomain != null) {
    wrappedDomain.owner = ownerId;
    wrappedDomain.save();
    let domain = Domain.load(domainId);
    if (domain != null) {
      domain.wrappedOwner = ownerId;
      domain.save();
    }
  } else {
    let domain = Domain.load(domainId);
    if (domain != null) {
      domain.registrant = ownerId;
      domain.save();
    }
    let registration = Registration.load(registrationId);
    if (registration != null) {
      registration.registrant = ownerId;
      registration.save();
    }
  }
}

function syncEthRegistration(
  slot: ENSv2NameSlot,
  path: ENSv2NamePath,
  event: LabelRegistered,
  isV1Migration: boolean
): void {
  let id = slot.labelhash;
  let registration = Registration.load(id);
  if (registration == null) {
    registration = new Registration(id);
    registration.registrationDate = event.block.timestamp;
  }
  registration.domain = path.id;
  let slotExpiryDate = slot.expiryDate;
  if (slotExpiryDate) {
    registration.expiryDate = slotExpiryDate!;
  }
  // Migrated names: registrant correction (if any) is entirely
  // correctMigratedLegacyOwner's job (branch-aware — wrapped names must NOT
  // get registrant overwritten here).
  if (!isV1Migration) {
    let registrantId = slot.registrant;
    if (registrantId) {
      registration.registrant = registrantId!;
    }
  }
  if (checkValidLabel(slot.label)) {
    registration.labelName = slot.label;
  }
  registration.save();
}

export function projectPathToDomain(
  path: ENSv2NamePath,
  slot: ENSv2NameSlot,
  event: LabelRegistered,
  isV1Migration: boolean
): void {
  let ownerId = slot.owner;
  if (!ownerId) {
    // Phase 2's handleLabelRegistered always sets slot.owner before this
    // runs — defensive only, should never actually trigger.
    return;
  }

  let domain = Domain.load(path.id);
  if (domain == null) {
    domain = new Domain(path.id);
    domain.createdAt = event.block.timestamp;
    domain.subdomainCount = 0;
  }

  domain.name = path.name;
  if (checkValidLabel(path.label)) {
    domain.labelName = path.label;
  }
  domain.labelhash = path.labelhash;
  // Migrated names: domain.owner is never touched (see file header) — it
  // stays whatever the v1 graveyard-voiding step already set it to.
  if (!isV1Migration) {
    domain.owner = ownerId!;
  }
  // Migrated names: registrant correction is correctMigratedLegacyOwner's
  // job below (branch-aware), not this generic assignment.
  if (!isV1Migration) {
    let registrantId = slot.registrant;
    if (registrantId) {
      domain.registrant = registrantId!;
    }
  }
  domain.isMigrated = true;

  let parentPathId = path.parent;
  if (parentPathId) {
    let parentPath = ENSv2NamePath.load(parentPathId!);
    if (parentPath != null && parentPath.domain) {
      domain.parent = parentPath.domain!;
    }
  }

  // v2GracePeriod is ETHRegistrar/ETHRenewerV1-specific policy — only
  // applied for real .eth registrations, where Domain.expiryDate has always
  // meant the true reregistration-availability date, not raw expiry.
  let isEth = slot.registry.equals(getEthRegistryAddress());
  let slotExpiryDate = slot.expiryDate;
  if (isEth && slotExpiryDate) {
    domain.expiryDate = slotExpiryDate!.plus(getV2GracePeriod());
  } else {
    domain.expiryDate = slotExpiryDate;
  }
  domain.save();

  path.domain = domain.id;
  path.save();

  if (isEth) {
    syncEthRegistration(slot, path, event, isV1Migration);
    if (isV1Migration) {
      correctMigratedLegacyOwner(domain.id, slot.labelhash, ownerId!);
    }
  }
}
