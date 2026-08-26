// Addresses/startBlocks copied from ../../networks.json's "sepolia" block —
// the exact values the ens-v-2-test deployment was built with (verified
// via `graph deploy --network sepolia`, docs/phases/sepolia-deployment.md).
// NOT https://ethereum-sepolia-rpc.publicnode.com — this session found its
// eth_getLogs (and eth_getTransactionReceipt) silently return empty/null
// for confirmed transactions/blocks with real events (verified: a block
// the subgraph itself reported an event in, with 144 real transactions,
// came back with zero logs network-wide — no error, just wrong). Tenderly's
// public gateway returned the correct logs for the exact same
// address/block. Confirmed live: a single eth_getLogs call spanning
// ENSRegistry's full ~7.86M-block history (its real startBlock to "latest")
// succeeded in one shot, no chunking needed and no range-limit error.
export const RPC_URL = "https://gateway.tenderly.co/public/sepolia";
export const SUBGRAPH_URL =
  "https://api.studio.thegraph.com/query/1723028/ens-v-2-test/v0.2.0";

// Kept as a defensive chunking cap (some providers silently truncate wide
// ranges instead of erroring) even though Tenderly's gateway handled a
// ~7.86M-block single-address range in one call with no complaint.
export const MAX_LOG_RANGE = 500000;

export const CONTRACTS = {
  ENSRegistry: {
    address: "0x00000000000C2E074eC69A0dFb2997BA6C7d2e1e",
    startBlock: 3702728,
    abi: "Registry.json",
  },
  ENSRegistryOld: {
    address: "0x94f523b8261B815b87EFfCf4d18E6aBeF18d6e4b",
    startBlock: 3702721,
    abi: "Registry.json",
  },
  BaseRegistrar: {
    address: "0x57f1887a8BF19b14fC0dF6Fd9B2acc9Af147eA85",
    startBlock: 3702731,
    abi: "BaseRegistrar.json",
  },
  LegacyEthRegistrarController: {
    address: "0x7e02892cfc2Bfd53a75275451d73cF620e793fc0",
    startBlock: 3790197,
    abi: "LegacyEthRegistrarController.json",
  },
  WrappedEthRegistrarController: {
    address: "0xFED6a969AaA60E4961FCD3EBF1A2e8913ac65B72",
    startBlock: 3790244,
    abi: "WrappedEthRegistrarController.json",
  },
  NameWrapper: {
    address: "0x0635513f179D50A207757E05759CbD106d7dFcE8",
    startBlock: 3790153,
    abi: "NameWrapper.json",
  },
  UnwrappedEthRegistrarController: {
    address: "0xfb3cE5D01e0f33f41DbB39035dB9745962F1f968",
    startBlock: 8579988,
    abi: "UnwrappedEthRegistrarController.json",
  },
  RootRegistry: {
    address: "0xc960F7217d3643B525Ef36Bec8Adf86953CD9aB8",
    startBlock: 11465480,
    abi: "PermissionedRegistry.json",
  },
  ETHRegistry: {
    address: "0xDEDB92913A25abE1f7BCDD85D8A344a43B398B67",
    startBlock: 11465480,
    abi: "PermissionedRegistry.json",
  },
  ETHRegistrar: {
    address: "0x8c2E866B439358c41AE05De9cbE8A00BFEFafFcA",
    startBlock: 11479218,
    abi: "ETHRegistrar.json",
  },
  VerifiableFactory: {
    address: "0xD2a632D8a8b67c2c4398c255CbD7aF8dd7236198",
    startBlock: 11465480,
    abi: "VerifiableFactory.json",
  },
};

// Real ENSv2 migration-controller addresses (src/ensv2Constants.ts,
// getMigrationControllers() sepolia branch).
export const MIGRATION_CONTROLLERS = [
  "0xF91c34ED840889Ed96F806f882fD50506A336Edb",
  "0x056138Ef5660F7113a3B0ADC08ac3683310e7FBC",
].map((a) => a.toLowerCase());

// ENSv2 v2 grace period (src/ensv2Constants.ts, getV2GracePeriod()): 28 days.
export const V2_GRACE_PERIOD_SECONDS = 28n * 24n * 60n * 60n;

// ENSv1 grace period (src/ethRegistrar.ts, GRACE_PERIOD_SECONDS): 90 days.
export const V1_GRACE_PERIOD_SECONDS = 90n * 24n * 60n * 60n;

// namehash("eth") (src/utils.ts::ETH_NODE) and the zero root node
// (src/utils.ts::ROOT_NODE).
export const ETH_NODE =
  "0x93cdeb708b7545dc668eb9280176169d1c33cfd8ed6f04690a0bcc88a93fc4ae";
export const ROOT_NODE =
  "0x0000000000000000000000000000000000000000000000000000000000000000";

export const ZERO_ADDRESS = "0x0000000000000000000000000000000000000000";
