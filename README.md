# ENS Subgraph

This Subgraph sources events from the ENS contracts. This includes the ENS registry, the Auction Registrar, and any resolvers that are created and linked to domains. The resolvers are added through dynamic data sources. More information on all of this can be found at [The Graph Documentation](https://thegraph.com/docs/developer/quick-start/).

As of the ENSv2 upgrade, it also indexes the ENSv2 registry/registrar/resolver contracts directly. See "Querying ENSv2" below for the query contract that upgrade adds.

# Example Queries (ENSv1 — `Domain`/`Registration`/`Resolver`)

Here we have example queries, so that you don't have to type them in yourself eachtime in the graphiql playground:

```graphql
{
  domains {
    id
    labelName
    labelhash
    parent {
      id
    }
    subdomains {
      id
    }
    owner {
      id
    }
    resolver {
      id
    }
    ttl
  }
  resolvers {
    id
    address
    domain {
      id
    }
    events {
      id
      ... on AddrChanged {
        addr {
          id
        }
      }
      ... on NameChanged {
        name
      }
      ... on AbiChanged {
        contentType
      }
      ... on PubkeyChanged {
        x
        y
      }
      ... on TextChanged {
        indexedKey
        key
      }
      ... on ContenthashChanged {
        hash
      }
      ... on InterfaceChanged {
        interfaceID
        implementer
      }
      ... on AuthorisationChanged {
        owner
        target
        isAuthorized
      }
    }
  }
  registrations(where: { labelName_not: null }, orderBy: expiryDate, orderDirection: asc, first: 10, skip: 0) {
    expiryDate
    labelName
    domain{
      name
      labelName
    }
  }
}

```

(This fixes a staleness bug in the previous version of this example: `events { node ... on AddrChanged { a } }` referenced fields that no longer exist on the current schema — `ResolverEvent` has no top-level `node` field, and `AddrChanged.addr` is an `Account` relation, not a raw value named `a`.)

# Querying ENSv2

The ENSv2 upgrade added a second, parallel set of entities (`ENSv2Registry`, `ENSv2NameSlot`, `ENSv2Namespace`, `ENSv2NamePath`, `ENSv2Registration`, `ENSv2Resolver`, `ENSv2RoleAssignment`, and friends) that index the ENSv2 registry/registrar/resolver contracts directly. `Domain`, `Registration`, and `Resolver` above keep working unchanged for existing consumers, but they are a **projection**, not the full ENSv2 data model. Read this before building anything new against ENSv2 data:

- **`Domain` is a backwards-compatibility projection, not the complete ENSv2 data model.** It's derived from `ENSv2NamePath` rows, which are themselves a materialized-path projection — not a complete existence index for every name reachable through ENSv2.
- **A missing `Domain` or `ENSv2NamePath` row does not mean a name is invalid or unregistered.** When a registry is linked under a parent *after* it already has registrations ("late-linking"), those pre-existing registrations are deliberately never backfilled into `Domain`/`ENSv2NamePath` — that's a bounded-cost guarantee, not a bug. They're still reachable through `ENSv2Namespace`, `ENSv2NamespaceLink`, and `ENSv2NameSlot`.
- **For full ENSv2 coverage, query the registry/namespace/slot graph directly** rather than relying only on `Domain`/`ENSv2NamePath`.
- **Labels are stored exactly as emitted by ENSv2 registry events.** The subgraph does not expose a `normalizedLabel` field and does not perform ENSIP-15 normalization in mappings — normalize user input client-side before hashing or querying by name.
- **`Resolver`/`ENSv2Resolver` remain direct-record projections.** They reflect records set directly on a resolver address + node, but are not authoritative for *effective* resolution when an ENSv2 alias is active. Check `ENSv2ResolverAlias` for the name you're resolving, or call `PermissionedResolver.resolve()` directly for exact resolver behavior.
- **Migrated `.eth` names carry both legacy and ENSv2 state.** Once a migrated name reaches `REGISTERED` status, ENSv2 events keep the legacy `Registration`/`Domain`/`WrappedDomain` owner and expiry fields in sync going forward — `domain.owner` itself is never corrected (it reflects the real, retired ENSv1 registry state), only `wrappedOwner`/`registrant`. `Registration.expiryDate` stays the raw ENSv2 expiry; `Domain.expiryDate` includes the ENSv2 grace period on top of it.

Note on query field casing: graph-node derives root query field names from entity type names by lowercasing only the *first* character, not full camelCase conversion. So `ENSv2Registry` becomes `eNSv2Registry`/`eNSv2Registries`, not `ensv2Registry` — every entity type in this schema prefixed `ENSv2...` follows that same, slightly surprising pattern below.

## Example query: registry → namespace → slot graph

```graphql
{
  eNSv2Registries(where: { kind: ETH }) {
    id
    kind
    namespaceCount
    namespaces {
      id
      baseName
      active
    }
  }
  eNSv2NameSlots(where: { status: REGISTERED }, first: 10) {
    id
    label
    owner {
      id
    }
    expiryDate
    subregistry {
      id
    }
    paths {
      name
      domain {
        id
      }
    }
  }
}
```

## Example query: a resource and its role assignments

```graphql
{
  eNSv2Resource(id: "<registry-address>-<resource>") {
    id
    slot {
      id
      label
    }
    active
  }
  eNSv2RoleAssignments(where: { resourceEntity: "<registry-address>-<resource>" }) {
    id
    account {
      id
    }
    roleBitmap
  }
}
```

## Example query: effective resolution via an ENSv2 alias

```graphql
{
  eNSv2ResolverAliases(where: { active: true }) {
    id
    fromNameDecoded
    toNameDecoded
  }
}
```
