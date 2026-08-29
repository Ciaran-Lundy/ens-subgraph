// ENSv2-specific resolver events (docs/plan.md Phase 7). PermissionedResolver's
// standard ENSIP events (AddrChanged, TextChanged, etc.) need no wiring
// here — see Phase 1's Decision 4 in ensv2Discovery.ts/subgraph.yaml: the
// existing addressless "Resolver" data source already picks them up
// (addressless sources match by event topic0 network-wide, not by contract
// address/ABI). docs/plan.md's Phase 7 also describes a resolver.ts refactor
// to "share logic" with a second wiring of those same standard events —
// that's moot given the above (there is no second wiring for it to share
// with), so resolver.ts is untouched this phase; see
// docs/phases/phase-7-resolver-data.md for the full reasoning.
//
// None of the handlers below ever call ensv2Domain.ts::projectPathToDomain
// or construct Domain rows — true by construction, not by a guard: alias
// and resource records are ENSv2-only surfaces, never a substitute for a
// real registry path (docs/plan.md's explicit non-goal).
import { Address, BigInt, Bytes, crypto, ethereum } from "@graphprotocol/graph-ts";
import { concat, ROOT_NODE, uint256ToByteArray } from "./utils";
import { decodeName } from "./nameWrapper";
import { processEACRolesChanged } from "./ensv2Roles";
import { ENSv2Resolver, ENSv2ResolverAlias, ENSv2ResolverData, ENSv2ResolverResource } from "./types/schema";
import {
  AliasChanged,
  DataChanged,
  EACRolesChanged,
  NamedAddrResource,
  NamedDataResource,
  NamedResource,
  NamedTextResource,
} from "./types/PermissionedResolver/PermissionedResolver";

// decodeName only recovers the first label + a dotted human-readable string
// (nameWrapper.ts was never built to compute a namehash). AliasChanged/
// NamedResource/etc. only ever carry a DNS-wire-format name, never a bare
// node bytes32 the way registry events do — so this parses every label
// (mirrors decodeName's own length-prefix walk) and folds them root-to-leaf
// via the same keccak256(concat(node, labelHash)) step used everywhere else
// in this codebase (ensRegistry.ts::makeSubnode, ensv2Utils.ts::pathNamehash)
// — DNS-wire order is leaf-first, namehash folding is root-first, so the
// parsed labels are walked in reverse.
export function namehashFromDnsEncoded(buf: Bytes): Bytes {
  let labels = new Array<Bytes>();
  let offset = 0;
  let hex = buf.toHexString();
  let len = buf[offset++];
  while (len) {
    let labelHex = hex.slice((offset + 1) * 2, (offset + 1 + len) * 2);
    labels.push(Bytes.fromHexString(labelHex));
    offset += len;
    len = buf[offset++];
  }

  let node: Bytes = ROOT_NODE;
  for (let i = labels.length - 1; i >= 0; i--) {
    let labelHash = Bytes.fromByteArray(crypto.keccak256(labels[i]));
    node = Bytes.fromByteArray(crypto.keccak256(concat(node, labelHash)));
  }
  return node;
}

function getOrCreateResolver(address: Address): ENSv2Resolver {
  let id: Bytes = address;
  let resolver = ENSv2Resolver.load(id);
  if (resolver == null) {
    resolver = new ENSv2Resolver(id);
    resolver.address = address;
    resolver.save();
  }
  return resolver;
}

function decodedNameOf(buf: Bytes): string | null {
  let decoded = decodeName(buf);
  if (decoded == null) {
    return null;
  }
  return decoded[1];
}

export function handleAliasChanged(event: AliasChanged): void {
  let resolver = getOrCreateResolver(event.address);
  // fromName is DNS-wire-encoded, arbitrary length — not safe to
  // concatenate raw (fix plan Phase 5 Decision 1/2). Use its namehash
  // instead (already computed below as fromNode, a fixed 32-byte hash) —
  // more meaningful as an id component than the raw bytes anyway.
  let fromNode = namehashFromDnsEncoded(event.params.fromName);
  let id = Bytes.fromByteArray(concat(resolver.id, fromNode));

  let alias = ENSv2ResolverAlias.load(id);
  if (alias == null) {
    alias = new ENSv2ResolverAlias(id);
    alias.resolver = resolver.id;
  }
  alias.fromName = event.params.fromName;
  alias.fromNode = fromNode;
  alias.fromNameDecoded = decodedNameOf(event.params.fromName);

  // Empty toName is the clearing signal — not explicit in the proposal, but
  // consistent with the address(0)-clears convention used everywhere else
  // (docs/plan.md Phase 7 Decision 2).
  let hasTarget = event.params.toName.length > 0;
  if (hasTarget) {
    alias.toName = event.params.toName;
    alias.toNode = namehashFromDnsEncoded(event.params.toName);
    alias.toNameDecoded = decodedNameOf(event.params.toName);
  } else {
    alias.toName = null;
    alias.toNode = null;
    alias.toNameDecoded = null;
  }
  alias.active = hasTarget;
  alias.blockNumber = event.block.number;
  alias.transactionID = event.transaction.hash;
  alias.logIndex = event.logIndex;
  alias.save();
}

// idSuffix is a fixed-width Bytes tag distinguishing kind + any extra key
// material (fix plan Phase 5 Decision 1) — see each caller below for how
// it's built. Concatenated after a 32-byte resource, no delimiter needed:
// NAME's suffix (4 bytes) can never collide with TEXT/DATA/ADDR's (36
// bytes, and each starts with its own distinct 4-byte kind tag).
function saveNamedResource(
  resolver: ENSv2Resolver,
  idSuffix: Bytes,
  resource: BigInt,
  name: Bytes,
  kind: string,
  key: string | null,
  keyHash: Bytes | null,
  coinType: BigInt | null,
  event: ethereum.Event
): void {
  let id = Bytes.fromByteArray(
    concat(concat(resolver.id, uint256ToByteArray(resource)), idSuffix)
  );
  let entity = ENSv2ResolverResource.load(id);
  if (entity == null) {
    entity = new ENSv2ResolverResource(id);
    entity.resolver = resolver.id;
    entity.resource = resource;
  }
  entity.node = namehashFromDnsEncoded(name);
  entity.name = name;
  entity.nameDecoded = decodedNameOf(name);
  entity.kind = kind;
  if (key !== null) {
    entity.key = key as string;
  }
  if (keyHash !== null) {
    entity.keyHash = keyHash as Bytes;
  }
  if (coinType !== null) {
    entity.coinType = coinType as BigInt;
  }
  entity.active = true;
  entity.blockNumber = event.block.number;
  entity.transactionID = event.transaction.hash;
  entity.logIndex = event.logIndex;
  entity.save();
}

export function handleNamedResource(event: NamedResource): void {
  let resolver = getOrCreateResolver(event.address);
  saveNamedResource(
    resolver,
    Bytes.fromUTF8("NAME"),
    event.params.resource,
    event.params.name,
    "NAME",
    null,
    null,
    null,
    event
  );
}

// NamedTextResource/NamedDataResource share an identical event shape
// (resource, name, keyHash, key) — one internal helper, thin wrapper
// exports (docs/plan.md Phase 7 Decision 5). AssemblyScript has no union
// types, so the helper takes primitives rather than either event class.
function handleNamedKeyedResource(
  resolverAddress: Address,
  resource: BigInt,
  name: Bytes,
  keyHash: Bytes,
  key: string,
  kind: string,
  event: ethereum.Event
): void {
  let resolver = getOrCreateResolver(resolverAddress);
  // kind is always exactly 4 ASCII chars ("TEXT"/"DATA"), keyHash always 32
  // bytes — fixed-width, no delimiter needed.
  let idSuffix = Bytes.fromByteArray(concat(Bytes.fromUTF8(kind), keyHash));
  saveNamedResource(
    resolver,
    idSuffix,
    resource,
    name,
    kind,
    key,
    keyHash,
    null,
    event
  );
}

export function handleNamedTextResource(event: NamedTextResource): void {
  handleNamedKeyedResource(
    event.address,
    event.params.resource,
    event.params.name,
    event.params.keyHash,
    event.params.key,
    "TEXT",
    event
  );
}

export function handleNamedDataResource(event: NamedDataResource): void {
  handleNamedKeyedResource(
    event.address,
    event.params.resource,
    event.params.name,
    event.params.keyHash,
    event.params.key,
    "DATA",
    event
  );
}

export function handleNamedAddrResource(event: NamedAddrResource): void {
  let resolver = getOrCreateResolver(event.address);
  // "ADDR" (4 bytes) + coinType as a 32-byte big-endian value — fixed-width.
  let idSuffix = Bytes.fromByteArray(
    concat(Bytes.fromUTF8("ADDR"), uint256ToByteArray(event.params.coinType))
  );
  saveNamedResource(
    resolver,
    idSuffix,
    event.params.resource,
    event.params.name,
    "ADDR",
    null,
    null,
    event.params.coinType,
    event
  );
}

export function handleDataChanged(event: DataChanged): void {
  let resolver = getOrCreateResolver(event.address);
  // key is arbitrary-length user-supplied text, not safe to concatenate raw
  // (fix plan Phase 5 Decision 2) — hash it first, same as its sibling
  // TEXT/DATA resource ids already do via the ABI's own keyHash param.
  let keyHash = Bytes.fromByteArray(crypto.keccak256(Bytes.fromUTF8(event.params.key)));
  let id = Bytes.fromByteArray(
    concat(concat(resolver.id, event.params.node), keyHash)
  );

  let data = ENSv2ResolverData.load(id);
  if (data == null) {
    data = new ENSv2ResolverData(id);
    data.resolver = resolver.id;
    data.node = event.params.node;
    data.key = event.params.key;
  }
  // value can never be populated from this event: the real signature is
  // DataChanged(bytes32 indexed node, string indexed indexedKey, string key,
  // bytes indexed indexedData) — the actual data bytes are only logged as
  // an indexed parameter (indexedData), so only its keccak256 hash reaches
  // the log, never the raw bytes. Not an implementation gap — a hard ABI
  // constraint (docs/plan.md Phase 7 Decision 3).
  data.blockNumber = event.block.number;
  data.transactionID = event.transaction.hash;
  data.logIndex = event.logIndex;
  data.save();
}

export function handleEACRolesChanged(event: EACRolesChanged): void {
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
