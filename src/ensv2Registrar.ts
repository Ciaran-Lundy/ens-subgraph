// ETHRegistrar enrichment (docs/plan.md Phase 6). NameRegistered/NameRenewed
// are emitted by ETHRegistrar, a different contract from ETHRegistry — the
// registry these events enrich is always the canonical ETHRegistry
// (getEthRegistryAddress()), never event.address (that's ETHRegistrar's own
// address). Easy to get backwards, worth this comment.
//
// ENSv2Registration.id = the same id ENSv2NameSlot uses for this tokenId
// (nameSlotId(ETHRegistry, toSlotId(tokenId))) rather than a new tx-based
// scheme — this is what makes correlating registry/registrar events by
// tokenId order-independent "for free": the id needs nothing from the
// other event, so it doesn't matter which arrives first (docs/plan.md:
// "correlate by transaction hash plus token ID... do not rely on log
// order").
import { log } from "@graphprotocol/graph-ts";
import { checkValidLabel, createOrLoadAccount } from "./utils";
import { getEthRegistryAddress } from "./ensv2Constants";
import { nameSlotId, toSlotId } from "./ensv2Utils";
import { ENSv2Registration } from "./types/schema";
import {
  NameRegistered,
  NameRenewed,
  OwnershipTransferred,
} from "./types/ETHRegistrar/ETHRegistrar";
import { processOwnershipTransferred } from "./accessControl";

export function handleNameRegistered(event: NameRegistered): void {
  let registryId = getEthRegistryAddress();
  let slotId = toSlotId(event.params.tokenId);
  let id = nameSlotId(registryId, slotId);

  let registration = ENSv2Registration.load(id);
  if (registration == null) {
    registration = new ENSv2Registration(id);
    registration.slot = id;
    registration.registrationDate = event.block.timestamp;
    // NameRegistered carries only `duration`, not an absolute expiry — derive
    // it once at creation; handleNameRenewed below refreshes it directly
    // from NameRenewed's own newExpiry on every subsequent renewal. Never
    // populated before this fix (audit finding 5).
    registration.expiryDate = event.block.timestamp.plus(event.params.duration);
  }

  if (checkValidLabel(event.params.label)) {
    registration.label = event.params.label;
  }
  registration.owner = createOrLoadAccount(event.params.owner).id;
  registration.duration = event.params.duration;
  registration.paymentToken = event.params.paymentToken;
  registration.referrer = event.params.referrer;
  registration.base = event.params.base;
  registration.premium = event.params.premium;
  registration.transactionID = event.transaction.hash;
  registration.logIndex = event.logIndex;
  registration.save();
}

export function handleNameRenewed(event: NameRenewed): void {
  let registryId = getEthRegistryAddress();
  let slotId = toSlotId(event.params.tokenId);
  let id = nameSlotId(registryId, slotId);

  // Refresh enrichment only if a registration already exists — a renewal
  // without a prior registration is nonsensical, so never create one here.
  let registration = ENSv2Registration.load(id);
  if (registration == null) {
    log.warning("handleNameRenewed: no ENSv2Registration for {}, skipping", [
      id.toHexString(),
    ]);
    return;
  }
  registration.duration = event.params.duration;
  registration.paymentToken = event.params.paymentToken;
  registration.referrer = event.params.referrer;
  // The contract's own already-resolved absolute expiry (not a delta) —
  // was sitting right here unread alongside the three siblings above
  // (audit finding 5).
  registration.expiryDate = event.params.newExpiry;
  registration.save();
}

export function handleETHRegistrarOwnershipTransferred(
  event: OwnershipTransferred
): void {
  processOwnershipTransferred(event.address, event.params.newOwner, event.block);
}
