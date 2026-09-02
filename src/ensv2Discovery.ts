// Registry discovery via VerifiableFactory.ProxyDeployed, plus the shared
// getOrCreateRegistry/getOrCreateRootNamespace helpers used by
// ensv2Registry.ts's bootstrap step (and by Phase 4's ensv2Paths.ts later).
import { Address, Bytes, ethereum } from "@graphprotocol/graph-ts";

import { ROOT_NODE } from "./utils";
import { appendRegistryNamespaceIndex, namespaceId } from "./ensv2Utils";
import { getEthRegistryAddress, getRootRegistryAddress } from "./ensv2Constants";
import { ENSv2Namespace, ENSv2Registry } from "./types/schema";
import { ProxyDeployed } from "./types/VerifiableFactory/VerifiableFactory";
import { ENSv2Registry as ENSv2RegistryTemplate } from "./types/templates";

// Classifies purely from the address, so it gives the same answer no
// matter which event/call site first causes a registry row to be created —
// RootRegistry's own first event, ETHRegistry's own first event, a
// SubregistryUpdated linking ETHRegistry in as a child, or a ParentUpdated
// referencing it, all agree. getOrCreateRegistry only sets kind once (on
// creation), so if any call site passed a hardcoded "UNKNOWN" instead of
// this, whichever event happened to create the row first would wrongly
// freeze it at UNKNOWN forever.
export function kindForAddress(address: Address): string {
  if (address.equals(getRootRegistryAddress())) {
    return "ROOT";
  }
  if (address.equals(getEthRegistryAddress())) {
    return "ETH";
  }
  return "UNKNOWN";
}

export function getOrCreateRegistry(
  id: Bytes,
  address: Address,
  block: ethereum.Block
): ENSv2Registry {
  let registry = ENSv2Registry.load(id);
  if (registry == null) {
    registry = new ENSv2Registry(id);
    registry.address = address;
    registry.kind = kindForAddress(address);
    registry.namespaceCount = 0;
    registry.discoveredAt = block.timestamp;
    registry.createdAtBlock = block.number;
    registry.updatedAtBlock = block.number;
    registry.save();
  }
  return registry;
}

export function getOrCreateRootNamespace(
  rootRegistryId: Bytes,
  block: ethereum.Block
): ENSv2Namespace {
  let rootNamehash = ROOT_NODE;
  let id = namespaceId(rootRegistryId, rootNamehash);
  let namespace = ENSv2Namespace.load(id);
  if (namespace == null) {
    namespace = new ENSv2Namespace(id);
    namespace.registry = rootRegistryId;
    // Root has no name. Left unset (not assigned "") deliberately: the
    // generated nullable-String setter treats "" as falsy and unsets the
    // field regardless, so it would end up null either way — this documents
    // that rather than relying on the fall-through.
    namespace.baseNamehash = rootNamehash;
    namespace.active = true;
    namespace.createdAt = block.timestamp;
    namespace.createdAtBlock = block.number;
    namespace.updatedAtBlock = block.number;
    namespace.save();

    // Must append the index entity too, not just bump the counter — Phase
    // 4's materializePathsForSlot enumerates namespaces strictly via
    // ENSv2RegistryNamespaceIndex (bounded by namespaceCount), so a counter
    // increment with no matching index row would make this namespace
    // invisible to that loop despite namespaceCount claiming it exists.
    // Shared with ensv2Paths.ts's equivalent append (audit finding 23) —
    // see ensv2Utils.ts::appendRegistryNamespaceIndex for why it lives there.
    let registry = ENSv2Registry.load(rootRegistryId)!;
    appendRegistryNamespaceIndex(registry, namespace);
  }
  return namespace;
}

// VerifiableFactory.deployProxy() is used for both registry and resolver
// proxies (per the ENSv2 Subgraph Upgrade Proposal's "Discovery" section).
// Resolver events are handled entirely via the addressless PermissionedResolver
// data source (docs/plan.md prerequisite #8 resolved toward addressless), so
// resolvers need no discovery step. That leaves no reliable way here to tell
// a registry deployment from a resolver deployment without the registry
// implementation address(es) (UserRegistryImpl/WrapperRegistryImpl), which
// aren't confirmed yet for this deployment (docs/plan.md — new prerequisite,
// same caveat as the migration controller addresses). Templating every
// ProxyDeployed unconditionally is coincidentally safe today, not
// structurally safe: it does create a real ENSv2Registry row (kind =
// UNKNOWN) for every resolver deployment too, since getOrCreateRegistry
// below has no registry-vs-resolver check either — it's just that nothing
// currently queries or acts on those bogus UNKNOWN rows, and a resolver
// proxy never emits PermissionedRegistry-shaped events, so no *further*
// state gets corrupted from them. The moment anything relies on
// ENSv2Registry rows meaning "a real registry," this needs the same
// implementation-address classification fix as kindForAddress above (see
// docs/combined-findings-and-remediation-plan.md findings 33/36). Until
// then this just costs graph-node one extra inert watched address plus one
// harmless-but-wrong entity row per resolver deployment.
export function handleProxyDeployed(event: ProxyDeployed): void {
  ENSv2RegistryTemplate.create(event.params.proxyAddress);
  let registry = getOrCreateRegistry(
    event.params.proxyAddress,
    event.params.proxyAddress,
    event.block
  );
  // Captured even though nothing classifies on it yet (kindForAddress above
  // is still address-based, pending #33/#34's implementation-address
  // classification work) — the alternative is discarding the one piece of
  // on-chain data that would let a future classification fix backfill
  // already-indexed registries without a full re-index (audit finding 4).
  registry.implementation = event.params.implementation;
  registry.save();
}
