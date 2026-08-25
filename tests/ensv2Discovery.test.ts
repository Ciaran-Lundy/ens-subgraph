import { Address, BigInt, ethereum } from "@graphprotocol/graph-ts";
import { assert, newMockEvent, test } from "matchstick-as/assembly/index";
import { handleProxyDeployed } from "../src/ensv2Discovery";
import { ProxyDeployed } from "../src/types/VerifiableFactory/VerifiableFactory";

const FACTORY_ADDRESS = "0xD2a632D8a8b67c2c4398c255CbD7aF8dd7236198";
const SENDER = "0x89205A3A3b2A69De6Dbf7f01ED13B2108B2c43e7";
const PROXY_ADDRESS = "0x11111111111111111111111111111111111111aa";
const IMPLEMENTATION = "0x22222222222222222222222222222222222222bb";

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
// proxies (docs/plan.md Decision 3) — this asserts the Phase 1 "template
// every ProxyDeployed unconditionally" approach regardless of what
// `implementation` is, since we can't yet tell registries and resolvers
// apart by implementation address. What this test *can't* assert (no
// dataSourceCount/dataSourceExists helper exists in the installed
// matchstick-as) is that ENSv2RegistryTemplate.create() actually registered
// a dynamic data source — that needs a real graph-node/Subgraph Studio
// check per the Phase 1 plan's verification section.
test("handleProxyDeployed creates an ENSv2Registry row with kind UNKNOWN for any implementation", () => {
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
});
