// Registry discovery via VerifiableFactory.ProxyDeployed, plus the shared
// getOrCreateRegistry/getOrCreateRootNamespace helpers used by
// ensv2Registry.ts's bootstrap step (and by Phase 4's ensv2Paths.ts later).
import { Address, Bytes, ethereum } from "@graphprotocol/graph-ts";

import { ROOT_NODE } from "./utils";
import { appendRegistryNamespaceIndex, namespaceId } from "./ensv2Utils";
import {
  getEthRegistryAddress,
  getPermissionedResolverImplAddress,
  getRootRegistryAddress,
  getUserRegistryImplAddress,
  getWrapperRegistryImplAddress,
} from "./ensv2Constants";
import { ENSv2Namespace, ENSv2Registry } from "./types/schema";
import { ProxyDeployed } from "./types/VerifiableFactory/VerifiableFactory";
import { ENSv2Registry as ENSv2RegistryTemplate } from "./types/templates";

// Classifies purely from the address (+ implementation, for the
// template-discovered case), so it gives the same answer no matter which
// event/call site first causes a registry row to be created — RootRegistry's
// own first event, ETHRegistry's own first event, a SubregistryUpdated
// linking a child registry in, or a ParentUpdated referencing it, all agree.
// getOrCreateRegistry only sets kind once (on creation), so if any call site
// passed a hardcoded "UNKNOWN" instead of this, whichever event happened to
// create the row first would wrongly freeze it at UNKNOWN forever.
//
// `implementation` is only ever available at the one call site that has it
// (handleProxyDeployed, from the ProxyDeployed event itself) — every other
// call site passes null, which is fine: a real deployed registry's
// ProxyDeployed event is always indexed before anything else could
// reference its address (the address can't be referenced on-chain before
// the proxy exists), so by the time any other call site runs, the row
// already exists with its real classification and this function never
// actually reruns for it (audit finding 4 / GitHub #33 / #36).
export function kindForAddress(
  address: Address,
  implementation: Bytes | null = null
): string {
  if (address.equals(getRootRegistryAddress())) {
    return "ROOT";
  }
  if (address.equals(getEthRegistryAddress())) {
    return "ETH";
  }
  if (implementation) {
    if (implementation.equals(getUserRegistryImplAddress())) {
      return "USER";
    }
    if (implementation.equals(getWrapperRegistryImplAddress())) {
      return "WRAPPER";
    }
  }
  return "UNKNOWN";
}

export function getOrCreateRegistry(
  id: Bytes,
  address: Address,
  block: ethereum.Block,
  implementation: Bytes | null = null
): ENSv2Registry {
  let registry = ENSv2Registry.load(id);
  if (registry == null) {
    registry = new ENSv2Registry(id);
    registry.address = address;
    registry.kind = kindForAddress(address, implementation);
    registry.implementation = implementation;
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
// data source, so resolvers need no discovery step — and now that the implementation address
// is known (GitHub #34), a resolver deployment can be told apart from a
// registry one directly: skip templating/registry-row creation entirely for
// it, rather than creating a harmless-but-wrong ENSv2Registry row the way
// this function used to (GitHub #33 / #36 / audit finding 4).
export function handleProxyDeployed(event: ProxyDeployed): void {
  let implementation = event.params.implementation;
  if (implementation.equals(getPermissionedResolverImplAddress())) {
    return;
  }

  ENSv2RegistryTemplate.create(event.params.proxyAddress);
  let registry = getOrCreateRegistry(
    event.params.proxyAddress,
    event.params.proxyAddress,
    event.block,
    implementation
  );
  // Redundant with getOrCreateRegistry's own create-branch assignment on the
  // path that actually matters (a real deployed registry's ProxyDeployed
  // always indexes before anything else can reference it — see
  // kindForAddress's header comment) — kept anyway as a defensive backstop
  // in case that ordering assumption is ever wrong, so `implementation` is
  // never silently dropped for an already-existing row.
  registry.implementation = implementation;
  registry.save();
}
