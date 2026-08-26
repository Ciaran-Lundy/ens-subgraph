// Line-for-line ports of src/ensv2Utils.ts and the id-relevant parts of
// src/utils.ts — kept in sync with those files by hand (Design decision 2
// of the reconciliation plan): if the real mapping's id scheme changes,
// this file must change with it, so a check never silently drifts into
// comparing against a stale id scheme.
import { keccak256, getBytes, concat as ethersConcat, toBeHex } from "ethers";

// src/utils.ts::createEventID
export function createEventID(blockNumber, logIndex) {
  return `${blockNumber}-${logIndex}`;
}

// src/utils.ts::concat, but ethers' own concat already does this — kept as
// a named wrapper so call sites read the same as the AssemblyScript source.
export function concatBytes(a, b) {
  return ethersConcat([a, b]);
}

// src/ensv2Utils.ts::nameSlotId
export function nameSlotId(registry, slotId) {
  return `${registry.toLowerCase()}-${slotId.toString()}`;
}

// src/ensv2Utils.ts::resourceId
export function resourceId(registry, resource) {
  return `${registry.toLowerCase()}-${resource.toString()}`;
}

// src/ensv2Utils.ts::tokenEntityId
export function tokenEntityId(registry, tokenId) {
  return `${registry.toLowerCase()}-${tokenId.toString()}`;
}

// src/ensv2Utils.ts::toSlotId — LibLabel.withVersion(anyId, 0), i.e. zero
// the low 32 bits of a uint256.
const TWO_POW_32 = 4294967296n;
export function toSlotId(anyId) {
  return anyId - (anyId % TWO_POW_32);
}

// src/ensv2Utils.ts::isZeroAddress
export function isZeroAddress(address) {
  return address.toLowerCase() === "0x0000000000000000000000000000000000000000";
}

// src/ensv2Utils.ts::slotPathIndexId / registryNamespaceIndexId / pathNamespaceIndexId
export function slotPathIndexId(slotId, index) {
  return `${slotId}-${index}`;
}
export function registryNamespaceIndexId(registryId, index) {
  return `${registryId}-${index}`;
}
export function pathNamespaceIndexId(pathId, index) {
  return `${pathId}-${index}`;
}

// src/ensv2Utils.ts::namespaceId
export function namespaceId(registryId, baseNamehash) {
  return `${registryId.toLowerCase()}-${baseNamehash.toLowerCase()}`;
}

// src/ensv2Utils.ts::namespaceLinkId
export function namespaceLinkId(parentRegistryId, parentSlotId, childAddress) {
  return `${parentRegistryId.toLowerCase()}-${parentSlotId.toString()}-${childAddress.toLowerCase()}`;
}

// src/ensv2Utils.ts::pathNamehash — keccak256(concat(parentNode, labelHash)),
// same construction as ensRegistry.ts::makeSubnode.
export function pathNamehash(baseNamehash, labelhash) {
  return keccak256(ethersConcat([getBytes(baseNamehash), getBytes(labelhash)]));
}

// src/ensRegistry.ts::makeSubnode / ethRegistrar.ts's rootNode-based
// namehash construction — same keccak256(concat(node, labelHash)) shape,
// named separately since ENSv1 checks reason about it via ETH_NODE/ROOT_NODE
// rather than a namespace's baseNamehash.
export function makeSubnode(node, labelhash) {
  return keccak256(ethersConcat([getBytes(node), getBytes(labelhash)]));
}

// src/utils.ts::uint256ToByteArray — a uint256 tokenId as 32 bytes (used as
// the legacy Domain/Registration labelhash-equivalent id for `.eth` names).
export function uint256ToBytes32(id) {
  return toBeHex(id, 32);
}
