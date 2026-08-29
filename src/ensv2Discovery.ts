// Registry discovery via VerifiableFactory.ProxyDeployed, plus the shared
// getOrCreateRegistry/getOrCreateRootNamespace helpers used by
// ensv2Registry.ts's bootstrap step (and by Phase 4's ensv2Paths.ts later).
import { Address, Bytes, ethereum } from "@graphprotocol/graph-ts";

import { ROOT_NODE } from "./utils";
import { namespaceId, registryNamespaceIndexId } from "./ensv2Utils";
import { getEthRegistryAddress, getRootRegistryAddress } from "./ensv2Constants";
import {
  ENSv2Namespace,
  ENSv2Registry,
  ENSv2RegistryNamespaceIndex,
} from "./types/schema";
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
    let registry = ENSv2Registry.load(rootRegistryId)!;
    let index = new ENSv2RegistryNamespaceIndex(
      registryNamespaceIndexId(registry.id, registry.namespaceCount)
    );
    index.registry = registry.id;
    index.index = registry.namespaceCount;
    index.namespace = namespace.id;
    index.save();

    registry.namespaceCount = registry.namespaceCount + 1;
    registry.save();
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
// ProxyDeployed unconditionally is harmless: a resolver proxy never emits
// PermissionedRegistry-shaped events, so no bogus entities get created —
// it only costs graph-node one extra inert watched address per resolver
// deployment. Newly-discovered registries get kind = UNKNOWN (not a guessed
// USER) until real implementation addresses allow precise classification.
export function handleProxyDeployed(event: ProxyDeployed): void {
  ENSv2RegistryTemplate.create(event.params.proxyAddress);
  getOrCreateRegistry(
    event.params.proxyAddress,
    event.params.proxyAddress,
    event.block
  );
}
