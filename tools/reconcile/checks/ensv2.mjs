// Full-coverage ENSv2 reconciliation. Every event type wired in
// subgraph.yaml for RootRegistry/ETHRegistry/discovered UserRegistries,
// ETHRegistrar, VerifiableFactory, and discovered PermissionedResolver
// instances gets checked, from real startBlock to chain head — reconcile
// plan Design decision 2/4: field derivation mirrors the actual mapping
// source (src/ensv2Registry.ts, ensv2Paths.ts, ensv2Domain.ts,
// ensv2Registrar.ts, ensv2Roles.ts, ensv2Resolver.ts), not guesses.
//
// Scope, stated explicitly rather than implied: immutable history entities
// (ENSv2LabelRegistered etc.) are checked per-event, exactly, no ordering
// needed. Mutable "current state" entities are checked by replaying the
// relevant event history in (blockNumber, logIndex) order and comparing
// the resulting expected state to the live entity — full replay for
// ENSv2NameSlot (LabelRegistered/LabelReserved/LabelUnregistered/
// ExpiryUpdated/SubregistryUpdated/ResolverUpdated), latest-event-wins for
// ENSv2Resource/ENSv2Token/ENSv2RoleAssignment/ENSv2Registration/
// ENSv2ResolverAlias (each event for these already writes every field the
// entity has, so "latest wins" is equivalent to a full replay for them).
// ENSv2TokenTransferred's conditional only-if-slot-already-resolved
// history-write rule, and TokenRegenerated chains, are NOT independently
// replayed (would require replaying TokenResource ordering too) — see
// README's "Known scope limits".
//
// Every check function here takes an already-fetched, already-decoded
// `events` array (via fetchDecodedLogs, called once per contract+range by
// run.mjs) rather than fetching its own logs — three or four checks all
// wanting the same contract's full log range would otherwise triple/
// quadruple the RPC calls for no reason.
import { CONTRACTS, MIGRATION_CONTROLLERS, ZERO_ADDRESS } from "../config.mjs";
import { getLogsChunked, getBlockNumber } from "../lib/rpc.mjs";
import { loadInterface } from "../lib/abi.mjs";
import { query, queryAll } from "../lib/subgraph.mjs";
import { createEventID, nameSlotId, resourceId, tokenEntityId, toSlotId } from "../lib/ids.mjs";
import { makeCheck, compareFields, recordResult } from "../lib/report.mjs";

function checkValidLabel(name) {
  if (name == null) return false;
  for (const ch of name) {
    const code = ch.charCodeAt(0);
    if (code === 0 || code === 46 || code === 91 || code === 93) return false;
  }
  return true;
}

function isMigrationController(sender) {
  return MIGRATION_CONTROLLERS.includes(sender.toLowerCase());
}

function isZero(addr) {
  return addr.toLowerCase() === ZERO_ADDRESS;
}

// Discovers every registry/resolver address the subgraph itself knows
// about (reconcile plan Design decision 3).
export async function discoverRegistries() {
  const rows = await queryAll("ensv2Registries", "id kind");
  const addresses = new Set(rows.map((r) => r.id));
  addresses.add(CONTRACTS.RootRegistry.address.toLowerCase());
  addresses.add(CONTRACTS.ETHRegistry.address.toLowerCase());
  return [...addresses];
}

export async function discoverResolvers() {
  const rows = await queryAll("ensv2Resolvers", "id");
  return rows.map((r) => r.id);
}

export async function fetchDecodedLogs(address, abiFileName, fromBlock, toBlock) {
  const iface = loadInterface(abiFileName);
  const raw = await getLogsChunked(address, fromBlock, toBlock);
  const decoded = [];
  for (const log of raw) {
    let parsed;
    try {
      parsed = iface.parseLog(log);
    } catch {
      continue;
    }
    // parseLog returns null (not a throw) when the log's topic0 doesn't
    // match any event in this ABI — real for an address that emits events
    // from more than one ABI shape (e.g. ERC165/ERC1155 interfaces this
    // tool doesn't otherwise decode).
    if (parsed == null) continue;
    decoded.push({ ...log, parsed });
  }
  decoded.sort((a, b) => a.blockNumber - b.blockNumber || a.index - b.index);
  return decoded;
}

// --- ENSv2NameSlot: full ordered replay --------------------------------

// `handleLabelRegistered`/`handleLabelReserved` create the ENSv2NameSlot row
// if it doesn't exist yet — but `handleExpiryUpdated`/`handleSubregistryUpdated`/
// `handleResolverUpdated`/`handleTokenResource`/`handleLabelUnregistered` all
// `.load()` and `log.warning`+return (no entity created, no history written)
// if the slot is unknown. Since slots are never deleted, "known" is a
// strictly growing set as events are processed in order — this single
// ordered pass tracks it, so both the current-state replay and (via
// `gatedOutHistoryIds`, consumed by checkRegistryHistory) the immutable
// history-entity checks apply the identical real-mapping gating rather than
// two independently-drifting implementations of the same rule.
function replaySlots(events) {
  const slots = new Map();
  const knownSlotIds = new Set();
  const gatedOutHistoryIds = new Set();
  const CREATES = new Set(["LabelRegistered", "LabelReserved"]);
  const REQUIRES_EXISTING = new Set(["LabelUnregistered", "ExpiryUpdated", "SubregistryUpdated", "ResolverUpdated"]);

  for (const ev of events) {
    const name = ev.parsed.name;
    const p = ev.parsed.args;
    if (!CREATES.has(name) && !REQUIRES_EXISTING.has(name)) continue;
    const tokenId = p.tokenId;
    const slotId = toSlotId(tokenId).toString();

    if (REQUIRES_EXISTING.has(name) && !knownSlotIds.has(slotId)) {
      gatedOutHistoryIds.add(createEventID(ev.blockNumber, ev.index));
      continue;
    }
    knownSlotIds.add(slotId);

    let s = slots.get(slotId);
    if (!s) {
      s = { slotId };
      slots.set(slotId, s);
    }
    if (name === "LabelRegistered") {
      s.labelhash = p.labelHash.toLowerCase();
      if (checkValidLabel(p.label)) s.label = p.label;
      s.owner = p.owner.toLowerCase();
      s.registrant = p.owner.toLowerCase();
      s.status = "REGISTERED";
      s.expiryDate = p.expiry.toString();
      s.migratedFromV1 = isMigrationController(p.sender);
    } else if (name === "LabelReserved") {
      s.labelhash = p.labelHash.toLowerCase();
      if (checkValidLabel(p.label)) s.label = p.label;
      s.status = "RESERVED";
      s.expiryDate = p.expiry.toString();
      if (s.migratedFromV1 === undefined) s.migratedFromV1 = false;
    } else if (name === "LabelUnregistered") {
      s.status = "AVAILABLE";
    } else if (name === "ExpiryUpdated") {
      s.expiryDate = p.newExpiry.toString();
    } else if (name === "SubregistryUpdated") {
      s.subregistry = isZero(p.subregistry) ? null : p.subregistry.toLowerCase();
    } else if (name === "ResolverUpdated") {
      s.resolver = isZero(p.resolver) ? null : p.resolver.toLowerCase();
    }
  }
  return { slots, gatedOutHistoryIds };
}

export async function checkRegistrySlots(registryAddress, events) {
  const { slots: expectedSlots } = replaySlots(events);
  let checked = 0;
  for (const [slotId, expected] of expectedSlots) {
    const entityId = nameSlotId(registryAddress, BigInt(slotId));
    const data = await query(
      `{ ensv2NameSlot(id: "${entityId}") { id status label labelhash owner { id } registrant { id } expiryDate migratedFromV1 subregistry { id } resolver { id } } }`
    );
    const actual = data.ensv2NameSlot;
    const flat = actual
      ? {
          status: actual.status,
          label: actual.label,
          labelhash: actual.labelhash,
          owner: actual.owner?.id,
          registrant: actual.registrant?.id,
          expiryDate: actual.expiryDate,
          migratedFromV1: actual.migratedFromV1,
          subregistry: actual.subregistry?.id ?? null,
          resolver: actual.resolver?.id ?? null,
        }
      : null;
    // Only compare fields the replay actually touched — a slot whose log
    // window never saw a SubregistryUpdated/ResolverUpdated shouldn't be
    // marked mismatched against a live entity that (correctly) has one
    // from before this window, or vice versa.
    const expectedSubset = {};
    for (const k of Object.keys(expected)) if (k !== "slotId") expectedSubset[k] = expected[k];
    const cmp = compareFields(expectedSubset, flat);
    recordResult({
      ...makeCheck({
        category: "ensv2",
        contract: registryAddress,
        event: "NameSlot-replay",
        block: 0,
        txHash: "n/a",
        logIndex: slotId,
        entityType: "ENSv2NameSlot",
        entityId,
      }),
      status: !flat ? "not_found" : cmp.allMatch ? "match" : "mismatch",
      fields: cmp.fields,
    });
    checked++;
  }
  return checked;
}

// --- History entities: exact per-event ----------------------------------

const HISTORY_ENTITY = {
  LabelRegistered: "ensv2LabelRegistered",
  ExpiryUpdated: "ensv2LabelRenewed",
  LabelUnregistered: "ensv2LabelUnregistered",
  ResolverUpdated: "ensv2ResolverUpdate",
  SubregistryUpdated: "ensv2SubregistryUpdate",
};

function historyExpectedFields(name, p) {
  if (name === "LabelRegistered") {
    return {
      owner: p.owner.toLowerCase(),
      expiryDate: p.expiry.toString(),
      sender: p.sender.toLowerCase(),
      isV1Migration: isMigrationController(p.sender),
    };
  }
  if (name === "ExpiryUpdated") return { newExpiryDate: p.newExpiry.toString() };
  if (name === "LabelUnregistered") return { sender: p.sender.toLowerCase() };
  if (name === "ResolverUpdated") {
    return { resolverAddress: isZero(p.resolver) ? null : p.resolver.toLowerCase(), sender: p.sender.toLowerCase() };
  }
  if (name === "SubregistryUpdated") {
    return { subregistryAddress: isZero(p.subregistry) ? null : p.subregistry.toLowerCase(), sender: p.sender.toLowerCase() };
  }
  return null;
}

// Relation fields (need `{ id }` sub-selection in GraphQL, and the
// returned value needs unwrapping to .id before comparison) among the
// history-entity fields this file queries — everything else here is a
// plain Bytes/BigInt/Boolean scalar.
const RELATION_FIELDS = new Set(["owner"]);

export async function checkRegistryHistory(registryAddress, events) {
  // Same knownSlotIds gating as checkRegistrySlots (see replaySlots) — a
  // ResolverUpdated/SubregistryUpdated for a slot that was never
  // established by an earlier LabelRegistered/LabelReserved in this event
  // stream never reaches the .save() calls in the real mapping, so no
  // history entity exists for it either; expecting one here would be a
  // false "not_found" against correct subgraph behaviour, not a real bug.
  const { gatedOutHistoryIds } = replaySlots(events);
  let checked = 0;
  for (const ev of events) {
    const name = ev.parsed.name;
    const entityField = HISTORY_ENTITY[name];
    if (!entityField) continue;
    const entityId = createEventID(ev.blockNumber, ev.index);
    if (gatedOutHistoryIds.has(entityId)) continue;
    const expected = historyExpectedFields(name, ev.parsed.args);
    if (!expected) continue;
    const fieldsGql = Object.keys(expected)
      .map((f) => (RELATION_FIELDS.has(f) ? `${f} { id }` : f))
      .join(" ");
    const data = await query(`{ ${entityField}(id: "${entityId}") { id ${fieldsGql} } }`);
    const rawActual = data[entityField];
    const actual = rawActual
      ? Object.fromEntries(
          Object.keys(expected).map((f) => [f, RELATION_FIELDS.has(f) ? rawActual[f]?.id : rawActual[f]])
        )
      : null;
    const cmp = compareFields(expected, actual);
    recordResult({
      ...makeCheck({
        category: "ensv2",
        contract: registryAddress,
        event: name,
        block: ev.blockNumber,
        txHash: ev.transactionHash,
        logIndex: ev.index,
        entityType: entityField,
        entityId,
      }),
      status: !actual ? "not_found" : cmp.allMatch ? "match" : "mismatch",
      fields: cmp.fields,
    });
    checked++;
  }
  return checked;
}

// --- ENSv2Resource / ENSv2Token: latest TokenResource wins ---------------

export async function checkResourcesAndTokens(registryAddress, events) {
  const trEvents = events.filter((e) => e.parsed.name === "TokenResource");
  const latestByResource = new Map();
  for (const ev of trEvents) {
    const { resource } = ev.parsed.args;
    latestByResource.set(resource.toString(), ev);
  }
  let checked = 0;
  for (const [resourceStr, ev] of latestByResource) {
    const { tokenId, resource } = ev.parsed.args;
    const entityId = resourceId(registryAddress, resource);
    const expectedTokenEntityId = tokenEntityId(registryAddress, tokenId);
    const data = await query(
      `{ ensv2Resource(id: "${entityId}") { id currentToken { id } active } }`
    );
    const actual = data.ensv2Resource;
    const cmp = compareFields(
      { currentToken: expectedTokenEntityId, active: true },
      actual ? { currentToken: actual.currentToken?.id, active: actual.active } : null
    );
    recordResult({
      ...makeCheck({
        category: "ensv2",
        contract: registryAddress,
        event: "TokenResource-latest",
        block: ev.blockNumber,
        txHash: ev.transactionHash,
        logIndex: ev.index,
        entityType: "ENSv2Resource",
        entityId,
      }),
      status: !actual ? "not_found" : cmp.allMatch ? "match" : "mismatch",
      fields: cmp.fields,
    });
    checked++;
  }
  return checked;
}

// --- ENSv2RoleAssignment + ENSv2RoleChange -------------------------------

export async function checkRoleAssignments(contractAddress, events) {
  const roleEvents = events.filter((e) => e.parsed.name === "EACRolesChanged");

  // Every occurrence gets its ENSv2RoleChange history row checked exactly.
  let checked = 0;
  for (const ev of roleEvents) {
    const { resource, account, oldRoleBitmap, newRoleBitmap } = ev.parsed.args;
    const historyId = createEventID(ev.blockNumber, ev.index);
    const hdata = await query(
      `{ ensv2RoleChange(id: "${historyId}") { id oldRoleBitmap newRoleBitmap contract resource account { id } } }`
    );
    const hActual = hdata.ensv2RoleChange;
    const hCmp = compareFields(
      {
        oldRoleBitmap: oldRoleBitmap.toString(),
        newRoleBitmap: newRoleBitmap.toString(),
        contract: contractAddress.toLowerCase(),
        resource: resource.toString(),
        account: account.toLowerCase(),
      },
      hActual
        ? {
            oldRoleBitmap: hActual.oldRoleBitmap,
            newRoleBitmap: hActual.newRoleBitmap,
            contract: hActual.contract,
            resource: hActual.resource,
            account: hActual.account?.id,
          }
        : null
    );
    recordResult({
      ...makeCheck({
        category: "ensv2",
        contract: contractAddress,
        event: "EACRolesChanged-history",
        block: ev.blockNumber,
        txHash: ev.transactionHash,
        logIndex: ev.index,
        entityType: "ENSv2RoleChange",
        entityId: historyId,
      }),
      status: !hActual ? "not_found" : hCmp.allMatch ? "match" : "mismatch",
      fields: hCmp.fields,
    });
    checked++;
  }

  // Latest event per (resource, account) wins for the current-state
  // ENSv2RoleAssignment row.
  const latest = new Map();
  for (const ev of roleEvents) {
    const { resource, account } = ev.parsed.args;
    latest.set(`${resource.toString()}-${account.toLowerCase()}`, ev);
  }
  for (const ev of latest.values()) {
    const { resource, account, newRoleBitmap } = ev.parsed.args;
    const entityId = `${contractAddress.toLowerCase()}-${resource.toString()}-${account.toLowerCase()}`;
    const data = await query(
      `{ ensv2RoleAssignment(id: "${entityId}") { id roleBitmap contract resource account { id } } }`
    );
    const actual = data.ensv2RoleAssignment;
    const cmp = compareFields(
      { roleBitmap: newRoleBitmap.toString(), contract: contractAddress.toLowerCase(), resource: resource.toString(), account: account.toLowerCase() },
      actual
        ? { roleBitmap: actual.roleBitmap, contract: actual.contract, resource: actual.resource, account: actual.account?.id }
        : null
    );
    recordResult({
      ...makeCheck({
        category: "ensv2",
        contract: contractAddress,
        event: "EACRolesChanged-latest",
        block: ev.blockNumber,
        txHash: ev.transactionHash,
        logIndex: ev.index,
        entityType: "ENSv2RoleAssignment",
        entityId,
      }),
      status: !actual ? "not_found" : cmp.allMatch ? "match" : "mismatch",
      fields: cmp.fields,
    });
    checked++;
  }
  return checked;
}

// --- ENSv2Registration (ETHRegistrar): latest NameRegistered/Renewed -----

export async function checkRegistrations(events) {
  const regEvents = events.filter((e) => e.parsed.name === "NameRegistered" || e.parsed.name === "NameRenewed");
  const latestByToken = new Map();
  for (const ev of regEvents) latestByToken.set(ev.parsed.args.tokenId.toString(), ev);

  let checked = 0;
  for (const ev of latestByToken.values()) {
    const p = ev.parsed.args;
    const slotId = toSlotId(p.tokenId);
    const entityId = nameSlotId(CONTRACTS.ETHRegistry.address, slotId);
    const expected = { duration: p.duration.toString(), label: p.label };
    const data = await query(`{ ensv2Registration(id: "${entityId}") { id duration label } }`);
    const actual = data.ensv2Registration;
    const cmp = compareFields(expected, actual);
    recordResult({
      ...makeCheck({
        category: "ensv2",
        contract: CONTRACTS.ETHRegistrar.address,
        event: `${ev.parsed.name}-latest`,
        block: ev.blockNumber,
        txHash: ev.transactionHash,
        logIndex: ev.index,
        entityType: "ENSv2Registration",
        entityId,
      }),
      status: !actual ? "not_found" : cmp.allMatch ? "match" : "mismatch",
      fields: cmp.fields,
    });
    checked++;
  }
  return checked;
}

// --- VerifiableFactory: ProxyDeployed -> ENSv2Registry exists ------------

export async function checkProxyDeployed(events) {
  let checked = 0;
  for (const ev of events) {
    if (ev.parsed.name !== "ProxyDeployed") continue;
    const proxyAddress = ev.parsed.args.proxyAddress.toLowerCase();
    const data = await query(`{ ensv2Registry(id: "${proxyAddress}") { id address } }`);
    const actual = data.ensv2Registry;
    const cmp = compareFields({ address: proxyAddress }, actual ? { address: actual.address } : null);
    recordResult({
      ...makeCheck({
        category: "ensv2",
        contract: CONTRACTS.VerifiableFactory.address,
        event: "ProxyDeployed",
        block: ev.blockNumber,
        txHash: ev.transactionHash,
        logIndex: ev.index,
        entityType: "ENSv2Registry",
        entityId: proxyAddress,
      }),
      status: !actual ? "not_found" : cmp.allMatch ? "match" : "mismatch",
      fields: cmp.fields,
    });
    checked++;
  }
  return checked;
}

// --- PermissionedResolver: aliases ----------------------------------------

export async function checkResolverAliases(resolverAddress, events) {
  const aliasEvents = events.filter((e) => e.parsed.name === "AliasChanged");
  const latest = new Map();
  for (const ev of aliasEvents) latest.set(ev.parsed.args.fromName, ev);

  let checked = 0;
  for (const ev of latest.values()) {
    const { fromName, toName } = ev.parsed.args;
    const entityId = `${resolverAddress.toLowerCase()}-${fromName.toLowerCase()}`;
    const isCleared = toName.toLowerCase() === "0x";
    const data = await query(`{ ensv2ResolverAlias(id: "${entityId}") { id active } }`);
    const actual = data.ensv2ResolverAlias;
    const cmp = compareFields({ active: !isCleared }, actual ? { active: actual.active } : null);
    recordResult({
      ...makeCheck({
        category: "ensv2",
        contract: resolverAddress,
        event: "AliasChanged-latest",
        block: ev.blockNumber,
        txHash: ev.transactionHash,
        logIndex: ev.index,
        entityType: "ENSv2ResolverAlias",
        entityId,
      }),
      status: !actual ? "not_found" : cmp.allMatch ? "match" : "mismatch",
      fields: cmp.fields,
    });
    checked++;
  }
  return checked;
}

export { getBlockNumber };
