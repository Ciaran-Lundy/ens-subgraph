// ENSv2 ID and helper functions. Reuse src/utils.ts for anything not
// specific to the registry-scoped ENSv2 entity model (concat,
// checkValidLabel, createEventID, uint256ToByteArray, createOrLoadAccount,
// createOrLoadDomain) — do not duplicate those here.
import { Address, BigInt, Bytes, crypto } from "@graphprotocol/graph-ts";
import { concat } from "./utils";

// 2^32, used to zero the lower 32 bits of a BigInt without needing
// BigInt.bitAnd/bitXor (not available in the installed graph-ts 0.31.0).
const TWO_POW_32 = BigInt.fromI64(4294967296);

export function nameSlotId(registry: string, slotId: BigInt): string {
  return registry.concat("-").concat(slotId.toString());
}

export function resourceId(registry: string, resource: BigInt): string {
  return registry.concat("-").concat(resource.toString());
}

export function tokenEntityId(registry: string, tokenId: BigInt): string {
  return registry.concat("-").concat(tokenId.toString());
}

// Port of LibLabel.withVersion(anyId, 0) from contracts-v2's
// contracts/src/utils/LibLabel.sol:
//   withVersion(anyId, versionId) = anyId ^ uint32(anyId) ^ versionId
// For versionId = 0 this reduces to `anyId ^ uint32(anyId)`, which zeroes
// the lower 32 bits of anyId (XOR-ing a value with its own low 32 bits
// clears them; higher bits are untouched since the low-32 value
// zero-extends). Equivalent to `anyId - (anyId mod 2^32)`.
export function toSlotId(anyId: BigInt): BigInt {
  return anyId.minus(anyId.mod(TWO_POW_32));
}

export function isZeroAddress(a: Address): boolean {
  return a.equals(Address.zero());
}

export function slotPathIndexId(slotId: string, index: i32): string {
  return slotId.concat("-").concat(index.toString());
}

export function registryNamespaceIndexId(
  registryId: string,
  index: i32
): string {
  return registryId.concat("-").concat(index.toString());
}

export function pathNamespaceIndexId(pathId: string, index: i32): string {
  return pathId.concat("-").concat(index.toString());
}

export function namespaceId(registryId: string, baseNamehash: Bytes): string {
  return registryId.concat("-").concat(baseNamehash.toHexString());
}

export function namespaceLinkId(
  parentRegistryId: string,
  parentSlotId: BigInt,
  childAddress: string
): string {
  return parentRegistryId
    .concat("-")
    .concat(parentSlotId.toString())
    .concat("-")
    .concat(childAddress);
}

// ENSv2NamePath.id = namehash hex (schema's own ID comment), computed the
// same way as ensRegistry.ts::makeSubnode's keccak256(concat(parentNode,
// labelHash)) — here parentNode is a namespace's baseNamehash. Lives here
// (not ensv2Paths.ts, where it originated) because ensv2Domain.ts also
// needs it (to recover a slot's Domain id at transfer time, Phase 6) and
// ensv2Paths.ts already imports from ensv2Domain.ts — putting it in this
// dependency-free utils file avoids a circular import either way.
export function pathNamehash(baseNamehash: Bytes, labelhash: Bytes): Bytes {
  return Bytes.fromByteArray(crypto.keccak256(concat(baseNamehash, labelhash)));
}
