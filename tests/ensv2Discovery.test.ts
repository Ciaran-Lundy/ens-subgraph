import { Address, BigInt, ethereum } from "@graphprotocol/graph-ts";
import {
  assert,
  dataSourceMock,
  newMockEvent,
  test,
} from "matchstick-as/assembly/index";
import { handleProxyDeployed } from "../src/ensv2Discovery";
import { ProxyDeployed } from "../src/types/VerifiableFactory/VerifiableFactory";

const FACTORY_ADDRESS = "0xD2a632D8a8b67c2c4398c255CbD7aF8dd7236198";
const SENDER = "0x89205A3A3b2A69De6Dbf7f01ED13B2108B2c43e7";
const PROXY_ADDRESS = "0x11111111111111111111111111111111111111aa";
const IMPLEMENTATION = "0x22222222222222222222222222222222222222bb";
// Must match ensv2Constants.ts's sepolia-network return values exactly —
// deliberately hardcoded here (not imported) so a test breaks if that file's
// constants ever drift, rather than tautologically always agreeing with them.
const USER_REGISTRY_IMPL = "0x624a25d67b59d587752ebec8dded8827dae52050";
const WRAPPER_REGISTRY_IMPL = "0x433f81a3e8921fc868ae1a04576f135d9a75b0f2";
const PERMISSIONED_RESOLVER_IMPL = "0x9eae5c2730a7dd16bdd1dee6421a1b91e3b0365e";

const createProxyDeployedEvent = (
  proxyAddress: string,
  implementation: string
): ProxyDeployed => {
  let mockEvent = newMockEvent();
  let event = new ProxyDeployed(
    Address.fromString(FACTORY_ADDRESS),
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
      "sender",
      ethereum.Value.fromAddress(Address.fromString(SENDER))
    )
  );
  event.parameters.push(
    new ethereum.EventParam(
      "proxyAddress",
      ethereum.Value.fromAddress(Address.fromString(proxyAddress))
    )
  );
  event.parameters.push(
    new ethereum.EventParam(
      "salt",
      ethereum.Value.fromUnsignedBigInt(BigInt.fromI32(1))
    )
  );
  event.parameters.push(
    new ethereum.EventParam(
      "implementation",
      ethereum.Value.fromAddress(Address.fromString(implementation))
    )
  );
  return event;
};

// VerifiableFactory.deployProxy() is used for both registry and resolver
// proxies. This asserts the fallback case: an
// implementation address that's neither a known registry impl (see the
// USER/WRAPPER tests below) nor the known resolver impl (see the
// no-row-created test below) still gets templated and creates an
// ENSv2Registry row, classified UNKNOWN — the same defensive default as
// before GitHub #33/#36's classification fix, for any future/unrecognized
// implementation this deployment doesn't know about yet. What this test
// *can't* assert (no dataSourceCount/dataSourceExists helper exists in the
// installed matchstick-as) is that ENSv2RegistryTemplate.create() actually
// registered a dynamic data source — that needs a real graph-node/Subgraph
// Studio check per the Phase 1 plan's verification section.
test("handleProxyDeployed creates an ENSv2Registry row with kind UNKNOWN for an unrecognized implementation, and captures the implementation address (audit finding 4)", () => {
  dataSourceMock.setNetwork("sepolia");

  let event = createProxyDeployedEvent(PROXY_ADDRESS, IMPLEMENTATION);
  handleProxyDeployed(event);

  let id = Address.fromString(PROXY_ADDRESS).toHexString();
  assert.fieldEquals("ENSv2Registry", id, "kind", "UNKNOWN");
  assert.fieldEquals(
    "ENSv2Registry",
    id,
    "address",
    Address.fromString(PROXY_ADDRESS).toHexString()
  );
  assert.fieldEquals(
    "ENSv2Registry",
    id,
    "implementation",
    Address.fromString(IMPLEMENTATION).toHexString()
  );
});

test("handleProxyDeployed classifies a UserRegistry implementation as kind USER (GitHub #33)", () => {
  dataSourceMock.setNetwork("sepolia");

  // This file has no clearStore()/beforeEach between tests, so each test
  // needs its own proxy address — reusing PROXY_ADDRESS would load the
  // already-created row from an earlier test instead of creating a fresh
  // one (getOrCreateRegistry is a no-op once a row exists at that id).
  let userProxyAddress = "0x33333333333333333333333333333333333333cc";
  let event = createProxyDeployedEvent(userProxyAddress, USER_REGISTRY_IMPL);
  handleProxyDeployed(event);

  let id = Address.fromString(userProxyAddress).toHexString();
  assert.fieldEquals("ENSv2Registry", id, "kind", "USER");
});

test("handleProxyDeployed classifies a WrapperRegistry implementation as kind WRAPPER (GitHub #33)", () => {
  dataSourceMock.setNetwork("sepolia");

  let wrapperProxyAddress = "0x44444444444444444444444444444444444444dd";
  let event = createProxyDeployedEvent(wrapperProxyAddress, WRAPPER_REGISTRY_IMPL);
  handleProxyDeployed(event);

  let id = Address.fromString(wrapperProxyAddress).toHexString();
  assert.fieldEquals("ENSv2Registry", id, "kind", "WRAPPER");
});

test("handleProxyDeployed skips templating and creates no ENSv2Registry row for a PermissionedResolver implementation (GitHub #36)", () => {
  dataSourceMock.setNetwork("sepolia");

  let resolverProxyAddress = "0x55555555555555555555555555555555555555ee";
  let event = createProxyDeployedEvent(resolverProxyAddress, PERMISSIONED_RESOLVER_IMPL);
  handleProxyDeployed(event);

  let id = Address.fromString(resolverProxyAddress).toHexString();
  assert.notInStore("ENSv2Registry", id);
});
