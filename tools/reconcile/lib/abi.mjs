import { readFileSync } from "node:fs";
import { fileURLToPath } from "node:url";
import path from "node:path";
import { Interface } from "ethers";

const __dirname = path.dirname(fileURLToPath(import.meta.url));
const ABIS_DIR = path.join(__dirname, "..", "..", "..", "abis");

const cache = new Map();

// Reuses the subgraph's own abis/*.json — the exact same files the manifest
// binds — rather than a separately-maintained copy, so this tool can never
// drift from what the subgraph is actually decoding events with.
export function loadInterface(abiFileName) {
  if (cache.has(abiFileName)) return cache.get(abiFileName);
  const abi = JSON.parse(readFileSync(path.join(ABIS_DIR, abiFileName), "utf8"));
  const iface = new Interface(abi);
  cache.set(abiFileName, iface);
  return iface;
}
