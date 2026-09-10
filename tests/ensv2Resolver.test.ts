import { Address, BigInt, Bytes, crypto, ethereum } from "@graphprotocol/graph-ts";
import {
  afterEach,
  assert,
  clearStore,
  newMockEvent,
  test,
} from "matchstick-as/assembly/index";
import {
  handleAliasChanged,
  handleDataChanged,
  handleNamedAddrResource,
  handleNamedDataResource,
  handleNamedResource,
  handleNamedTextResource,
  namehashFromDnsEncoded,
} from "../src/ensv2Resolver";
import { createResolverID, handleAddrChanged } from "../src/resolver";
import {
  AliasChanged,
  DataChanged,
  NamedAddrResource,
  NamedDataResource,
  NamedResource,
  NamedTextResource,
} from "../src/types/PermissionedResolver/PermissionedResolver";
import { AddrChanged } from "../src/types/Resolver/Resolver";
import { ENSv2ResolverData, Resolver } from "../src/types/schema";

const PERMISSIONED_RESOLVER = "0x11111111111111111111111111111111111111aa";

// DNS-wire-format encode a single-label name, e.g. "alice" ->
// 0x05616c696365 00 (length-prefixed label + zero-length root terminator).
function encodeLabel(label: string): Bytes {
  let labelBytes = Bytes.fromUTF8(label);
  let out = new Uint8Array(labelBytes.length + 2);
  out[0] = labelBytes.length as u8;
  for (let i = 0; i < labelBytes.length; i++) {
    out[i + 1] = labelBytes[i];
  }
  out[labelBytes.length + 1] = 0;
  return Bytes.fromUint8Array(out);
}

const createAliasChangedEvent = (
  fromName: Bytes,
  toName: Bytes
): AliasChanged => {
  let mockEvent = newMockEvent();
  let event = new AliasChanged(
    Address.fromString(PERMISSIONED_RESOLVER),
    mockEvent.logIndex,
    mockEvent.transactionLogIndex,
    mockEvent.logType,
    mockEvent.block,
    mockEvent.transaction,
    mockEvent.parameters,
    mockEvent.receipt
  );
  event.parameters = new Array();
  event.parameters.push(
    new ethereum.EventParam(
      "indexedFromName",
      ethereum.Value.fromBytes(Bytes.fromByteArray(crypto.keccak256(fromName)))
    )
  );
  event.parameters.push(
    new ethereum.EventParam(
      "indexedToName",
      ethereum.Value.fromBytes(Bytes.fromByteArray(crypto.keccak256(toName)))
    )
  );
  event.parameters.push(
    new ethereum.EventParam("fromName", ethereum.Value.fromBytes(fromName))
  );
  event.parameters.push(
    new ethereum.EventParam("toName", ethereum.Value.fromBytes(toName))
  );
  return event;
};

const createNamedResourceEvent = (
  resource: BigInt,
  name: Bytes
): NamedResource => {
  let mockEvent = newMockEvent();
  let event = new NamedResource(
    Address.fromString(PERMISSIONED_RESOLVER),
    mockEvent.logIndex,
    mockEvent.transactionLogIndex,
    mockEvent.logType,
    mockEvent.block,
    mockEvent.transaction,
    mockEvent.parameters,
    mockEvent.receipt
  );
  event.parameters = new Array();
  event.parameters.push(
    new ethereum.EventParam(
      "resource",
      ethereum.Value.fromUnsignedBigInt(resource)
    )
  );
  event.parameters.push(
    new ethereum.EventParam("name", ethereum.Value.fromBytes(name))
  );
  return event;
};

const createNamedTextResourceEvent = (
  resource: BigInt,
  name: Bytes,
  keyHash: Bytes,
  key: string
): NamedTextResource => {
  let mockEvent = newMockEvent();
  let event = new NamedTextResource(
    Address.fromString(PERMISSIONED_RESOLVER),
    mockEvent.logIndex,
    mockEvent.transactionLogIndex,
    mockEvent.logType,
    mockEvent.block,
    mockEvent.transaction,
    mockEvent.parameters,
    mockEvent.receipt
  );
  event.parameters = new Array();
  event.parameters.push(
    new ethereum.EventParam(
      "resource",
      ethereum.Value.fromUnsignedBigInt(resource)
    )
  );
  event.parameters.push(
    new ethereum.EventParam("name", ethereum.Value.fromBytes(name))
  );
  event.parameters.push(
    new ethereum.EventParam("keyHash", ethereum.Value.fromFixedBytes(keyHash))
  );
  event.parameters.push(
    new ethereum.EventParam("key", ethereum.Value.fromString(key))
  );
  return event;
};

const createNamedDataResourceEvent = (
  resource: BigInt,
  name: Bytes,
  keyHash: Bytes,
  key: string
): NamedDataResource => {
  let mockEvent = newMockEvent();
  let event = new NamedDataResource(
    Address.fromString(PERMISSIONED_RESOLVER),
    mockEvent.logIndex,
    mockEvent.transactionLogIndex,
    mockEvent.logType,
    mockEvent.block,
    mockEvent.transaction,
    mockEvent.parameters,
    mockEvent.receipt
  );
  event.parameters = new Array();
  event.parameters.push(
    new ethereum.EventParam(
      "resource",
      ethereum.Value.fromUnsignedBigInt(resource)
    )
  );
  event.parameters.push(
    new ethereum.EventParam("name", ethereum.Value.fromBytes(name))
  );
  event.parameters.push(
    new ethereum.EventParam("keyHash", ethereum.Value.fromFixedBytes(keyHash))
  );
  event.parameters.push(
    new ethereum.EventParam("key", ethereum.Value.fromString(key))
  );
  return event;
};

const createNamedAddrResourceEvent = (
  resource: BigInt,
  name: Bytes,
  coinType: BigInt
): NamedAddrResource => {
  let mockEvent = newMockEvent();
  let event = new NamedAddrResource(
    Address.fromString(PERMISSIONED_RESOLVER),
    mockEvent.logIndex,
    mockEvent.transactionLogIndex,
    mockEvent.logType,
    mockEvent.block,
    mockEvent.transaction,
    mockEvent.parameters,
    mockEvent.receipt
  );
  event.parameters = new Array();
  event.parameters.push(
    new ethereum.EventParam(
      "resource",
      ethereum.Value.fromUnsignedBigInt(resource)
    )
  );
  event.parameters.push(
    new ethereum.EventParam("name", ethereum.Value.fromBytes(name))
  );
  event.parameters.push(
    new ethereum.EventParam(
      "coinType",
      ethereum.Value.fromUnsignedBigInt(coinType)
    )
  );
  return event;
};

const createDataChangedEvent = (
  node: Bytes,
  key: string
): DataChanged => {
  let mockEvent = newMockEvent();
  let event = new DataChanged(
    Address.fromString(PERMISSIONED_RESOLVER),
    mockEvent.logIndex,
    mockEvent.transactionLogIndex,
    mockEvent.logType,
    mockEvent.block,
    mockEvent.transaction,
    mockEvent.parameters,
    mockEvent.receipt
  );
  event.parameters = new Array();
  event.parameters.push(
    new ethereum.EventParam("node", ethereum.Value.fromFixedBytes(node))
  );
  event.parameters.push(
    new ethereum.EventParam(
      "indexedKey",
      ethereum.Value.fromBytes(Bytes.fromUTF8(key))
    )
  );
  event.parameters.push(
    new ethereum.EventParam("key", ethereum.Value.fromString(key))
  );
  event.parameters.push(
    new ethereum.EventParam(
      "indexedData",
      ethereum.Value.fromBytes(Bytes.fromUTF8("somevalue"))
    )
  );
  return event;
};

afterEach(() => {
  clearStore();
});

// assert.fieldEquals compares an entity's id as its lowercase-hex string
// form regardless of the underlying GraphQL type (fix plan Phase 5).
// Production code now builds these ids as fixed-width Bytes concatenation
// with no delimiter (a BigInt component is a 32-byte big-endian value,
// src/utils.ts::uint256ToByteArray) — these mirror that exact encoding, and
// hexOf mirrors Bytes.fromUTF8(kindTag).toHexString() for the fixed 4-byte
// "NAME"/"TEXT"/"DATA"/"ADDR" kind tags.
function bigIntHex32(i: BigInt): string {
  return i.toHex().slice(2).padStart(64, "0");
}
function hexOf(b: Bytes): string {
  return b.toHexString().slice(2);
}

test("AliasChanged set produces ENSv2ResolverAlias, clearing (empty toName) deactivates without deleting", () => {
  let fromName = encodeLabel("alice");
  let toName = encodeLabel("bob");
  let resolverId = Address.fromString(PERMISSIONED_RESOLVER).toHexString();
  let id = resolverId.concat(hexOf(namehashFromDnsEncoded(fromName)));

  handleAliasChanged(createAliasChangedEvent(fromName, toName));

  assert.fieldEquals("ENSv2ResolverAlias", id, "active", "true");
  assert.fieldEquals("ENSv2ResolverAlias", id, "fromNameDecoded", "alice");
  assert.fieldEquals("ENSv2ResolverAlias", id, "toNameDecoded", "bob");

  handleAliasChanged(createAliasChangedEvent(fromName, Bytes.fromUint8Array(new Uint8Array(0))));

  assert.fieldEquals("ENSv2ResolverAlias", id, "active", "false");
  // Row still exists, not deleted.
  assert.fieldEquals("ENSv2ResolverAlias", id, "fromNameDecoded", "alice");
});

test("NamedResource produces ENSv2ResolverResource with kind NAME", () => {
  let resource = BigInt.fromI32(1);
  let name = encodeLabel("carol");
  let resolverId = Address.fromString(PERMISSIONED_RESOLVER).toHexString();
  let id = resolverId.concat(bigIntHex32(resource)).concat(hexOf(Bytes.fromUTF8("NAME")));

  handleNamedResource(createNamedResourceEvent(resource, name));

  assert.fieldEquals("ENSv2ResolverResource", id, "kind", "NAME");
  assert.fieldEquals("ENSv2ResolverResource", id, "nameDecoded", "carol");
});

test("NamedTextResource and NamedDataResource on the same resource with different keyHashes produce two distinct rows", () => {
  let resource = BigInt.fromI32(2);
  let name = encodeLabel("dave");
  let textKeyHash = Bytes.fromI32(1);
  let dataKeyHash = Bytes.fromI32(2);
  let resolverId = Address.fromString(PERMISSIONED_RESOLVER).toHexString();
  let textId = resolverId
    .concat(bigIntHex32(resource))
    .concat(hexOf(Bytes.fromUTF8("TEXT")))
    .concat(hexOf(textKeyHash));
  let dataId = resolverId
    .concat(bigIntHex32(resource))
    .concat(hexOf(Bytes.fromUTF8("DATA")))
    .concat(hexOf(dataKeyHash));

  handleNamedTextResource(
    createNamedTextResourceEvent(resource, name, textKeyHash, "avatar")
  );
  handleNamedDataResource(
    createNamedDataResourceEvent(resource, name, dataKeyHash, "pubkey")
  );

  assert.fieldEquals("ENSv2ResolverResource", textId, "kind", "TEXT");
  assert.fieldEquals("ENSv2ResolverResource", textId, "key", "avatar");
  assert.fieldEquals("ENSv2ResolverResource", dataId, "kind", "DATA");
  assert.fieldEquals("ENSv2ResolverResource", dataId, "key", "pubkey");
});

test("NamedAddrResource for two coinTypes on the same resource produces two distinct rows", () => {
  let resource = BigInt.fromI32(3);
  let name = encodeLabel("erin");
  let resolverId = Address.fromString(PERMISSIONED_RESOLVER).toHexString();
  let ethCoinType = BigInt.fromI32(60);
  let btcCoinType = BigInt.fromI32(0);
  let ethId = resolverId
    .concat(bigIntHex32(resource))
    .concat(hexOf(Bytes.fromUTF8("ADDR")))
    .concat(bigIntHex32(ethCoinType));
  let btcId = resolverId
    .concat(bigIntHex32(resource))
    .concat(hexOf(Bytes.fromUTF8("ADDR")))
    .concat(bigIntHex32(btcCoinType));

  handleNamedAddrResource(
    createNamedAddrResourceEvent(resource, name, ethCoinType)
  );
  handleNamedAddrResource(
    createNamedAddrResourceEvent(resource, name, btcCoinType)
  );

  assert.fieldEquals("ENSv2ResolverResource", ethId, "coinType", "60");
  assert.fieldEquals("ENSv2ResolverResource", btcId, "coinType", "0");
});

test("DataChanged produces ENSv2ResolverData with node/key set", () => {
  let node = Bytes.fromI32(9);
  let resolverId = Address.fromString(PERMISSIONED_RESOLVER).toHexString();
  let keyHash = Bytes.fromByteArray(crypto.keccak256(Bytes.fromUTF8("mykey")));
  let id = resolverId.concat(hexOf(node)).concat(hexOf(keyHash));

  handleDataChanged(createDataChangedEvent(node, "mykey"));

  assert.fieldEquals("ENSv2ResolverData", id, "key", "mykey");
  let entity = ENSv2ResolverData.load(Bytes.fromHexString(id));
  assert.assertTrue(entity != null);
});

test("a standard ENSIP event fired from a PermissionedResolver-style address is still processed by the existing addressless Resolver source", () => {
  let node = Bytes.fromHexString(
    "0x7857c9824139b8a8c3cb04712b41558b4878c55fa9c1e5390e910ee3220c3cce"
  );
  let permissionedResolverAddress = Address.fromString(PERMISSIONED_RESOLVER);

  let mockEvent = newMockEvent();
  let event = new AddrChanged(
    permissionedResolverAddress,
    mockEvent.logIndex,
    mockEvent.transactionLogIndex,
    mockEvent.logType,
    mockEvent.block,
    mockEvent.transaction,
    mockEvent.parameters,
    mockEvent.receipt
  );
  event.parameters = new Array();
  event.parameters.push(
    new ethereum.EventParam("node", ethereum.Value.fromFixedBytes(node))
  );
  event.parameters.push(
    new ethereum.EventParam(
      "a",
      ethereum.Value.fromAddress(
        Address.fromString("0x8e8db5ccef88cca9d624701db544989c996e3211")
      )
    )
  );

  let resolverId = createResolverID(node, permissionedResolverAddress);
  assert.assertNull(Resolver.load(resolverId));

  handleAddrChanged(event);

  assert.assertNotNull(Resolver.load(resolverId));
});

test("none of this phase's handlers ever create a Domain row", () => {
  let resource = BigInt.fromI32(4);
  let name = encodeLabel("frank");
  handleNamedResource(createNamedResourceEvent(resource, name));
  handleAliasChanged(createAliasChangedEvent(encodeLabel("grace"), encodeLabel("henry")));
  handleDataChanged(createDataChangedEvent(Bytes.fromI32(10), "somekey"));

  // No Domain entity of any kind exists in the store after any of the above.
  assert.entityCount("Domain", 0);
});
