import { Address, BigInt, Bytes, ethereum } from "@graphprotocol/graph-ts";
import {
  afterEach,
  assert,
  clearStore,
  dataSourceMock,
  newMockEvent,
  test,
} from "matchstick-as/assembly/index";
import {
  handleExpiryUpdated,
  handleLabelRegistered,
  handleLabelReserved,
  handleLabelUnregistered,
  handleTokenRegenerated,
  handleTokenResource,
  handleTransferBatch,
  handleTransferSingle,
} from "../src/ensv2Registry";
import {
  ExpiryUpdated,
  LabelRegistered,
  LabelReserved,
  LabelUnregistered,
  TokenRegenerated,
  TokenResource,
  TransferBatch,
  TransferSingle,
} from "../src/types/RootRegistry/PermissionedRegistry";
import { ENSv2Resource } from "../src/types/schema";

const ROOT_REGISTRY = "0xc960F7217d3643B525Ef36Bec8Adf86953CD9aB8";
const ETH_REGISTRY = "0xDEDB92913A25abE1f7BCDD85D8A344a43B398B67";
const OWNER = "0x89205A3A3b2A69De6Dbf7f01ED13B2108B2c43e7";
const SENDER = "0x11111111111111111111111111111111111111aa";
const ROOT_NAMEHASH =
  "0x0000000000000000000000000000000000000000000000000000000000000000";

// toSlotId(tokenId) zeroes the low 32 bits of tokenId (see
// src/ensv2Utils.ts), which collapses any tokenId under 2^32 to slot 0 —
// real labelhash-derived tokenIds are far larger, so tests below use a
// distinct registry address per scenario (rather than distinct tokenIds) to
// keep ENSv2NameSlot rows from colliding across independent test cases.
const REGISTRY_FRESH_REGISTRATION = "0x44444444444444444444444444444444444444dd";
const REGISTRY_RESERVATION = "0x55555555555555555555555555555555555555dd";
const REGISTRY_UNREGISTRATION = "0x66666666666666666666666666666666666666dd";
const REGISTRY_RENEWAL = "0x77777777777777777777777777777777777777dd";
const REGISTRY_REREGISTRATION = "0x88888888888888888888888888888888888888dd";
const REGISTRY_TOKEN_RESOURCE = "0x99999999999999999999999999999999999999ee";
const REGISTRY_MINT_BEFORE_RESOURCE = "0xaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaee";
const REGISTRY_REGENERATION = "0xbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbee";
const REGISTRY_TRANSFER_BATCH = "0xccccccccccccccccccccccccccccccccccccccee";
const REGISTRY_RESOURCE_CROSS_CHECK = "0xddddddddddddddddddddddddddddddddddddddee";
const OWNER_2 = "0xF0205A3A3b2A69De6Dbf7f01ED13B2108B2c4321";

const createLabelRegisteredEvent = (
  registryAddress: string,
  tokenId: BigInt,
  label: string
): LabelRegistered => {
  let mockEvent = newMockEvent();
  let event = new LabelRegistered(
    Address.fromString(registryAddress),
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
      "tokenId",
      ethereum.Value.fromUnsignedBigInt(tokenId)
    )
  );
  event.parameters.push(
    new ethereum.EventParam(
      "labelHash",
      ethereum.Value.fromFixedBytes(Bytes.fromI32(1))
    )
  );
  event.parameters.push(
    new ethereum.EventParam("label", ethereum.Value.fromString(label))
  );
  event.parameters.push(
    new ethereum.EventParam(
      "owner",
      ethereum.Value.fromAddress(Address.fromString(OWNER))
    )
  );
  event.parameters.push(
    new ethereum.EventParam(
      "expiry",
      ethereum.Value.fromUnsignedBigInt(BigInt.fromI32(2000000000))
    )
  );
  event.parameters.push(
    new ethereum.EventParam(
      "sender",
      ethereum.Value.fromAddress(Address.fromString(SENDER))
    )
  );
  return event;
};

const createLabelReservedEvent = (
  registryAddress: string,
  tokenId: BigInt,
  label: string
): LabelReserved => {
  let mockEvent = newMockEvent();
  let event = new LabelReserved(
    Address.fromString(registryAddress),
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
      "tokenId",
      ethereum.Value.fromUnsignedBigInt(tokenId)
    )
  );
  event.parameters.push(
    new ethereum.EventParam(
      "labelHash",
      ethereum.Value.fromFixedBytes(Bytes.fromI32(1))
    )
  );
  event.parameters.push(
    new ethereum.EventParam("label", ethereum.Value.fromString(label))
  );
  event.parameters.push(
    new ethereum.EventParam(
      "expiry",
      ethereum.Value.fromUnsignedBigInt(BigInt.fromI32(2000000000))
    )
  );
  event.parameters.push(
    new ethereum.EventParam(
      "sender",
      ethereum.Value.fromAddress(Address.fromString(SENDER))
    )
  );
  return event;
};

const createLabelUnregisteredEvent = (
  registryAddress: string,
  tokenId: BigInt
): LabelUnregistered => {
  let mockEvent = newMockEvent();
  let event = new LabelUnregistered(
    Address.fromString(registryAddress),
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
      "tokenId",
      ethereum.Value.fromUnsignedBigInt(tokenId)
    )
  );
  event.parameters.push(
    new ethereum.EventParam(
      "sender",
      ethereum.Value.fromAddress(Address.fromString(SENDER))
    )
  );
  return event;
};

const createExpiryUpdatedEvent = (
  registryAddress: string,
  tokenId: BigInt,
  newExpiry: BigInt
): ExpiryUpdated => {
  let mockEvent = newMockEvent();
  let event = new ExpiryUpdated(
    Address.fromString(registryAddress),
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
      "tokenId",
      ethereum.Value.fromUnsignedBigInt(tokenId)
    )
  );
  event.parameters.push(
    new ethereum.EventParam(
      "newExpiry",
      ethereum.Value.fromUnsignedBigInt(newExpiry)
    )
  );
  event.parameters.push(
    new ethereum.EventParam(
      "sender",
      ethereum.Value.fromAddress(Address.fromString(SENDER))
    )
  );
  return event;
};

const createTokenResourceEvent = (
  registryAddress: string,
  tokenId: BigInt,
  resource: BigInt
): TokenResource => {
  let mockEvent = newMockEvent();
  let event = new TokenResource(
    Address.fromString(registryAddress),
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
      "tokenId",
      ethereum.Value.fromUnsignedBigInt(tokenId)
    )
  );
  event.parameters.push(
    new ethereum.EventParam(
      "resource",
      ethereum.Value.fromUnsignedBigInt(resource)
    )
  );
  return event;
};

const createTokenRegeneratedEvent = (
  registryAddress: string,
  oldTokenId: BigInt,
  newTokenId: BigInt
): TokenRegenerated => {
  let mockEvent = newMockEvent();
  let event = new TokenRegenerated(
    Address.fromString(registryAddress),
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
      "oldTokenId",
      ethereum.Value.fromUnsignedBigInt(oldTokenId)
    )
  );
  event.parameters.push(
    new ethereum.EventParam(
      "newTokenId",
      ethereum.Value.fromUnsignedBigInt(newTokenId)
    )
  );
  return event;
};

const createTransferSingleEvent = (
  registryAddress: string,
  tokenId: BigInt,
  from: string,
  to: string
): TransferSingle => {
  let mockEvent = newMockEvent();
  let event = new TransferSingle(
    Address.fromString(registryAddress),
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
      "operator",
      ethereum.Value.fromAddress(Address.fromString(from))
    )
  );
  event.parameters.push(
    new ethereum.EventParam(
      "from",
      ethereum.Value.fromAddress(Address.fromString(from))
    )
  );
  event.parameters.push(
    new ethereum.EventParam(
      "to",
      ethereum.Value.fromAddress(Address.fromString(to))
    )
  );
  event.parameters.push(
    new ethereum.EventParam(
      "id",
      ethereum.Value.fromUnsignedBigInt(tokenId)
    )
  );
  event.parameters.push(
    new ethereum.EventParam(
      "value",
      ethereum.Value.fromUnsignedBigInt(BigInt.fromI32(1))
    )
  );
  return event;
};

const createTransferBatchEvent = (
  registryAddress: string,
  tokenIds: Array<BigInt>,
  from: string,
  to: string
): TransferBatch => {
  let mockEvent = newMockEvent();
  let event = new TransferBatch(
    Address.fromString(registryAddress),
    mockEvent.logIndex,
    mockEvent.transactionLogIndex,
    mockEvent.logType,
    mockEvent.block,
    mockEvent.transaction,
    mockEvent.parameters,
    mockEvent.receipt
  );

  let valueOnes = new Array<BigInt>();
  for (let i = 0; i < tokenIds.length; i++) {
    valueOnes.push(BigInt.fromI32(1));
  }

  event.parameters = new Array();
  event.parameters.push(
    new ethereum.EventParam(
      "operator",
      ethereum.Value.fromAddress(Address.fromString(from))
    )
  );
  event.parameters.push(
    new ethereum.EventParam(
      "from",
      ethereum.Value.fromAddress(Address.fromString(from))
    )
  );
  event.parameters.push(
    new ethereum.EventParam(
      "to",
      ethereum.Value.fromAddress(Address.fromString(to))
    )
  );
  event.parameters.push(
    new ethereum.EventParam(
      "ids",
      ethereum.Value.fromUnsignedBigIntArray(tokenIds)
    )
  );
  event.parameters.push(
    new ethereum.EventParam(
      "values",
      ethereum.Value.fromUnsignedBigIntArray(valueOnes)
    )
  );
  return event;
};

afterEach(() => {
  dataSourceMock.resetValues();
  clearStore();
});

// assert.fieldEquals compares an entity's id as its lowercase-hex string
// form regardless of the underlying GraphQL type (fix plan Phase 5).
// Production code now builds these ids as fixed-width Bytes concatenation
// with no delimiter: addresses are 20 bytes, a BigInt component is a
// 32-byte big-endian value (src/utils.ts::uint256ToByteArray), a small loop
// index is a 4-byte big-endian value (src/utils.ts::i32ToBytes) — these
// mirror that exact encoding to reproduce the same hex strings.
function bigIntHex32(i: BigInt): string {
  return i.toHex().slice(2).padStart(64, "0");
}
function i32Hex4(i: i32): string {
  return bigIntHex32(BigInt.fromI32(i)).slice(56);
}

test("RootRegistry event bootstraps ENSv2Registry(kind=ROOT) and the root ENSv2Namespace", () => {
  dataSourceMock.setNetwork("sepolia");

  let event = createLabelRegisteredEvent(
    ROOT_REGISTRY,
    BigInt.fromI32(1),
    "eth"
  );
  handleLabelRegistered(event);

  let registryId = Address.fromString(ROOT_REGISTRY).toHexString();
  assert.fieldEquals("ENSv2Registry", registryId, "kind", "ROOT");
  assert.fieldEquals("ENSv2Registry", registryId, "namespaceCount", "1");

  let namespaceId = registryId.concat(ROOT_NAMEHASH.slice(2));
  // baseName is deliberately never assigned for root (see
  // src/ensv2Discovery.ts::getOrCreateRootNamespace) — the generated
  // nullable-String setter treats "" as falsy and unsets the field anyway,
  // so leaving it untouched is equivalent and matchstick has no stored
  // field to assert on either way.
  assert.fieldEquals(
    "ENSv2Namespace",
    namespaceId,
    "baseNamehash",
    ROOT_NAMEHASH
  );
  assert.fieldEquals("ENSv2Namespace", namespaceId, "registry", registryId);
});

test("ETHRegistry event bootstraps ENSv2Registry(kind=ETH) without a root namespace", () => {
  dataSourceMock.setNetwork("sepolia");

  let event = createLabelRegisteredEvent(
    ETH_REGISTRY,
    BigInt.fromI32(1),
    "vitalik"
  );
  handleLabelRegistered(event);

  let registryId = Address.fromString(ETH_REGISTRY).toHexString();
  assert.fieldEquals("ENSv2Registry", registryId, "kind", "ETH");
  assert.fieldEquals("ENSv2Registry", registryId, "namespaceCount", "0");

  let namespaceId = registryId.concat(ROOT_NAMEHASH.slice(2));
  assert.notInStore("ENSv2Namespace", namespaceId);
});

test("an address that isn't RootRegistry or ETHRegistry bootstraps kind=UNKNOWN", () => {
  dataSourceMock.setNetwork("sepolia");

  const OTHER_REGISTRY = "0x33333333333333333333333333333333333333cc";
  let event = createLabelRegisteredEvent(
    OTHER_REGISTRY,
    BigInt.fromI32(1),
    "sub"
  );
  handleLabelRegistered(event);

  let registryId = Address.fromString(OTHER_REGISTRY).toHexString();
  assert.fieldEquals("ENSv2Registry", registryId, "kind", "UNKNOWN");
});

test("fresh registration populates ENSv2NameSlot and creates ENSv2LabelRegistered history", () => {
  dataSourceMock.setNetwork("sepolia");

  let registryId = Address.fromString(REGISTRY_FRESH_REGISTRATION).toHexString();
  let event = createLabelRegisteredEvent(
    REGISTRY_FRESH_REGISTRATION,
    BigInt.fromI32(1),
    "alice"
  );
  handleLabelRegistered(event);

  let slotId = registryId.concat(bigIntHex32(BigInt.zero()));
  assert.fieldEquals("ENSv2NameSlot", slotId, "status", "REGISTERED");
  assert.fieldEquals("ENSv2NameSlot", slotId, "label", "alice");
  assert.fieldEquals("ENSv2NameSlot", slotId, "expiryDate", "2000000000");
  let ownerId = Address.fromString(OWNER).toHexString();
  assert.fieldEquals("ENSv2NameSlot", slotId, "owner", ownerId);
  assert.fieldEquals("ENSv2NameSlot", slotId, "registrant", ownerId);
  assert.fieldEquals("ENSv2NameSlot", slotId, "migratedFromV1", "false");

  let historyId = "0x".concat(bigIntHex32(event.block.number)).concat(bigIntHex32(event.logIndex));
  assert.fieldEquals("ENSv2LabelRegistered", historyId, "slot", slotId);
  assert.fieldEquals("ENSv2LabelRegistered", historyId, "isReRegistration", "false");
  assert.fieldEquals(
    "ENSv2LabelRegistered",
    historyId,
    "sender",
    Address.fromString(SENDER).toHexString()
  );
});

test("reservation sets status RESERVED and creates no history entity", () => {
  dataSourceMock.setNetwork("sepolia");

  let registryId = Address.fromString(REGISTRY_RESERVATION).toHexString();
  let event = createLabelReservedEvent(
    REGISTRY_RESERVATION,
    BigInt.fromI32(1),
    "reserved-name"
  );
  handleLabelReserved(event);

  let slotId = registryId.concat(bigIntHex32(BigInt.zero()));
  assert.fieldEquals("ENSv2NameSlot", slotId, "status", "RESERVED");
  assert.fieldEquals("ENSv2NameSlot", slotId, "expiryDate", "2000000000");

  let historyId = "0x".concat(bigIntHex32(event.block.number)).concat(bigIntHex32(event.logIndex));
  assert.notInStore("ENSv2LabelRegistered", historyId);
});

test("unregistration flips status to AVAILABLE, keeps stale fields, records history, never deletes the slot", () => {
  dataSourceMock.setNetwork("sepolia");

  let registryId = Address.fromString(REGISTRY_UNREGISTRATION).toHexString();
  let tokenId = BigInt.fromI32(1);
  let registerEvent = createLabelRegisteredEvent(
    REGISTRY_UNREGISTRATION,
    tokenId,
    "bob"
  );
  handleLabelRegistered(registerEvent);

  let unregisterEvent = createLabelUnregisteredEvent(
    REGISTRY_UNREGISTRATION,
    tokenId
  );
  handleLabelUnregistered(unregisterEvent);

  let slotId = registryId.concat(bigIntHex32(BigInt.zero()));
  assert.fieldEquals("ENSv2NameSlot", slotId, "status", "AVAILABLE");
  // stale fields from the registration are left as last-known values, not
  // nulled (docs/plan.md Phase 2 Decision 4)
  assert.fieldEquals("ENSv2NameSlot", slotId, "label", "bob");
  assert.fieldEquals(
    "ENSv2NameSlot",
    slotId,
    "owner",
    Address.fromString(OWNER).toHexString()
  );

  let historyId = "0x".concat(bigIntHex32(unregisterEvent.block.number)).concat(bigIntHex32(unregisterEvent.logIndex));
  assert.fieldEquals("ENSv2LabelUnregistered", historyId, "slot", slotId);
});

test("renewal (ExpiryUpdated) updates expiryDate and creates ENSv2LabelRenewed", () => {
  dataSourceMock.setNetwork("sepolia");

  let registryId = Address.fromString(REGISTRY_RENEWAL).toHexString();
  let tokenId = BigInt.fromI32(1);
  let registerEvent = createLabelRegisteredEvent(
    REGISTRY_RENEWAL,
    tokenId,
    "carol"
  );
  handleLabelRegistered(registerEvent);

  let newExpiry = BigInt.fromI32(2100000000);
  let renewEvent = createExpiryUpdatedEvent(REGISTRY_RENEWAL, tokenId, newExpiry);
  handleExpiryUpdated(renewEvent);

  let slotId = registryId.concat(bigIntHex32(BigInt.zero()));
  assert.fieldEquals("ENSv2NameSlot", slotId, "expiryDate", "2100000000");

  let historyId = "0x".concat(bigIntHex32(renewEvent.block.number)).concat(bigIntHex32(renewEvent.logIndex));
  assert.fieldEquals("ENSv2LabelRenewed", historyId, "slot", slotId);
  assert.fieldEquals("ENSv2LabelRenewed", historyId, "newExpiryDate", "2100000000");
});

test("re-registration after unregistration reuses the same slot and sets isReRegistration=true", () => {
  dataSourceMock.setNetwork("sepolia");

  let registryId = Address.fromString(REGISTRY_REREGISTRATION).toHexString();
  let tokenId = BigInt.fromI32(1);

  handleLabelRegistered(
    createLabelRegisteredEvent(REGISTRY_REREGISTRATION, tokenId, "dave")
  );
  handleLabelUnregistered(
    createLabelUnregisteredEvent(REGISTRY_REREGISTRATION, tokenId)
  );
  let secondRegisterEvent = createLabelRegisteredEvent(
    REGISTRY_REREGISTRATION,
    tokenId,
    "dave-again"
  );
  handleLabelRegistered(secondRegisterEvent);

  // Same ID is reused by construction (load-or-create on a deterministic
  // id) — proving the second event's fields landed on that same row is
  // enough to show reuse, no separate collision-prone count check needed.
  let slotId = registryId.concat(bigIntHex32(BigInt.zero()));
  assert.fieldEquals("ENSv2NameSlot", slotId, "status", "REGISTERED");
  assert.fieldEquals("ENSv2NameSlot", slotId, "label", "dave-again");

  let historyId = "0x".concat(bigIntHex32(secondRegisterEvent.block.number)).concat(bigIntHex32(secondRegisterEvent.logIndex));
  assert.fieldEquals("ENSv2LabelRegistered", historyId, "isReRegistration", "true");
});

test("TokenResource after registration links slot/resource/token", () => {
  dataSourceMock.setNetwork("sepolia");

  let registryId = Address.fromString(REGISTRY_TOKEN_RESOURCE).toHexString();
  let tokenId = BigInt.fromI32(1);
  handleLabelRegistered(
    createLabelRegisteredEvent(REGISTRY_TOKEN_RESOURCE, tokenId, "erin")
  );

  let resource = BigInt.fromI32(555);
  handleTokenResource(
    createTokenResourceEvent(REGISTRY_TOKEN_RESOURCE, tokenId, resource)
  );

  let slotId = registryId.concat(bigIntHex32(BigInt.zero()));
  let resourceEntityId = registryId.concat(bigIntHex32(resource));
  let tokenEntityId = registryId.concat(bigIntHex32(tokenId));

  assert.fieldEquals("ENSv2NameSlot", slotId, "currentResource", resourceEntityId);
  assert.fieldEquals("ENSv2NameSlot", slotId, "currentToken", tokenEntityId);
  assert.fieldEquals("ENSv2Resource", resourceEntityId, "slot", slotId);
  assert.fieldEquals("ENSv2Resource", resourceEntityId, "currentToken", tokenEntityId);
  assert.fieldEquals("ENSv2Token", tokenEntityId, "resourceEntity", resourceEntityId);
  assert.fieldEquals("ENSv2Token", tokenEntityId, "slot", slotId);
});

test("mint before TokenResource reconciles: token row exists without history, then resolves", () => {
  dataSourceMock.setNetwork("sepolia");

  let registryId = Address.fromString(REGISTRY_MINT_BEFORE_RESOURCE).toHexString();
  let tokenId = BigInt.fromI32(1);
  let tokenEntityId = registryId.concat(bigIntHex32(tokenId));

  // No LabelRegistered/TokenResource yet — a fresh mint's TransferSingle
  // arrives first.
  let mintEvent = createTransferSingleEvent(
    REGISTRY_MINT_BEFORE_RESOURCE,
    tokenId,
    "0x0000000000000000000000000000000000000000",
    OWNER
  );
  handleTransferSingle(mintEvent);

  assert.fieldEquals(
    "ENSv2Token",
    tokenEntityId,
    "owner",
    Address.fromString(OWNER).toHexString()
  );
  let mintHistoryId = "0x".concat(bigIntHex32(mintEvent.block.number)).concat(bigIntHex32(mintEvent.logIndex)).concat(i32Hex4(0));
  assert.notInStore("ENSv2TokenTransferred", mintHistoryId);

  // Registration + TokenResource now resolve the slot.
  handleLabelRegistered(
    createLabelRegisteredEvent(REGISTRY_MINT_BEFORE_RESOURCE, tokenId, "frank")
  );
  handleTokenResource(
    createTokenResourceEvent(
      REGISTRY_MINT_BEFORE_RESOURCE,
      tokenId,
      BigInt.fromI32(777)
    )
  );

  let slotId = registryId.concat(bigIntHex32(BigInt.zero()));
  assert.fieldEquals("ENSv2Token", tokenEntityId, "slot", slotId);

  // A subsequent transfer now gets a proper history row.
  let secondTransfer = createTransferSingleEvent(
    REGISTRY_MINT_BEFORE_RESOURCE,
    tokenId,
    OWNER,
    OWNER_2
  );
  handleTransferSingle(secondTransfer);

  let secondHistoryId = "0x".concat(bigIntHex32(secondTransfer.block.number)).concat(bigIntHex32(secondTransfer.logIndex)).concat(i32Hex4(0));
  assert.fieldEquals("ENSv2TokenTransferred", secondHistoryId, "slot", slotId);
  assert.fieldEquals(
    "ENSv2NameSlot",
    slotId,
    "owner",
    Address.fromString(OWNER_2).toHexString()
  );
});

test("regeneration clones slot/resource onto the new token and deactivates the old one", () => {
  dataSourceMock.setNetwork("sepolia");

  let registryId = Address.fromString(REGISTRY_REGENERATION).toHexString();
  let oldTokenId = BigInt.fromI32(1);
  let newTokenId = BigInt.fromI32(2);

  handleLabelRegistered(
    createLabelRegisteredEvent(REGISTRY_REGENERATION, oldTokenId, "grace")
  );
  handleTokenResource(
    createTokenResourceEvent(
      REGISTRY_REGENERATION,
      oldTokenId,
      BigInt.fromI32(888)
    )
  );

  let regenEvent = createTokenRegeneratedEvent(
    REGISTRY_REGENERATION,
    oldTokenId,
    newTokenId
  );
  handleTokenRegenerated(regenEvent);

  let slotId = registryId.concat(bigIntHex32(BigInt.zero()));
  let oldTokenEntityId = registryId.concat(bigIntHex32(oldTokenId));
  let newTokenEntityId = registryId.concat(bigIntHex32(newTokenId));
  let resourceEntityId = registryId.concat(bigIntHex32(BigInt.fromI32(888)));

  // Cloned onto the new token with zero TokenResource calls for it.
  assert.fieldEquals("ENSv2Token", newTokenEntityId, "slot", slotId);
  assert.fieldEquals("ENSv2Token", newTokenEntityId, "resourceEntity", resourceEntityId);
  assert.fieldEquals("ENSv2Token", newTokenEntityId, "active", "true");
  assert.fieldEquals("ENSv2Token", oldTokenEntityId, "active", "false");
  assert.fieldEquals("ENSv2NameSlot", slotId, "currentToken", newTokenEntityId);
  assert.fieldEquals("ENSv2Resource", resourceEntityId, "currentToken", newTokenEntityId);

  let historyId = "0x".concat(bigIntHex32(regenEvent.block.number)).concat(bigIntHex32(regenEvent.logIndex));
  assert.fieldEquals("ENSv2TokenRegenerated", historyId, "oldTokenId", oldTokenId.toString());
  assert.fieldEquals("ENSv2TokenRegenerated", historyId, "newTokenId", newTokenId.toString());
});

test("TransferBatch updates all token rows and writes one history row per id", () => {
  dataSourceMock.setNetwork("sepolia");

  let registryId = Address.fromString(REGISTRY_TRANSFER_BATCH).toHexString();
  // Distinct low-32-bit values so each id maps to a distinct slot within
  // this one registry (unlike the other tests, this scenario needs several
  // slots at once).
  let tokenIdA = BigInt.fromI32(101);
  let tokenIdB = BigInt.fromI32(202);

  handleLabelRegistered(
    createLabelRegisteredEvent(REGISTRY_TRANSFER_BATCH, tokenIdA, "henry")
  );
  handleTokenResource(
    createTokenResourceEvent(REGISTRY_TRANSFER_BATCH, tokenIdA, BigInt.fromI32(1001))
  );
  handleLabelRegistered(
    createLabelRegisteredEvent(REGISTRY_TRANSFER_BATCH, tokenIdB, "iris")
  );
  handleTokenResource(
    createTokenResourceEvent(REGISTRY_TRANSFER_BATCH, tokenIdB, BigInt.fromI32(1002))
  );

  let batchEvent = createTransferBatchEvent(
    REGISTRY_TRANSFER_BATCH,
    [tokenIdA, tokenIdB],
    OWNER,
    OWNER_2
  );
  handleTransferBatch(batchEvent);

  let tokenEntityIdA = registryId.concat(bigIntHex32(tokenIdA));
  let tokenEntityIdB = registryId.concat(bigIntHex32(tokenIdB));
  assert.fieldEquals(
    "ENSv2Token",
    tokenEntityIdA,
    "owner",
    Address.fromString(OWNER_2).toHexString()
  );
  assert.fieldEquals(
    "ENSv2Token",
    tokenEntityIdB,
    "owner",
    Address.fromString(OWNER_2).toHexString()
  );

  let baseHistoryId = "0x".concat(bigIntHex32(batchEvent.block.number)).concat(bigIntHex32(batchEvent.logIndex));
  assert.fieldEquals("ENSv2TokenTransferred", baseHistoryId.concat(i32Hex4(0)), "tokenId", tokenIdA.toString());
  assert.fieldEquals("ENSv2TokenTransferred", baseHistoryId.concat(i32Hex4(1)), "tokenId", tokenIdB.toString());
});

test("cross-check with Phase 2: unregister -> re-register produces a new resource incarnation, old one kept but inactive", () => {
  dataSourceMock.setNetwork("sepolia");

  let registryId = Address.fromString(REGISTRY_RESOURCE_CROSS_CHECK).toHexString();
  let tokenId = BigInt.fromI32(1);

  handleLabelRegistered(
    createLabelRegisteredEvent(REGISTRY_RESOURCE_CROSS_CHECK, tokenId, "jack")
  );
  let resourceA = BigInt.fromI32(1);
  handleTokenResource(
    createTokenResourceEvent(REGISTRY_RESOURCE_CROSS_CHECK, tokenId, resourceA)
  );

  handleLabelUnregistered(
    createLabelUnregisteredEvent(REGISTRY_RESOURCE_CROSS_CHECK, tokenId)
  );
  handleLabelRegistered(
    createLabelRegisteredEvent(REGISTRY_RESOURCE_CROSS_CHECK, tokenId, "jack-again")
  );
  let resourceB = BigInt.fromI32(2);
  handleTokenResource(
    createTokenResourceEvent(REGISTRY_RESOURCE_CROSS_CHECK, tokenId, resourceB)
  );

  let slotId = registryId.concat(bigIntHex32(BigInt.zero()));
  let resourceEntityIdA = registryId.concat(bigIntHex32(resourceA));
  let resourceEntityIdB = registryId.concat(bigIntHex32(resourceB));

  assert.fieldEquals("ENSv2NameSlot", slotId, "currentResource", resourceEntityIdB);
  // Old resource still exists (never deleted) but is superseded.
  assert.fieldEquals("ENSv2Resource", resourceEntityIdA, "active", "false");
  let oldResource = ENSv2Resource.load(Bytes.fromHexString(resourceEntityIdA));
  let hasEndedAt = false;
  if (oldResource != null) {
    if (oldResource.endedAt) {
      hasEndedAt = true;
    }
  }
  assert.assertTrue(hasEndedAt);
});
