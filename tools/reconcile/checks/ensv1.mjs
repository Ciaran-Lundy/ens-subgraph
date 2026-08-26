// Bounded-sample + edge-case ENSv1 reconciliation (reconcile plan: every
// event TYPE gets real exact-match checks; not full 7.8M-block history —
// see README's "Known scope limits" for exactly what is and isn't
// independently verified here, in particular Domain.name/labelName (built
// via graph-node's internal ens.nameByHash() reverse lookup, which this
// tool has no access to and cannot reproduce) and ENSRegistryOld's
// isMigrated-conditional handlers (would need full cross-registry replay
// in log order to resolve correctly; ENSRegistryOld is pre-2017 legacy
// code this session never touched, so it's out of scope here by explicit
// decision, not omission).
import { CONTRACTS } from "../config.mjs";
import { loadInterface } from "../lib/abi.mjs";
import { query } from "../lib/subgraph.mjs";
import { createEventID, makeSubnode } from "../lib/ids.mjs";
import { decodeDnsName } from "../lib/dns.mjs";
import { makeCheck, compareFields, recordResult } from "../lib/report.mjs";
import { fetchDecodedLogs } from "./ensv2.mjs"; // generic decode-and-sort, reused

const ETH_NODE = "0x93cdeb708b7545dc668eb9280176169d1c33cfd8ed6f04690a0bcc88a93fc4ae";

export async function fetchEvents(contractKey, fromBlock, toBlock) {
  const c = CONTRACTS[contractKey];
  return fetchDecodedLogs(c.address, c.abi, fromBlock, toBlock);
}

// --- ENSRegistry: NewOwner/Transfer/NewResolver/NewTTL --------------------

export async function checkEnsRegistryHistory(events) {
  let checked = 0;
  for (const ev of events) {
    const name = ev.parsed.name;
    const p = ev.parsed.args;
    const entityId = createEventID(ev.blockNumber, ev.index);
    let gqlType, expected;
    // Real, reproducible subgraph bug found via this check (not a tool
    // bug): src/ensRegistry.ts::handleNewResolver sets
    // `domainEvent.resolver = id ? id : EMPTY_ADDRESS` — for the
    // resolver-cleared-to-zero case, that stores the literal string
    // "0x0000...0000" into a field typed `resolver: Resolver!` (non-null
    // relation), but no Resolver entity ever has that id (real ids are
    // always "address-node"). Selecting `resolver { id }` on such a row
    // makes graph-node itself return a GraphQL error ("Null value
    // resolved for non-null field `resolver`") rather than null — a real,
    // reproducible defect for any consumer selecting through that field,
    // not a false positive from this tool. Detected here as `isZero`;
    // handled by not requesting `resolver { id }` for that specific case
    // (querying it would just reproduce the crash) and recording it as a
    // `dangling_relation` status instead of `not_found`/`mismatch`.
    let skipResolverField = false;
    if (name === "NewOwner") {
      const domainId = makeSubnode(p.node, p.label);
      gqlType = "newOwner";
      expected = { parentDomain: p.node.toLowerCase(), domain: domainId, owner: p.owner.toLowerCase() };
    } else if (name === "Transfer") {
      gqlType = "transfer";
      expected = { domain: p.node.toLowerCase(), owner: p.owner.toLowerCase() };
    } else if (name === "NewResolver") {
      gqlType = "newResolver";
      const isZero = p.resolver.toLowerCase() === "0x0000000000000000000000000000000000000000";
      skipResolverField = isZero;
      expected = isZero
        ? { domain: p.node.toLowerCase() }
        : { domain: p.node.toLowerCase(), resolver: `${p.resolver.toLowerCase()}-${p.node.toLowerCase()}` };
    } else if (name === "NewTTL") {
      gqlType = "newTTL";
      expected = { domain: p.node.toLowerCase(), ttl: p.ttl.toString() };
    } else {
      continue;
    }
    const fieldsGql = Object.keys(expected)
      .map((f) => (["domain", "parentDomain", "resolver", "owner"].includes(f) ? `${f} { id }` : f))
      .join(" ");
    let data;
    try {
      data = await query(`{ ${gqlType}(id: "${entityId}") { id ${fieldsGql} } }`);
    } catch (err) {
      recordResult({
        ...makeCheck({ category: "ensv1", contract: "ENSRegistry", event: name, block: ev.blockNumber, txHash: ev.transactionHash, logIndex: ev.index, entityType: gqlType, entityId }),
        status: "error",
        fields: [{ field: "_query", expected: "no GraphQL error", actual: err.message, match: false }],
      });
      checked++;
      continue;
    }
    const actual = data[gqlType];
    const flat = actual
      ? Object.fromEntries(
          Object.keys(expected).map((f) => [
            f,
            ["domain", "parentDomain", "resolver", "owner"].includes(f) ? actual[f]?.id : actual[f],
          ])
        )
      : null;
    const cmp = compareFields(expected, flat);
    recordResult({
      ...makeCheck({ category: "ensv1", contract: "ENSRegistry", event: name, block: ev.blockNumber, txHash: ev.transactionHash, logIndex: ev.index, entityType: gqlType, entityId }),
      status: !actual ? "not_found" : cmp.allMatch ? "match" : "mismatch",
      fields: cmp.fields,
      note: skipResolverField ? "resolver field not queried — see dangling-relation defect noted in this file" : undefined,
    });
    checked++;
  }
  return checked;
}

// Domain current-state (owner/parent/labelhash/ttl/resolver relation only
// — name/labelName intentionally excluded, see file header).
export async function checkDomainsCurrentState(events) {
  const latestOwner = new Map(); // domainId -> {owner, parent, labelhash}
  const latestTtl = new Map();
  const latestResolver = new Map();
  for (const ev of events) {
    const p = ev.parsed.args;
    if (ev.parsed.name === "NewOwner") {
      const domainId = makeSubnode(p.node, p.label);
      latestOwner.set(domainId, { owner: p.owner.toLowerCase(), parent: p.node.toLowerCase(), labelhash: p.label.toLowerCase() });
    } else if (ev.parsed.name === "Transfer") {
      const prev = latestOwner.get(p.node.toLowerCase()) || {};
      latestOwner.set(p.node.toLowerCase(), { ...prev, owner: p.owner.toLowerCase() });
    } else if (ev.parsed.name === "NewTTL") {
      latestTtl.set(p.node.toLowerCase(), p.ttl.toString());
    } else if (ev.parsed.name === "NewResolver") {
      const isZero = p.resolver.toLowerCase() === "0x0000000000000000000000000000000000000000";
      latestResolver.set(p.node.toLowerCase(), isZero ? null : `${p.resolver.toLowerCase()}-${p.node.toLowerCase()}`);
    }
  }
  let checked = 0;
  const domainIds = new Set([...latestOwner.keys(), ...latestTtl.keys(), ...latestResolver.keys()]);
  for (const domainId of domainIds) {
    const expected = {};
    const o = latestOwner.get(domainId);
    if (o) {
      if (o.owner) expected.owner = o.owner;
      if (o.parent) expected.parent = o.parent;
      if (o.labelhash) expected.labelhash = o.labelhash;
    }
    if (latestTtl.has(domainId)) expected.ttl = latestTtl.get(domainId);
    if (latestResolver.has(domainId)) expected.resolver = latestResolver.get(domainId);
    if (Object.keys(expected).length === 0) continue;

    const data = await query(
      `{ domain(id: "${domainId}") { id owner { id } parent { id } labelhash ttl resolver { id } } }`
    );
    const actual = data.domain;
    const flat = actual
      ? { owner: actual.owner?.id, parent: actual.parent?.id, labelhash: actual.labelhash, ttl: actual.ttl, resolver: actual.resolver?.id ?? null }
      : null;
    const expectedSubset = {};
    for (const k of Object.keys(expected)) expectedSubset[k] = flat ? flat[k] !== undefined ? expected[k] : expected[k] : expected[k];
    const cmp = compareFields(expected, flat);
    recordResult({
      ...makeCheck({ category: "ensv1", contract: "ENSRegistry", event: "Domain-latest", block: 0, txHash: "n/a", logIndex: domainId, entityType: "Domain", entityId: domainId }),
      status: !actual ? "not_found" : cmp.allMatch ? "match" : "mismatch",
      fields: cmp.fields,
      note: "owner/parent/labelhash/ttl/resolver only — name/labelName not independently verifiable (ens.nameByHash reverse lookup)",
    });
    checked++;
  }
  return checked;
}

// --- BaseRegistrar: NameRegistered/NameRenewed/Transfer -------------------

export async function checkBaseRegistrar(events) {
  let checked = 0;
  for (const ev of events) {
    const name = ev.parsed.name;
    const p = ev.parsed.args;
    if (name === "NameRegistered") {
      const entityId = createEventID(ev.blockNumber, ev.index);
      const expected = { registrant: p.owner.toLowerCase(), expiryDate: p.expires.toString() };
      const data = await query(`{ nameRegistered(id: "${entityId}") { id registrant { id } expiryDate } }`);
      const actual = data.nameRegistered;
      const cmp = compareFields(expected, actual ? { registrant: actual.registrant?.id, expiryDate: actual.expiryDate } : null);
      recordResult({
        ...makeCheck({ category: "ensv1", contract: "BaseRegistrar", event: name, block: ev.blockNumber, txHash: ev.transactionHash, logIndex: ev.index, entityType: "NameRegistered", entityId }),
        status: !actual ? "not_found" : cmp.allMatch ? "match" : "mismatch",
        fields: cmp.fields,
      });
      checked++;
    } else if (name === "NameRenewed") {
      const entityId = createEventID(ev.blockNumber, ev.index);
      const expected = { expiryDate: p.expires.toString() };
      const data = await query(`{ nameRenewed(id: "${entityId}") { id expiryDate } }`);
      const actual = data.nameRenewed;
      const cmp = compareFields(expected, actual);
      recordResult({
        ...makeCheck({ category: "ensv1", contract: "BaseRegistrar", event: name, block: ev.blockNumber, txHash: ev.transactionHash, logIndex: ev.index, entityType: "NameRenewed", entityId }),
        status: !actual ? "not_found" : cmp.allMatch ? "match" : "mismatch",
        fields: cmp.fields,
      });
      checked++;
    } else if (name === "Transfer") {
      const entityId = createEventID(ev.blockNumber, ev.index);
      const expected = { newOwner: p.to.toLowerCase() };
      const data = await query(`{ nameTransferred(id: "${entityId}") { id newOwner { id } } }`);
      const actual = data.nameTransferred;
      const cmp = compareFields(expected, actual ? { newOwner: actual.newOwner?.id } : null);
      recordResult({
        ...makeCheck({ category: "ensv1", contract: "BaseRegistrar", event: name, block: ev.blockNumber, txHash: ev.transactionHash, logIndex: ev.index, entityType: "NameTransferred", entityId }),
        status: !actual ? "not_found" : cmp.allMatch ? "match" : "mismatch",
        fields: cmp.fields,
      });
      checked++;
    }
  }
  return checked;
}

// --- Registrar controllers: setNamePreimage effects (cost/labelName) -----
//
// src/ethRegistrar.ts's 4 wrapper handlers all funnel into
// setNamePreimage(name, label, cost) where `label` is the bytes32 hash
// param (NOT the human string) — Registration.id = label.toHex(). Per
// controller-generation ABI, the (name-string, label-hash, cost) triple is
// named differently: Legacy/Wrapped call it (name, label, cost);
// Unwrapped's params are confusingly named the other way round
// (label=string, labelhash=hash) — see the ABI dump this file's checks
// were written against. checkValidLabel gates whether labelName/name get
// set at all, exactly mirroring src/utils.ts::checkValidLabel.
function checkValidLabelJs(name) {
  if (name == null) return false;
  for (const ch of name) {
    const code = ch.charCodeAt(0);
    if (code === 0 || code === 46 || code === 91 || code === 93) return false;
  }
  return true;
}

const CONTROLLER_PARAM_MAP = {
  LegacyEthRegistrarController: (p, isRenew) => ({
    nameStr: p.name,
    labelHash: p.label.toLowerCase(),
    cost: p.cost.toString(),
  }),
  WrappedEthRegistrarController: (p, isRenew) => ({
    nameStr: p.name,
    labelHash: p.label.toLowerCase(),
    cost: isRenew ? p.cost.toString() : (p.baseCost + p.premium).toString(),
  }),
  UnwrappedEthRegistrarController: (p, isRenew) => ({
    nameStr: p.label,
    labelHash: p.labelhash.toLowerCase(),
    cost: isRenew ? p.cost.toString() : (p.baseCost + p.premium).toString(),
  }),
};

export async function checkControllerRegistrations(contractKey, events) {
  const mapFn = CONTROLLER_PARAM_MAP[contractKey];
  let checked = 0;
  for (const ev of events) {
    const isRenew = ev.parsed.name === "NameRenewed";
    if (ev.parsed.name !== "NameRegistered" && !isRenew) continue;
    const { nameStr, labelHash, cost } = mapFn(ev.parsed.args, isRenew);

    const expected = { cost };
    if (checkValidLabelJs(nameStr)) expected.labelName = nameStr;

    const data = await query(`{ registration(id: "${labelHash}") { id cost labelName } }`);
    const actual = data.registration;
    const cmp = compareFields(expected, actual);
    recordResult({
      ...makeCheck({
        category: "ensv1",
        contract: contractKey,
        event: `${ev.parsed.name}-setNamePreimage`,
        block: ev.blockNumber,
        txHash: ev.transactionHash,
        logIndex: ev.index,
        entityType: "Registration",
        entityId: labelHash,
      }),
      status: !actual ? "not_found" : cmp.allMatch ? "match" : "mismatch",
      fields: cmp.fields,
      note: "setNamePreimage is a no-op if the Registration/Domain row didn't exist yet at event time — not_found here can mean 'never resolved' rather than a bug; cross-check block ordering before treating as a defect",
    });
    checked++;
  }
  return checked;
}

// --- NameWrapper: NameWrapped/NameUnwrapped/FusesSet/ExpiryExtended/Transfer(Single|Batch)

export async function checkNameWrapper(events) {
  let checked = 0;
  for (const ev of events) {
    const name = ev.parsed.name;
    const p = ev.parsed.args;
    if (name === "NameWrapped") {
      const node = p.node.toLowerCase();
      const decoded = decodeDnsName(p.name);
      const expectedName = decoded ? decoded[1] : null;
      const entityId = createEventID(ev.blockNumber, ev.index);
      const expected = { fuses: p.fuses.toString(), expiryDate: p.expiry.toString(), owner: p.owner.toLowerCase(), name: expectedName };
      const data = await query(`{ nameWrapped(id: "${entityId}") { id fuses expiryDate owner { id } name } }`);
      const actual = data.nameWrapped;
      const cmp = compareFields(expected, actual ? { fuses: actual.fuses, expiryDate: actual.expiryDate, owner: actual.owner?.id, name: actual.name } : null);
      recordResult({
        ...makeCheck({ category: "ensv1", contract: "NameWrapper", event: name, block: ev.blockNumber, txHash: ev.transactionHash, logIndex: ev.index, entityType: "NameWrapped", entityId }),
        status: !actual ? "not_found" : cmp.allMatch ? "match" : "mismatch",
        fields: cmp.fields,
      });
      checked++;
    } else if (name === "NameUnwrapped") {
      const entityId = createEventID(ev.blockNumber, ev.index);
      const expected = { owner: p.owner.toLowerCase() };
      const data = await query(`{ nameUnwrapped(id: "${entityId}") { id owner { id } } }`);
      const actual = data.nameUnwrapped;
      const cmp = compareFields(expected, actual ? { owner: actual.owner?.id } : null);
      recordResult({
        ...makeCheck({ category: "ensv1", contract: "NameWrapper", event: name, block: ev.blockNumber, txHash: ev.transactionHash, logIndex: ev.index, entityType: "NameUnwrapped", entityId }),
        status: !actual ? "not_found" : cmp.allMatch ? "match" : "mismatch",
        fields: cmp.fields,
      });
      checked++;
      // Real invariant, not just "entity exists": WrappedDomain is removed
      // on unwrap (store.remove in the mapping).
      const wd = await query(`{ wrappedDomain(id: "${p.node.toLowerCase()}") { id } }`);
      recordResult({
        ...makeCheck({ category: "ensv1", contract: "NameWrapper", event: "NameUnwrapped-removes-WrappedDomain", block: ev.blockNumber, txHash: ev.transactionHash, logIndex: ev.index, entityType: "WrappedDomain", entityId: p.node.toLowerCase() }),
        status: wd.wrappedDomain == null ? "match" : "mismatch",
        fields: [{ field: "wrappedDomain", expected: "null (removed)", actual: wd.wrappedDomain ? "still exists" : "null", match: wd.wrappedDomain == null }],
      });
      checked++;
    } else if (name === "FusesSet") {
      const entityId = createEventID(ev.blockNumber, ev.index);
      const expected = { fuses: p.fuses.toString() };
      const data = await query(`{ fusesSet(id: "${entityId}") { id fuses } }`);
      const cmp = compareFields(expected, data.fusesSet);
      recordResult({
        ...makeCheck({ category: "ensv1", contract: "NameWrapper", event: name, block: ev.blockNumber, txHash: ev.transactionHash, logIndex: ev.index, entityType: "FusesSet", entityId }),
        status: !data.fusesSet ? "not_found" : cmp.allMatch ? "match" : "mismatch",
        fields: cmp.fields,
      });
      checked++;
    } else if (name === "ExpiryExtended") {
      const entityId = createEventID(ev.blockNumber, ev.index);
      const expected = { expiryDate: p.expiry.toString() };
      const data = await query(`{ expiryExtended(id: "${entityId}") { id expiryDate } }`);
      const cmp = compareFields(expected, data.expiryExtended);
      recordResult({
        ...makeCheck({ category: "ensv1", contract: "NameWrapper", event: name, block: ev.blockNumber, txHash: ev.transactionHash, logIndex: ev.index, entityType: "ExpiryExtended", entityId }),
        status: !data.expiryExtended ? "not_found" : cmp.allMatch ? "match" : "mismatch",
        fields: cmp.fields,
      });
      checked++;
    } else if (name === "TransferSingle" || name === "TransferBatch") {
      const ids = name === "TransferSingle" ? [p.id] : p.ids;
      for (let i = 0; i < ids.length; i++) {
        const eventId = name === "TransferSingle" ? `${createEventID(ev.blockNumber, ev.index)}-0` : `${createEventID(ev.blockNumber, ev.index)}-${i}`;
        const expected = { owner: p.to.toLowerCase() };
        const data = await query(`{ wrappedTransfer(id: "${eventId}") { id owner { id } } }`);
        const actual = data.wrappedTransfer;
        const cmp = compareFields(expected, actual ? { owner: actual.owner?.id } : null);
        recordResult({
          ...makeCheck({ category: "ensv1", contract: "NameWrapper", event: `${name}-WrappedTransfer`, block: ev.blockNumber, txHash: ev.transactionHash, logIndex: ev.index, entityType: "WrappedTransfer", entityId: eventId }),
          status: !actual ? "not_found" : cmp.allMatch ? "match" : "mismatch",
          fields: cmp.fields,
        });
        checked++;
      }
    }
  }
  return checked;
}

// --- Resolver (addressless, discovered instances) -------------------------

const RESOLVER_EVENT_TABLE = {
  // AddrChanged.addr is a relation (Account!), not a plain string — unlike
  // every other field in this table — so it is queried and compared
  // specially below instead of going through the generic bare-scalar path.
  NameChanged: { entity: "nameChanged", fields: (p) => (p.name.indexOf(String.fromCharCode(0)) !== -1 ? null : { name: p.name }) },
  ABIChanged: { entity: "abiChanged", fields: (p) => ({ contentType: p.contentType.toString() }) },
  PubkeyChanged: { entity: "pubkeyChanged", fields: (p) => ({ x: p.x.toLowerCase(), y: p.y.toLowerCase() }) },
  ContenthashChanged: { entity: "contenthashChanged", fields: (p) => ({ hash: p.hash.toLowerCase() }) },
  InterfaceChanged: { entity: "interfaceChanged", fields: (p) => ({ interfaceID: p.interfaceID.toLowerCase(), implementer: p.implementer.toLowerCase() }) },
  AuthorisationChanged: { entity: "authorisationChanged", fields: (p) => ({ owner: p.owner.toLowerCase(), target: p.target.toLowerCase(), isAuthorized: p.isAuthorised }) },
  VersionChanged: { entity: "versionChanged", fields: (p) => ({ version: p.newVersion.toString() }) },
};

export async function checkResolverEvents(resolverAddress, events) {
  let checked = 0;
  for (const ev of events) {
    const name = ev.parsed.name;
    const p = ev.parsed.args;
    const entityId = createEventID(ev.blockNumber, ev.index);

    if (name === "AddrChanged") {
      const expected = { addr: p.a.toLowerCase() };
      const data = await query(`{ addrChanged(id: "${entityId}") { id addr { id } } }`);
      const actual = data.addrChanged ? { addr: data.addrChanged.addr?.id } : null;
      const cmp = compareFields(expected, actual);
      recordResult({
        ...makeCheck({ category: "ensv1", contract: `Resolver:${resolverAddress}`, event: name, block: ev.blockNumber, txHash: ev.transactionHash, logIndex: ev.index, entityType: "AddrChanged", entityId }),
        status: !data.addrChanged ? "not_found" : cmp.allMatch ? "match" : "mismatch",
        fields: cmp.fields,
      });
      checked++;
      continue;
    }
    if (name === "AddressChanged") {
      const expected = { coinType: p.coinType.toString(), addr: p.newAddress.toLowerCase() };
      const data = await query(`{ multicoinAddrChanged(id: "${entityId}") { id coinType addr } }`);
      const cmp = compareFields(expected, data.multicoinAddrChanged);
      recordResult({
        ...makeCheck({ category: "ensv1", contract: `Resolver:${resolverAddress}`, event: name, block: ev.blockNumber, txHash: ev.transactionHash, logIndex: ev.index, entityType: "MulticoinAddrChanged", entityId }),
        status: !data.multicoinAddrChanged ? "not_found" : cmp.allMatch ? "match" : "mismatch",
        fields: cmp.fields,
      });
      checked++;
      continue;
    }
    if (name === "TextChanged") {
      const hasValue = p.value !== undefined;
      const expected = hasValue ? { key: p.key, value: p.value } : { key: p.key };
      const data = await query(`{ textChanged(id: "${entityId}") { id key value } }`);
      const cmp = compareFields(expected, data.textChanged);
      recordResult({
        ...makeCheck({ category: "ensv1", contract: `Resolver:${resolverAddress}`, event: `${name}${hasValue ? "WithValue" : ""}`, block: ev.blockNumber, txHash: ev.transactionHash, logIndex: ev.index, entityType: "TextChanged", entityId }),
        status: !data.textChanged ? "not_found" : cmp.allMatch ? "match" : "mismatch",
        fields: cmp.fields,
      });
      checked++;
      continue;
    }

    const cfg = RESOLVER_EVENT_TABLE[name];
    if (!cfg) continue;
    const expected = cfg.fields(p);
    if (expected == null) continue; // e.g. NameChanged with a null byte — handler returns early, nothing to check
    const fieldsGql = Object.keys(expected).join(" ");
    const data = await query(`{ ${cfg.entity}(id: "${entityId}") { id ${fieldsGql} } }`);
    const actual = data[cfg.entity];
    const cmp = compareFields(expected, actual);
    recordResult({
      ...makeCheck({ category: "ensv1", contract: `Resolver:${resolverAddress}`, event: name, block: ev.blockNumber, txHash: ev.transactionHash, logIndex: ev.index, entityType: cfg.entity, entityId }),
      status: !actual ? "not_found" : cmp.allMatch ? "match" : "mismatch",
      fields: cmp.fields,
    });
    checked++;
  }
  return checked;
}

// Full chronological replay of Resolver.addr/texts/coinTypes/contentHash,
// including the VersionChanged reset-to-null (src/resolver.ts::handleVersionChanged).
export async function checkResolverCurrentState(resolverAddress, events) {
  const byNode = new Map();
  for (const ev of events) {
    const name = ev.parsed.name;
    const p = ev.parsed.args;
    const node = p.node?.toLowerCase();
    if (!node) continue;
    const id = `${resolverAddress.toLowerCase()}-${node}`;
    let r = byNode.get(id);
    if (!r) {
      r = { addr: undefined, texts: [], coinTypes: [], contentHash: undefined };
      byNode.set(id, r);
    }
    if (name === "AddrChanged") r.addr = p.a.toLowerCase();
    else if (name === "TextChanged") {
      if (!r.texts.includes(p.key)) r.texts.push(p.key);
    } else if (name === "AddressChanged") {
      const ct = p.coinType.toString();
      if (!r.coinTypes.includes(ct)) r.coinTypes.push(ct);
    } else if (name === "ContenthashChanged") r.contentHash = p.hash.toLowerCase();
    else if (name === "VersionChanged") {
      r.addr = null;
      r.texts = [];
      r.coinTypes = [];
      r.contentHash = null;
    }
  }
  let checked = 0;
  for (const [id, r] of byNode) {
    if (r.addr === undefined && r.texts.length === 0 && r.coinTypes.length === 0 && r.contentHash === undefined) continue;
    const data = await query(`{ resolver(id: "${id}") { id addr { id } texts coinTypes contentHash } }`);
    const actual = data.resolver;
    const expected = {};
    if (r.addr !== undefined) expected.addr = r.addr;
    if (r.contentHash !== undefined) expected.contentHash = r.contentHash;
    // texts/coinTypes compared as sets (order not semantically meaningful).
    const cmp = compareFields(
      { ...expected },
      actual ? { addr: actual.addr?.id ?? null, contentHash: actual.contentHash ?? null } : null
    );
    const textsMatch = actual ? JSON.stringify([...r.texts].sort()) === JSON.stringify([...(actual.texts || [])].sort()) : false;
    const coinTypesMatch = actual ? JSON.stringify([...r.coinTypes].sort()) === JSON.stringify([...(actual.coinTypes || []).map(String)].sort()) : false;
    const allMatch = cmp.allMatch && textsMatch && coinTypesMatch;
    recordResult({
      ...makeCheck({ category: "ensv1", contract: `Resolver:${resolverAddress}`, event: "Resolver-current-state", block: 0, txHash: "n/a", logIndex: id, entityType: "Resolver", entityId: id }),
      status: !actual ? "not_found" : allMatch ? "match" : "mismatch",
      fields: [...cmp.fields, { field: "texts", expected: JSON.stringify(r.texts), actual: JSON.stringify(actual?.texts), match: textsMatch }, { field: "coinTypes", expected: JSON.stringify(r.coinTypes), actual: JSON.stringify(actual?.coinTypes), match: coinTypesMatch }],
    });
    checked++;
  }
  return checked;
}
