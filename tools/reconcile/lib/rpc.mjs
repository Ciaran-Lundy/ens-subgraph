import { JsonRpcProvider } from "ethers";
import { RPC_URL, MAX_LOG_RANGE } from "../config.mjs";

export const provider = new JsonRpcProvider(RPC_URL);

async function withRetry(fn, label, attempts = 5) {
  let lastErr;
  for (let i = 0; i < attempts; i++) {
    try {
      return await fn();
    } catch (err) {
      lastErr = err;
      const backoffMs = 1000 * 2 ** i;
      process.stderr.write(
        `  [retry] ${label} failed (${err.message || err}), waiting ${backoffMs}ms (attempt ${i + 1}/${attempts})\n`
      );
      await new Promise((r) => setTimeout(r, backoffMs));
    }
  }
  throw lastErr;
}

// Result-count cap confirmed live on RPC_URL this session: "Query returned
// more than 20000 results" for a bounded numeric range, even well inside
// MAX_LOG_RANGE — block density isn't uniform (a range can be way under
// the block-count cap and still exceed the result-count cap), so a fixed
// chunk size isn't enough; this recursively halves on that specific error
// rather than assuming any one window size is always safe. Never pass the
// string "latest" as toBlock here or anywhere in this tool — this session
// found RPC_URL's toBlock:"latest" path returns wrong (too-few) results
// for a query that returns correct results with the identical range passed
// as an explicit block number; every caller resolves "latest" via
// getBlockNumber() first instead.
function isTooManyResultsError(err) {
  const msg = String(err?.info?.error?.data || err?.error?.data || err.message || err);
  return /more than \d+ results/i.test(msg);
}

async function getLogsRange(address, fromBlock, toBlock, topics) {
  try {
    // One unretried attempt first — a "too many results" error is
    // deterministic (retrying with backoff can't fix it, only splitting
    // the range can), so detect and split immediately rather than wasting
    // multiple backoff delays on an error retrying will never resolve.
    return await provider.getLogs({ address, fromBlock, toBlock, topics });
  } catch (err) {
    if (isTooManyResultsError(err) && toBlock > fromBlock) {
      const mid = fromBlock + Math.floor((toBlock - fromBlock) / 2);
      const left = await getLogsRange(address, fromBlock, mid, topics);
      const right = await getLogsRange(address, mid + 1, toBlock, topics);
      return [...left, ...right];
    }
    if (isTooManyResultsError(err)) throw err; // fromBlock === toBlock: can't split further
    // Any other error (network blip, rate limit, etc.) — real retry with backoff.
    return withRetry(
      () => provider.getLogs({ address, fromBlock, toBlock, topics }),
      `getLogs(${address}, ${fromBlock}-${toBlock})`
    );
  }
}

// Fetches logs for one address across [fromBlock, toBlock], chunked to
// MAX_LOG_RANGE per call as a starting point, then recursively halved by
// getLogsRange on a result-count-cap error. Returns raw ethers Log
// objects, undecoded — callers decode with the relevant ethers.Interface.
export async function getLogsChunked(address, fromBlock, toBlock, topics = undefined) {
  const logs = [];
  for (let start = fromBlock; start <= toBlock; start += MAX_LOG_RANGE) {
    const end = Math.min(start + MAX_LOG_RANGE - 1, toBlock);
    logs.push(...(await getLogsRange(address, start, end, topics)));
  }
  return logs;
}

export async function getBlock(blockNumber) {
  return withRetry(() => provider.getBlock(blockNumber), `getBlock(${blockNumber})`);
}

export async function getTransactionReceipt(hash) {
  return withRetry(
    () => provider.getTransactionReceipt(hash),
    `getTransactionReceipt(${hash})`
  );
}

export async function getBlockNumber() {
  return withRetry(() => provider.getBlockNumber(), "getBlockNumber()");
}
