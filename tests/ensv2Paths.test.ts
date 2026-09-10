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
  handleLabelRegistered,
  handleLabelUnregistered,
  handleResolverUpdated,
  handleSubregistryUpdated,
} from "../src/ensv2Registry";
import { namespaceId, pathNamehash } from "../src/ensv2Utils";
import { ENSv2NameSlot } from "../src/types/schema";
import {
  LabelRegistered,
  LabelUnregistered,
  ResolverUpdated,
  SubregistryUpdated,
} from "../src/types/RootRegistry/PermissionedRegistry";

const ROOT_REGISTRY = "0x8115186e8f2e0B0281E86Ab91f0f48Ba90364354";
const ETH_REGISTRY = "0xbDC85dD5b15D7ECb354Cd7cb6f2C50B4f2C4f0e2";
const OWNER = "0x89205A3A3b2A69De6Dbf7f01ED13B2108B2c43e7";
const OWNER_2 = "0xF0205A3A3b2A69De6Dbf7f01ED13B2108B2c4321";
const SENDER = "0x11111111111111111111111111111111111111aa";
const ROOT_NAMEHASH =
  "0x0000000000000000000000000000000000000000000000000000000000000000";

// TWO_POW_32: toSlotId zeroes the low 32 bits of a tokenId (src/ensv2Utils.ts),
// so an exact multiple of 2^32 survives toSlotId unchanged and distinct
// multiples give distinct slots within one registry — used below instead of
// small sequential tokenIds (which would all collapse to slot 0).
const TWO_POW_32 = BigInt.fromI64(4294967296);

function slotToken(n: i32): BigInt {
  return TWO_POW_32.times(BigInt.fromI32(n));
}

// assert.fieldEquals compares an entity's id as its lowercase-hex string
// form regardless of the underlying GraphQL type (fix plan Phase 5).
// Production code now builds composite ids as fixed-width Bytes
// concatenation with no delimiter (a BigInt component is a 32-byte
// big-endian value, src/utils.ts::uint256ToByteArray) — this mirrors that
// exact encoding to reproduce the same hex string.
function bigIntHex32(i: BigInt): string {
  return i.toHex().slice(2).padStart(64, "0");
}

function slotIdFor(registryAddress: string, n: i32): string {
  return Address.fromString(registryAddress)
    .toHexString()
    .concat(bigIntHex32(slotToken(n)));
}

function slotExists(id: string): boolean {
  let slot = ENSv2NameSlot.load(Bytes.fromHexString(id));
  let exists = slot != null;
  return exists;
}

const createLabelRegisteredEvent = (
  registryAddress: string,
  tokenId: BigInt,
  labelHash: Bytes,
  label: string,
  owner: string = OWNER
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
      ethereum.Value.fromFixedBytes(labelHash)
    )
  );
  event.parameters.push(
    new ethereum.EventParam("label", ethereum.Value.fromString(label))
  );
  event.parameters.push(
    new ethereum.EventParam(
      "owner",
      ethereum.Value.fromAddress(Address.fromString(owner))
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

const createSubregistryUpdatedEvent = (
  registryAddress: string,
  tokenId: BigInt,
  subregistry: string
): SubregistryUpdated => {
  let mockEvent = newMockEvent();
  let event = new SubregistryUpdated(
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
      "subregistry",
      ethereum.Value.fromAddress(Address.fromString(subregistry))
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

const createResolverUpdatedEvent = (
  registryAddress: string,
  tokenId: BigInt,
  resolver: string
): ResolverUpdated => {
  let mockEvent = newMockEvent();
  let event = new ResolverUpdated(
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
      "resolver",
      ethereum.Value.fromAddress(Address.fromString(resolver))
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

afterEach(() => {
  dataSourceMock.resetValues();
  clearStore();
});

test("3-level nested registration produces correct name/namehash/depth chain", () => {
  dataSourceMock.setNetwork("sepolia");

  const USER_REGISTRY_A = "0x121234567890123456789012345678901234abcd";

  // eth (RootRegistry, depth 0)
  handleLabelRegistered(
    createLabelRegisteredEvent(
      ROOT_REGISTRY,
      slotToken(1),
      Bytes.fromI32(1),
      "eth"
    )
  );
  let ethPathId = pathNamehash(
    Bytes.fromHexString(ROOT_NAMEHASH),
    Bytes.fromI32(1)
  ).toHexString();
  assert.fieldEquals("ENSv2NamePath", ethPathId, "name", "eth");
  assert.fieldEquals("ENSv2NamePath", ethPathId, "depth", "0");

  // link RootRegistry's "eth" slot -> ETHRegistry
  handleSubregistryUpdated(
    createSubregistryUpdatedEvent(ROOT_REGISTRY, slotToken(1), ETH_REGISTRY)
  );

  // base (ETHRegistry, depth 1)
  handleLabelRegistered(
    createLabelRegisteredEvent(
      ETH_REGISTRY,
      slotToken(1),
      Bytes.fromI32(2),
      "base"
    )
  );
  let basePathId = pathNamehash(
    Bytes.fromHexString(ethPathId),
    Bytes.fromI32(2)
  ).toHexString();
  assert.fieldEquals("ENSv2NamePath", basePathId, "name", "base.eth");
  assert.fieldEquals("ENSv2NamePath", basePathId, "depth", "1");
  assert.fieldEquals("ENSv2NamePath", basePathId, "parent", ethPathId);

  // link ETHRegistry's "base" slot -> USER_REGISTRY_A
  handleSubregistryUpdated(
    createSubregistryUpdatedEvent(ETH_REGISTRY, slotToken(1), USER_REGISTRY_A)
  );

  // buildersdao (USER_REGISTRY_A, depth 2)
  handleLabelRegistered(
    createLabelRegisteredEvent(
      USER_REGISTRY_A,
      slotToken(1),
      Bytes.fromI32(3),
      "buildersdao"
    )
  );
  let buildersdaoPathId = pathNamehash(
    Bytes.fromHexString(basePathId),
    Bytes.fromI32(3)
  ).toHexString();
  assert.fieldEquals(
    "ENSv2NamePath",
    buildersdaoPathId,
    "name",
    "buildersdao.base.eth"
  );
  assert.fieldEquals("ENSv2NamePath", buildersdaoPathId, "depth", "2");
  assert.fieldEquals("ENSv2NamePath", buildersdaoPathId, "parent", basePathId);

  // ETHRegistry should have been classified ETH even though it was first
  // referenced via SubregistryUpdated (as a child), not its own event.
  let ethRegistryId = Address.fromString(ETH_REGISTRY).toHexString();
  assert.fieldEquals("ENSv2Registry", ethRegistryId, "kind", "ETH");
});

test("shared subregistry linked under two parents produces two distinct path rows for one slot", () => {
  dataSourceMock.setNetwork("sepolia");

  const CHILD_REGISTRY = "0x222222222222222222222222222222222222222b";

  handleLabelRegistered(
    createLabelRegisteredEvent(
      ROOT_REGISTRY,
      slotToken(1),
      Bytes.fromI32(11),
      "one"
    )
  );
  handleLabelRegistered(
    createLabelRegisteredEvent(
      ROOT_REGISTRY,
      slotToken(2),
      Bytes.fromI32(12),
      "two"
    )
  );

  handleSubregistryUpdated(
    createSubregistryUpdatedEvent(ROOT_REGISTRY, slotToken(1), CHILD_REGISTRY)
  );
  handleSubregistryUpdated(
    createSubregistryUpdatedEvent(ROOT_REGISTRY, slotToken(2), CHILD_REGISTRY)
  );

  let childRegistryId = Address.fromString(CHILD_REGISTRY).toHexString();
  assert.fieldEquals("ENSv2Registry", childRegistryId, "namespaceCount", "2");

  handleLabelRegistered(
    createLabelRegisteredEvent(
      CHILD_REGISTRY,
      slotToken(1),
      Bytes.fromI32(20),
      "wallet"
    )
  );

  let onePathId = pathNamehash(
    Bytes.fromHexString(ROOT_NAMEHASH),
    Bytes.fromI32(11)
  ).toHexString();
  let twoPathId = pathNamehash(
    Bytes.fromHexString(ROOT_NAMEHASH),
    Bytes.fromI32(12)
  ).toHexString();
  let walletUnderOne = pathNamehash(
    Bytes.fromHexString(onePathId),
    Bytes.fromI32(20)
  ).toHexString();
  let walletUnderTwo = pathNamehash(
    Bytes.fromHexString(twoPathId),
    Bytes.fromI32(20)
  ).toHexString();

  assert.fieldEquals("ENSv2NamePath", walletUnderOne, "name", "wallet.one");
  assert.fieldEquals("ENSv2NamePath", walletUnderTwo, "name", "wallet.two");

  let walletSlotId = slotIdFor(CHILD_REGISTRY, 1);
  assert.fieldEquals("ENSv2NameSlot", walletSlotId, "pathCount", "2");
});

test("late-link: pre-existing child registrations get zero new path rows and pathCount stays untouched", () => {
  dataSourceMock.setNetwork("sepolia");

  const LATE_CHILD_REGISTRY = "0x333333333333333333333333333333333333333c";

  // "wallet" registered in LATE_CHILD_REGISTRY before it is linked anywhere.
  handleLabelRegistered(
    createLabelRegisteredEvent(
      LATE_CHILD_REGISTRY,
      slotToken(1),
      Bytes.fromI32(30),
      "wallet"
    )
  );
  let walletSlotId = slotIdFor(LATE_CHILD_REGISTRY, 1);
  assert.fieldEquals("ENSv2NameSlot", walletSlotId, "pathCount", "0");

  // RootRegistry's own "late" registration is the only path materialised so
  // far (root always has an active root namespace) — snapshot that count.
  handleLabelRegistered(
    createLabelRegisteredEvent(
      ROOT_REGISTRY,
      slotToken(1),
      Bytes.fromI32(31),
      "late"
    )
  );
  assert.entityCount("ENSv2SlotPathIndex", 1); // just "late" under root

  // Now late-link LATE_CHILD_REGISTRY under root's "late" slot.
  handleSubregistryUpdated(
    createSubregistryUpdatedEvent(
      ROOT_REGISTRY,
      slotToken(1),
      LATE_CHILD_REGISTRY
    )
  );

  let lateChildRegistryId = Address.fromString(
    LATE_CHILD_REGISTRY
  ).toHexString();
  assert.fieldEquals(
    "ENSv2Registry",
    lateChildRegistryId,
    "namespaceCount",
    "1"
  );

  // The single most important assertion in this plan: no new path row for
  // the pre-existing "wallet" registration, and the index entity count is
  // an unchanged upper bound, not just "the specific expected row is
  // absent" (the original plan's explicit acceptance criterion for this test).
  assert.fieldEquals("ENSv2NameSlot", walletSlotId, "pathCount", "0");
  assert.entityCount("ENSv2SlotPathIndex", 1);
});

test("unregister -> re-register does not inflate pathCount", () => {
  dataSourceMock.setNetwork("sepolia");

  handleLabelRegistered(
    createLabelRegisteredEvent(
      ROOT_REGISTRY,
      slotToken(1),
      Bytes.fromI32(40),
      "reuse"
    )
  );
  let slotId = slotIdFor(ROOT_REGISTRY, 1);
  assert.fieldEquals("ENSv2NameSlot", slotId, "pathCount", "1");

  handleLabelUnregistered(
    createLabelUnregisteredEvent(ROOT_REGISTRY, slotToken(1))
  );
  handleLabelRegistered(
    createLabelRegisteredEvent(
      ROOT_REGISTRY,
      slotToken(1),
      Bytes.fromI32(40),
      "reuse"
    )
  );

  assert.fieldEquals("ENSv2NameSlot", slotId, "pathCount", "1");
});

test("handleResolverUpdated creates ENSv2Resolver and links/clears slot.resolver", () => {
  dataSourceMock.setNetwork("sepolia");

  const RESOLVER_ADDRESS = "0x444444444444444444444444444444444444444d";
  const ZERO_ADDRESS = "0x0000000000000000000000000000000000000000";

  handleLabelRegistered(
    createLabelRegisteredEvent(
      ROOT_REGISTRY,
      slotToken(1),
      Bytes.fromI32(50),
      "res"
    )
  );
  let slotId = slotIdFor(ROOT_REGISTRY, 1);

  handleResolverUpdated(
    createResolverUpdatedEvent(ROOT_REGISTRY, slotToken(1), RESOLVER_ADDRESS)
  );

  let resolverId = Address.fromString(RESOLVER_ADDRESS).toHexString();
  assert.fieldEquals("ENSv2Resolver", resolverId, "address", resolverId);
  assert.fieldEquals("ENSv2NameSlot", slotId, "resolver", resolverId);
  assert.fieldEquals("ENSv2NameSlot", slotId, "resolverAddress", resolverId);

  // Clearing — slot is never deleted, only the resolver fields go null.
  handleResolverUpdated(
    createResolverUpdatedEvent(ROOT_REGISTRY, slotToken(1), ZERO_ADDRESS)
  );
  assert.assertTrue(slotExists(slotId));
});

test("SubregistryUpdated(..., address(0)) clears the link and deactivates (not deletes) the namespace it produced", () => {
  dataSourceMock.setNetwork("sepolia");

  const CLEAR_CHILD_REGISTRY = "0x555555555555555555555555555555555555555e";
  const ZERO_ADDRESS = "0x0000000000000000000000000000000000000000";

  handleLabelRegistered(
    createLabelRegisteredEvent(
      ROOT_REGISTRY,
      slotToken(1),
      Bytes.fromI32(60),
      "clearme"
    )
  );
  handleSubregistryUpdated(
    createSubregistryUpdatedEvent(
      ROOT_REGISTRY,
      slotToken(1),
      CLEAR_CHILD_REGISTRY
    )
  );

  let clearPathId = pathNamehash(
    Bytes.fromHexString(ROOT_NAMEHASH),
    Bytes.fromI32(60)
  ).toHexString();
  let namespaceEntityId = namespaceId(
    Address.fromString(CLEAR_CHILD_REGISTRY),
    Bytes.fromHexString(clearPathId)
  ).toHexString();
  assert.fieldEquals("ENSv2Namespace", namespaceEntityId, "active", "true");

  let rootSlotId = slotIdFor(ROOT_REGISTRY, 1);

  handleSubregistryUpdated(
    createSubregistryUpdatedEvent(ROOT_REGISTRY, slotToken(1), ZERO_ADDRESS)
  );

  assert.assertTrue(slotExists(rootSlotId));
  assert.fieldEquals("ENSv2Namespace", namespaceEntityId, "active", "false");
});

test("fresh non-.eth registration produces a queryable Domain row with correct parent chain", () => {
  dataSourceMock.setNetwork("sepolia");

  const CHILD_REGISTRY = "0x666666666666666666666666666666666666666f";

  handleLabelRegistered(
    createLabelRegisteredEvent(
      ROOT_REGISTRY,
      slotToken(1),
      Bytes.fromI32(70),
      "alpha"
    )
  );
  let alphaPathId = pathNamehash(
    Bytes.fromHexString(ROOT_NAMEHASH),
    Bytes.fromI32(70)
  ).toHexString();
  assert.fieldEquals("Domain", alphaPathId, "name", "alpha");
  assert.fieldEquals(
    "Domain",
    alphaPathId,
    "owner",
    Address.fromString(OWNER).toHexString()
  );

  handleSubregistryUpdated(
    createSubregistryUpdatedEvent(ROOT_REGISTRY, slotToken(1), CHILD_REGISTRY)
  );
  handleLabelRegistered(
    createLabelRegisteredEvent(
      CHILD_REGISTRY,
      slotToken(1),
      Bytes.fromI32(71),
      "beta"
    )
  );
  let betaPathId = pathNamehash(
    Bytes.fromHexString(alphaPathId),
    Bytes.fromI32(71)
  ).toHexString();

  assert.fieldEquals("Domain", betaPathId, "name", "beta.alpha");
  assert.fieldEquals("Domain", betaPathId, "parent", alphaPathId);
  // Non-.eth: no legacy Registration row, and no grace-period addition —
  // Domain.expiryDate is the slot's raw expiry.
  assert.fieldEquals("Domain", betaPathId, "expiryDate", "2000000000");
  assert.notInStore("Registration", Bytes.fromI32(71).toHexString());
});

test("fresh .eth registration produces Domain + Registration sharing the legacy labelhash ID, with the grace-period split applied only to Domain", () => {
  dataSourceMock.setNetwork("sepolia");

  // ETHRegistry must first be linked under root's "eth" slot — its own
  // namespaceCount is 0 (and materializePathsForSlot a no-op) until then.
  handleLabelRegistered(
    createLabelRegisteredEvent(
      ROOT_REGISTRY,
      slotToken(1),
      Bytes.fromI32(79),
      "eth"
    )
  );
  handleSubregistryUpdated(
    createSubregistryUpdatedEvent(ROOT_REGISTRY, slotToken(1), ETH_REGISTRY)
  );
  let ethPathId = pathNamehash(
    Bytes.fromHexString(ROOT_NAMEHASH),
    Bytes.fromI32(79)
  ).toHexString();

  let labelHash = Bytes.fromI32(80);
  handleLabelRegistered(
    createLabelRegisteredEvent(
      ETH_REGISTRY,
      slotToken(1),
      labelHash,
      "vitalik"
    )
  );

  let pathId = pathNamehash(Bytes.fromHexString(ethPathId), labelHash)
    .toHexString();
  let registrationId = labelHash.toHexString();

  assert.fieldEquals("Domain", pathId, "name", "vitalik.eth");
  assert.fieldEquals("Registration", registrationId, "domain", pathId);
  assert.fieldEquals(
    "Registration",
    registrationId,
    "expiryDate",
    "2000000000"
  );
  // v2GracePeriod is 2,419,200s (28 days) per src/ensv2Constants.ts.
  assert.fieldEquals("Domain", pathId, "expiryDate", "2002419200");
});

test("late-linked path has no Domain row", () => {
  dataSourceMock.setNetwork("sepolia");

  const LATE_CHILD_REGISTRY = "0x777777777777777777777777777777777777777a";

  handleLabelRegistered(
    createLabelRegisteredEvent(
      LATE_CHILD_REGISTRY,
      slotToken(1),
      Bytes.fromI32(90),
      "orphan"
    )
  );
  handleLabelRegistered(
    createLabelRegisteredEvent(
      ROOT_REGISTRY,
      slotToken(1),
      Bytes.fromI32(91),
      "late2"
    )
  );
  handleSubregistryUpdated(
    createSubregistryUpdatedEvent(
      ROOT_REGISTRY,
      slotToken(1),
      LATE_CHILD_REGISTRY
    )
  );

  let late2PathId = pathNamehash(
    Bytes.fromHexString(ROOT_NAMEHASH),
    Bytes.fromI32(91)
  ).toHexString();
  let wouldBeOrphanPathId = pathNamehash(
    Bytes.fromHexString(late2PathId),
    Bytes.fromI32(90)
  ).toHexString();

  assert.notInStore("Domain", wouldBeOrphanPathId);
});

test("re-registration on the same slot updates the existing Domain row's owner", () => {
  dataSourceMock.setNetwork("sepolia");

  handleLabelRegistered(
    createLabelRegisteredEvent(
      ROOT_REGISTRY,
      slotToken(1),
      Bytes.fromI32(100),
      "changeling",
      OWNER
    )
  );
  let pathId = pathNamehash(
    Bytes.fromHexString(ROOT_NAMEHASH),
    Bytes.fromI32(100)
  ).toHexString();
  assert.fieldEquals(
    "Domain",
    pathId,
    "owner",
    Address.fromString(OWNER).toHexString()
  );

  handleLabelUnregistered(
    createLabelUnregisteredEvent(ROOT_REGISTRY, slotToken(1))
  );
  handleLabelRegistered(
    createLabelRegisteredEvent(
      ROOT_REGISTRY,
      slotToken(1),
      Bytes.fromI32(100),
      "changeling",
      OWNER_2
    )
  );

  assert.fieldEquals(
    "Domain",
    pathId,
    "owner",
    Address.fromString(OWNER_2).toHexString()
  );
});
