// Import types and APIs from graph-ts
import { Address, BigInt, ByteArray, Bytes, ethereum, log } from "@graphprotocol/graph-ts";
import { Account, Domain } from "./types/schema";

// Fixed-width Bytes concatenation, no delimiter needed: block.number and
// logIndex are each encoded as a 32-byte big-endian value via
// uint256ToByteArray, so there's no ambiguity despite no separator
// (fix plan Phase 5 Decision 1).
export function createEventID(event: ethereum.Event): Bytes {
  return Bytes.fromByteArray(
    concat(
      uint256ToByteArray(event.block.number),
      uint256ToByteArray(event.logIndex)
    )
  );
}

export const ETH_NODE = Bytes.fromHexString(
  "0x93cdeb708b7545dc668eb9280176169d1c33cfd8ed6f04690a0bcc88a93fc4ae"
);
export const ROOT_NODE = Bytes.fromHexString(
  "0x0000000000000000000000000000000000000000000000000000000000000000"
);
// Address.zero() replaces both the old EMPTY_ADDRESS (string) and
// EMPTY_ADDRESS_BYTEARRAY (ByteArray) constants — both were the same 20
// zero bytes under two different types, only needed because ids used to be
// strings; Bytes ids make the distinction unnecessary.
export const EMPTY_ADDRESS = Address.zero();

// Helper for concatenating two byte arrays
export function concat(a: ByteArray, b: ByteArray): ByteArray {
  let out = new Uint8Array(a.length + b.length);
  for (let i = 0; i < a.length; i++) {
    out[i] = a[i];
  }
  for (let j = 0; j < b.length; j++) {
    out[a.length + j] = b[j];
  }
  // return out as ByteArray
  return changetype<ByteArray>(out);
}

export function byteArrayFromHex(s: string): ByteArray {
  if (s.length % 2 !== 0) {
    throw new TypeError("Hex string must have an even number of characters");
  }
  let out = new Uint8Array(s.length / 2);
  for (var i = 0; i < s.length; i += 2) {
    out[i / 2] = parseInt(s.substring(i, i + 2), 16) as u32;
  }
  return changetype<ByteArray>(out);
}

export function uint256ToByteArray(i: BigInt): ByteArray {
  let hex = i.toHex().slice(2).padStart(64, "0");
  return byteArrayFromHex(hex);
}

// 4-byte big-endian encoding for small loop/index counters (fix plan Phase 5
// Decision 1) — the i32 equivalent of uint256ToByteArray, for composite ids
// that embed a batch-transfer loop index or a path/namespace index counter
// rather than a full BigInt.
export function i32ToBytes(i: i32): ByteArray {
  let out = new Uint8Array(4);
  out[0] = ((i >> 24) & 0xff) as u8;
  out[1] = ((i >> 16) & 0xff) as u8;
  out[2] = ((i >> 8) & 0xff) as u8;
  out[3] = (i & 0xff) as u8;
  return changetype<ByteArray>(out);
}

export function createOrLoadAccount(address: Bytes): Account {
  let account = Account.load(address);
  if (account == null) {
    account = new Account(address);
    account.save();
  }

  return account;
}

export function createOrLoadDomain(node: Bytes): Domain {
  let domain = Domain.load(node);
  if (domain == null) {
    domain = new Domain(node);
    domain.save();
  }

  return domain;
}

export function checkValidLabel(name: string | null): boolean {
  if (name == null) {
    return false;
  }
  // for compiler
  name = name!;
  for (let i = 0; i < name.length; i++) {
    let charCode = name.charCodeAt(i);
    if (charCode === 0) {
      // 0 = null byte
      log.warning("Invalid label '{}' contained null byte. Skipping.", [name]);
      return false;
    } else if (charCode === 46) {
      // 46 = .
      log.warning(
        "Invalid label '{}' contained separator char '.'. Skipping.",
        [name]
      );
      return false;
    } else if (charCode === 91) {
      // 91 = [
      log.warning("Invalid label '{}' contained char '['. Skipping.", [name]);
      return false;
    } else if (charCode === 93) {
      // 93 = ]
      log.warning("Invalid label '{}' contained char ']'. Skipping.", [name]);
      return false;
    }
  }

  return true;
}
