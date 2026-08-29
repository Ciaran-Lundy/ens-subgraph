// ENSv2 ID and helper functions. Reuse src/utils.ts for anything not
// specific to the registry-scoped ENSv2 entity model (concat,
// checkValidLabel, createEventID, uint256ToByteArray, i32ToBytes,
// createOrLoadAccount, createOrLoadDomain) — do not duplicate those here.
//
// Every composite id below is a fixed-width Bytes concatenation with no
// delimiter (fix plan Phase 5 Decision 1): each component is either already
// a fixed byte width (an address or namehash) or made one via
// uint256ToByteArray (32-byte big-endian BigInt) / i32ToBytes (4-byte
// big-endian counter) — so there's no ambiguity despite no separator byte.
import { Address, BigInt, Bytes, crypto } from "@graphprotocol/graph-ts";
import { concat, i32ToBytes, uint256ToByteArray } from "./utils";

// 2^32, used to zero the lower 32 bits of a BigInt without needing
// BigInt.bitAnd/bitXor (not available in the installed graph-ts 0.31.0).
const TWO_POW_32 = BigInt.fromI64(4294967296);

export function nameSlotId(registry: Bytes, slotId: BigInt): Bytes {
  return Bytes.fromByteArray(concat(registry, uint256ToByteArray(slotId)));
}

export function resourceId(registry: Bytes, resource: BigInt): Bytes {
  return Bytes.fromByteArray(concat(registry, uint256ToByteArray(resource)));
}

export function tokenEntityId(registry: Bytes, tokenId: BigInt): Bytes {
  return Bytes.fromByteArray(concat(registry, uint256ToByteArray(tokenId)));
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

export function slotPathIndexId(slotId: Bytes, index: i32): Bytes {
  return Bytes.fromByteArray(concat(slotId, i32ToBytes(index)));
}

export function registryNamespaceIndexId(
  registryId: Bytes,
  index: i32
): Bytes {
  return Bytes.fromByteArray(concat(registryId, i32ToBytes(index)));
}

export function pathNamespaceIndexId(pathId: Bytes, index: i32): Bytes {
  return Bytes.fromByteArray(concat(pathId, i32ToBytes(index)));
}

export function namespaceId(registryId: Bytes, baseNamehash: Bytes): Bytes {
  return Bytes.fromByteArray(concat(registryId, baseNamehash));
}

export function namespaceLinkId(
  parentRegistryId: Bytes,
  parentSlotId: BigInt,
  childAddress: Bytes
): Bytes {
  return Bytes.fromByteArray(
    concat(
      concat(parentRegistryId, uint256ToByteArray(parentSlotId)),
      childAddress
    )
  );
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
