// Option B compatibility projection: every ENSv2NamePath materialised by
// ensv2Paths.ts::materializePathsForSlot gets a legacy Domain row (this is
// what lets existing ENSv1 consumers keep working unchanged for ENSv2-origin
// names), and real .eth registrations additionally get a legacy Registration
// row. Only ever creates rows for names that never existed in ENSv1 —
// migration-specific corrections to pre-existing legacy rows are Phase 6.
import { BigInt } from "@graphprotocol/graph-ts";
import { checkValidLabel } from "./utils";
import { getEthRegistryAddress, getV2GracePeriod } from "./ensv2Constants";
import {
  Domain,
  ENSv2NamePath,
  ENSv2NameSlot,
  Registration,
} from "./types/schema";
import { LabelRegistered } from "./types/RootRegistry/PermissionedRegistry";

function syncEthRegistration(
  slot: ENSv2NameSlot,
  path: ENSv2NamePath,
  event: LabelRegistered
): void {
  let id = slot.labelhash.toHexString();
  let registration = Registration.load(id);
  if (registration == null) {
    registration = new Registration(id);
    registration.registrationDate = event.block.timestamp;
  }
  registration.domain = path.id;
  let slotExpiryDate = slot.expiryDate;
  if (slotExpiryDate !== null) {
    registration.expiryDate = slotExpiryDate as BigInt;
  }
  let registrantId = slot.registrant;
  if (registrantId !== null) {
    registration.registrant = registrantId as string;
  }
  if (checkValidLabel(slot.label)) {
    registration.labelName = slot.label;
  }
  registration.save();
}

export function projectPathToDomain(
  path: ENSv2NamePath,
  slot: ENSv2NameSlot,
  event: LabelRegistered
): void {
  let ownerId = slot.owner;
  if (ownerId == null) {
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
  domain.owner = ownerId as string;
  let registrantId = slot.registrant;
  if (registrantId !== null) {
    domain.registrant = registrantId as string;
  }
  domain.isMigrated = true;

  let parentPathId = path.parent;
  if (parentPathId !== null) {
    let parentPath = ENSv2NamePath.load(parentPathId as string);
    if (parentPath != null && parentPath.domain !== null) {
      domain.parent = parentPath.domain as string;
    }
  }

  // v2GracePeriod is ETHRegistrar/ETHRenewerV1-specific policy — only
  // applied for real .eth registrations, where Domain.expiryDate has always
  // meant the true reregistration-availability date, not raw expiry.
  let isEth = slot.registry == getEthRegistryAddress().toHexString();
  let slotExpiryDate = slot.expiryDate;
  if (isEth && slotExpiryDate !== null) {
    domain.expiryDate = (slotExpiryDate as BigInt).plus(getV2GracePeriod());
  } else {
    domain.expiryDate = slotExpiryDate;
  }
  domain.save();

  path.domain = domain.id;
  path.save();

  if (isEth) {
    syncEthRegistration(slot, path, event);
  }
}
