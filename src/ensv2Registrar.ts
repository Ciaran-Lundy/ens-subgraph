// ETHRegistrar enrichment stubs. Real logic (duration/paymentToken/referrer/
// base/premium correlated onto ENSv2Registration by tx hash) is Phase 6.
import {
  NameRegistered,
  NameRenewed,
} from "./types/ETHRegistrar/ETHRegistrar";

export function handleNameRegistered(event: NameRegistered): void {}

export function handleNameRenewed(event: NameRenewed): void {}
