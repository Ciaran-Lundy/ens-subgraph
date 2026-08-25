// ENSv2-specific resolver event stubs. PermissionedResolver's standard
// ENSIP events (AddrChanged, TextChanged, etc.) need no new wiring here —
// they're identically signatured to the existing ENSv1 Resolver ABI, so the
// existing addressless "Resolver" data source (src/resolver.ts) already
// picks them up (addressless sources match by event topic0 network-wide,
// not by contract address/ABI). Wiring them again on this data source would
// double-process every standard event a PermissionedResolver contract emits.
// Real logic for the events below is Phase 7 (+ Phase 8 for EACRolesChanged,
// shared with ensv2Registry.ts's role handling).
import {
  AliasChanged,
  DataChanged,
  EACRolesChanged,
  NamedAddrResource,
  NamedDataResource,
  NamedResource,
  NamedTextResource,
} from "./types/PermissionedResolver/PermissionedResolver";

export function handleAliasChanged(event: AliasChanged): void {}

export function handleNamedResource(event: NamedResource): void {}

export function handleNamedTextResource(event: NamedTextResource): void {}

export function handleNamedDataResource(event: NamedDataResource): void {}

export function handleNamedAddrResource(event: NamedAddrResource): void {}

export function handleDataChanged(event: DataChanged): void {}

export function handleEACRolesChanged(event: EACRolesChanged): void {}
