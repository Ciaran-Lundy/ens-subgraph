import { Address, BigInt, Bytes, ethereum } from "@graphprotocol/graph-ts";
import {
  assert,
  beforeAll,
  describe,
  newMockEvent,
  test,
} from "matchstick-as/assembly/index";
import {
  handleExpiryExtended,
  handleFusesSet,
  handleNameUnwrapped,
  handleTransferBatch,
  handleTransferSingle,
} from "../src/nameWrapper";
import {
  ExpiryExtended,
  FusesSet,
  NameUnwrapped,
  TransferBatch,
  TransferSingle,
} from "../src/types/NameWrapper/NameWrapper";
import { Domain, WrappedDomain } from "../src/types/schema";
import { concat, createEventID, ETH_NODE, i32ToBytes } from "../src/utils";
import { DEFAULT_OWNER, setEthOwner } from "./testUtils";

beforeAll(() => {
  setEthOwner();
});

const NAME_WRAPPER_ADDRESS = "0xD4416b13d2b3a9aBae7AcD5D6C2BbDBE25686401";
// test.eth
const testEthNamehash =
  "0xeb4f647bea6caa36333c816d7b46fdcb05f9466ecacc140ea8c66faf15b3d9f1";

const createNameUnwrappedEvent = (
  node: string,
  owner: string
): NameUnwrapped => {
  let mockEvent = newMockEvent();
  let newNameUnwrappedEvent = new NameUnwrapped(
    mockEvent.address,
    mockEvent.logIndex,
    mockEvent.transactionLogIndex,
    mockEvent.logType,
    mockEvent.block,
    mockEvent.transaction,
    mockEvent.parameters,
    mockEvent.receipt
  );
  newNameUnwrappedEvent.parameters = new Array();
  let nodeParam = new ethereum.EventParam(
    "node",
    ethereum.Value.fromBytes(Bytes.fromHexString(node))
  );
  let ownerParam = new ethereum.EventParam(
    "owner",
    ethereum.Value.fromAddress(Address.fromString(owner))
  );
  newNameUnwrappedEvent.parameters.push(nodeParam);
  newNameUnwrappedEvent.parameters.push(ownerParam);
  return newNameUnwrappedEvent;
};

describe("handleNameUnwrapped", () => {
  test("does not set expiryDate to null if name is .eth", () => {
    // test
    const labelhash =
      "0x9c22ff5f21f0b81b113e63f7db6da94fedef11b2119b4088b89664fb9a3cb658";

    let domain = new Domain(Bytes.fromHexString(testEthNamehash));
    domain.name = "test.eth";
    domain.labelName = "test";
    domain.labelhash = Bytes.fromHexString(labelhash);
    domain.parent = ETH_NODE;
    domain.subdomainCount = 0;
    domain.isMigrated = true;
    domain.createdAt = BigInt.fromI32(0);
    domain.owner = Bytes.fromHexString(NAME_WRAPPER_ADDRESS);
    domain.registrant = Bytes.fromHexString(NAME_WRAPPER_ADDRESS);
    domain.wrappedOwner = Bytes.fromHexString(DEFAULT_OWNER);
    domain.expiryDate = BigInt.fromI32(123456789);
    domain.save();

    const wrappedDomain = new WrappedDomain(Bytes.fromHexString(testEthNamehash));
    wrappedDomain.domain = Bytes.fromHexString(testEthNamehash);
    wrappedDomain.expiryDate = BigInt.fromI32(123456789);
    wrappedDomain.fuses = 0;
    wrappedDomain.owner = Bytes.fromHexString(DEFAULT_OWNER);
    wrappedDomain.name = "test.eth";
    wrappedDomain.save();

    const nameUnwrappedEvent = createNameUnwrappedEvent(
      testEthNamehash,
      DEFAULT_OWNER
    );

    handleNameUnwrapped(nameUnwrappedEvent);

    assert.fieldEquals("Domain", testEthNamehash, "expiryDate", "123456789");
  });
  test("sets expiryDate to null if name is not .eth", () => {
    // cool.test.eth
    const subNamehash =
      "0x85c47d906feeeed4795f21773ab20983af35e85837d2de39549f650c8fb50c0f";
    // cool
    const labelhash =
      "0x678c189fde5058554d934d6af17e41750fa2a94b61371c5ea958a7595e146324";

    let domain = new Domain(Bytes.fromHexString(subNamehash));
    domain.name = "cool.test.eth";
    domain.labelName = "cool";
    domain.labelhash = Bytes.fromHexString(labelhash);
    domain.parent = Bytes.fromHexString(testEthNamehash);
    domain.subdomainCount = 0;
    domain.isMigrated = true;
    domain.createdAt = BigInt.fromI32(0);
    domain.owner = Bytes.fromHexString(NAME_WRAPPER_ADDRESS);
    domain.registrant = Bytes.fromHexString(NAME_WRAPPER_ADDRESS);
    domain.wrappedOwner = Bytes.fromHexString(DEFAULT_OWNER);
    domain.expiryDate = BigInt.fromI32(123456789);
    domain.save();

    const wrappedDomain = new WrappedDomain(Bytes.fromHexString(subNamehash));
    wrappedDomain.domain = Bytes.fromHexString(subNamehash);
    wrappedDomain.expiryDate = BigInt.fromI32(123456789);
    wrappedDomain.fuses = 0;
    wrappedDomain.owner = Bytes.fromHexString(DEFAULT_OWNER);
    wrappedDomain.name = "test.eth";
    wrappedDomain.save();

    const nameUnwrappedEvent = createNameUnwrappedEvent(
      subNamehash,
      DEFAULT_OWNER
    );

    handleNameUnwrapped(nameUnwrappedEvent);

    assert.fieldEquals("Domain", subNamehash, "expiryDate", "null");
  });
});

const createFusesSetEvent = (node: string, fuses: i32): FusesSet => {
  let mockEvent = newMockEvent();
  let event = new FusesSet(
    mockEvent.address,
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
    new ethereum.EventParam("node", ethereum.Value.fromFixedBytes(Bytes.fromHexString(node)))
  );
  event.parameters.push(
    new ethereum.EventParam("fuses", ethereum.Value.fromUnsignedBigInt(BigInt.fromI32(fuses)))
  );
  return event;
};

const createExpiryExtendedEvent = (node: string, expiry: BigInt): ExpiryExtended => {
  let mockEvent = newMockEvent();
  let event = new ExpiryExtended(
    mockEvent.address,
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
    new ethereum.EventParam("node", ethereum.Value.fromFixedBytes(Bytes.fromHexString(node)))
  );
  event.parameters.push(
    new ethereum.EventParam("expiry", ethereum.Value.fromUnsignedBigInt(expiry))
  );
  return event;
};

const createTransferSingleEvent = (
  from: string,
  to: string,
  id: BigInt
): TransferSingle => {
  let mockEvent = newMockEvent();
  let event = new TransferSingle(
    mockEvent.address,
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
    new ethereum.EventParam("operator", ethereum.Value.fromAddress(Address.fromString(from)))
  );
  event.parameters.push(
    new ethereum.EventParam("from", ethereum.Value.fromAddress(Address.fromString(from)))
  );
  event.parameters.push(
    new ethereum.EventParam("to", ethereum.Value.fromAddress(Address.fromString(to)))
  );
  event.parameters.push(
    new ethereum.EventParam("id", ethereum.Value.fromUnsignedBigInt(id))
  );
  event.parameters.push(
    new ethereum.EventParam("value", ethereum.Value.fromUnsignedBigInt(BigInt.fromI32(1)))
  );
  return event;
};

const createTransferBatchEvent = (
  from: string,
  to: string,
  ids: Array<BigInt>
): TransferBatch => {
  let mockEvent = newMockEvent();
  let event = new TransferBatch(
    mockEvent.address,
    mockEvent.logIndex,
    mockEvent.transactionLogIndex,
    mockEvent.logType,
    mockEvent.block,
    mockEvent.transaction,
    mockEvent.parameters,
    mockEvent.receipt
  );
  let values = new Array<BigInt>();
  for (let i = 0; i < ids.length; i++) {
    values.push(BigInt.fromI32(1));
  }
  event.parameters = new Array();
  event.parameters.push(
    new ethereum.EventParam("operator", ethereum.Value.fromAddress(Address.fromString(from)))
  );
  event.parameters.push(
    new ethereum.EventParam("from", ethereum.Value.fromAddress(Address.fromString(from)))
  );
  event.parameters.push(
    new ethereum.EventParam("to", ethereum.Value.fromAddress(Address.fromString(to)))
  );
  event.parameters.push(
    new ethereum.EventParam("ids", ethereum.Value.fromUnsignedBigIntArray(ids))
  );
  event.parameters.push(
    new ethereum.EventParam("values", ethereum.Value.fromUnsignedBigIntArray(values))
  );
  return event;
};

// Matches nameWrapper.ts::checkPccBurned's own constant.
const PARENT_CANNOT_CONTROL: i32 = 65536;

describe("handleFusesSet", () => {
  test("writes history but touches no Domain when no WrappedDomain exists yet", () => {
    const node =
      "0x1111111111111111111111111111111111111111111111111111111111111111";
    const event = createFusesSetEvent(node, 1);
    handleFusesSet(event);

    assert.notInStore("WrappedDomain", node);
    assert.notInStore("Domain", node);

    let eventId = createEventID(event).toHexString();
    assert.fieldEquals("FusesSet", eventId, "domain", node);
    assert.fieldEquals("FusesSet", eventId, "fuses", "1");
  });

  test("bumps Domain.expiryDate to match once PARENT_CANNOT_CONTROL is burned", () => {
    const node =
      "0x2222222222222222222222222222222222222222222222222222222222222222";
    let nodeBytes = Bytes.fromHexString(node);

    let domain = new Domain(nodeBytes);
    domain.owner = Bytes.fromHexString(DEFAULT_OWNER);
    domain.isMigrated = true;
    domain.subdomainCount = 0;
    domain.createdAt = BigInt.fromI32(0);
    domain.expiryDate = BigInt.fromI32(100);
    domain.save();

    let wrappedDomain = new WrappedDomain(nodeBytes);
    wrappedDomain.domain = nodeBytes;
    wrappedDomain.expiryDate = BigInt.fromI32(500);
    wrappedDomain.fuses = 0;
    wrappedDomain.owner = Bytes.fromHexString(DEFAULT_OWNER);
    wrappedDomain.save();

    const event = createFusesSetEvent(node, PARENT_CANNOT_CONTROL);
    handleFusesSet(event);

    assert.fieldEquals("WrappedDomain", node, "fuses", PARENT_CANNOT_CONTROL.toString());
    // wrappedDomain.expiryDate (500) is later than the pre-seeded
    // domain.expiryDate (100), so once PCC is burned it takes over.
    assert.fieldEquals("Domain", node, "expiryDate", "500");
  });
});

describe("handleExpiryExtended", () => {
  test("writes history but touches no Domain when no WrappedDomain exists yet", () => {
    const node =
      "0x3333333333333333333333333333333333333333333333333333333333333333";
    const event = createExpiryExtendedEvent(node, BigInt.fromI32(999));
    handleExpiryExtended(event);

    assert.notInStore("WrappedDomain", node);
    assert.notInStore("Domain", node);

    let eventId = createEventID(event).toHexString();
    assert.fieldEquals("ExpiryExtended", eventId, "domain", node);
    assert.fieldEquals("ExpiryExtended", eventId, "expiryDate", "999");
  });

  test("bumps Domain.expiryDate for an already-PCC-burned WrappedDomain", () => {
    const node =
      "0x4444444444444444444444444444444444444444444444444444444444444444";
    let nodeBytes = Bytes.fromHexString(node);

    let domain = new Domain(nodeBytes);
    domain.owner = Bytes.fromHexString(DEFAULT_OWNER);
    domain.isMigrated = true;
    domain.subdomainCount = 0;
    domain.createdAt = BigInt.fromI32(0);
    domain.expiryDate = BigInt.fromI32(100);
    domain.save();

    let wrappedDomain = new WrappedDomain(nodeBytes);
    wrappedDomain.domain = nodeBytes;
    wrappedDomain.expiryDate = BigInt.fromI32(200);
    wrappedDomain.fuses = PARENT_CANNOT_CONTROL;
    wrappedDomain.owner = Bytes.fromHexString(DEFAULT_OWNER);
    wrappedDomain.save();

    const event = createExpiryExtendedEvent(node, BigInt.fromI32(1000));
    handleExpiryExtended(event);

    assert.fieldEquals("WrappedDomain", node, "expiryDate", "1000");
    assert.fieldEquals("Domain", node, "expiryDate", "1000");
  });
});

describe("handleTransferSingle / handleTransferBatch", () => {
  test("handleTransferSingle creates a placeholder WrappedDomain, sets domain.wrappedOwner, and writes history", () => {
    const tokenId = BigInt.fromI32(111222333);
    const node =
      "0x0000000000000000000000000000000000000000000000000000000006a11e3d";
    let nodeBytes = Bytes.fromHexString(node);

    let domain = new Domain(nodeBytes);
    domain.owner = Bytes.fromHexString(DEFAULT_OWNER);
    domain.isMigrated = true;
    domain.subdomainCount = 0;
    domain.createdAt = BigInt.fromI32(0);
    domain.save();

    const newOwner = "0xF0205A3A3b2A69De6Dbf7f01ED13B2108B2c4321";
    const event = createTransferSingleEvent(DEFAULT_OWNER, newOwner, tokenId);
    handleTransferSingle(event);

    assert.fieldEquals(
      "WrappedDomain",
      node,
      "owner",
      Address.fromString(newOwner).toHexString()
    );
    // Placeholder values until the real NameWrapped event arrives.
    assert.fieldEquals("WrappedDomain", node, "expiryDate", "0");
    assert.fieldEquals("WrappedDomain", node, "fuses", "0");
    assert.fieldEquals(
      "Domain",
      node,
      "wrappedOwner",
      Address.fromString(newOwner).toHexString()
    );

    let eventId = Bytes.fromByteArray(
      concat(createEventID(event), i32ToBytes(0))
    ).toHexString();
    assert.fieldEquals(
      "WrappedTransfer",
      eventId,
      "owner",
      Address.fromString(newOwner).toHexString()
    );
  });

  test("handleTransferBatch updates every token in the batch and writes one history row per index", () => {
    const tokenIdA = BigInt.fromI32(444555666);
    const tokenIdB = BigInt.fromI32(777888999);
    const nodeA =
      "0x000000000000000000000000000000000000000000000000000000001a7f6192";
    const nodeB =
      "0x000000000000000000000000000000000000000000000000000000002e5da4e7";

    let domainA = new Domain(Bytes.fromHexString(nodeA));
    domainA.owner = Bytes.fromHexString(DEFAULT_OWNER);
    domainA.isMigrated = true;
    domainA.subdomainCount = 0;
    domainA.createdAt = BigInt.fromI32(0);
    domainA.save();

    let domainB = new Domain(Bytes.fromHexString(nodeB));
    domainB.owner = Bytes.fromHexString(DEFAULT_OWNER);
    domainB.isMigrated = true;
    domainB.subdomainCount = 0;
    domainB.createdAt = BigInt.fromI32(0);
    domainB.save();

    const newOwner = "0xF0205A3A3b2A69De6Dbf7f01ED13B2108B2c4321";
    const event = createTransferBatchEvent(DEFAULT_OWNER, newOwner, [
      tokenIdA,
      tokenIdB,
    ]);
    handleTransferBatch(event);

    assert.fieldEquals(
      "WrappedDomain",
      nodeA,
      "owner",
      Address.fromString(newOwner).toHexString()
    );
    assert.fieldEquals(
      "WrappedDomain",
      nodeB,
      "owner",
      Address.fromString(newOwner).toHexString()
    );

    let eventIdA = Bytes.fromByteArray(
      concat(createEventID(event), i32ToBytes(0))
    ).toHexString();
    let eventIdB = Bytes.fromByteArray(
      concat(createEventID(event), i32ToBytes(1))
    ).toHexString();
    assert.fieldEquals("WrappedTransfer", eventIdA, "domain", nodeA);
    assert.fieldEquals("WrappedTransfer", eventIdB, "domain", nodeB);
  });
});
