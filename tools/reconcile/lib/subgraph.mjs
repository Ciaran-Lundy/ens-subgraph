import { SUBGRAPH_URL } from "../config.mjs";

// Studio's endpoint rate-limits under this tool's sustained sequential
// query volume — confirmed live: it returns a plain-text "Too many
// requests" body (not JSON) once triggered, which crashed a bare
// `res.json()` call with a confusing SyntaxError rather than a clear
// rate-limit signal. Once triggered on this session's free-tier
// deployment, it did NOT clear within ~9 minutes of waiting (several
// cooldown attempts, up to 5 minutes each) — this is a sustained
// block/quota, not a short burst window, and 6 retries with exponential
// backoff (up to ~63s total) inside one run was nowhere near enough. The
// one real fix is not re-triggering it: this spacing is set deliberately
// conservative (a ~2000-request run at 120ms spacing still tripped it) —
// widen further if it trips again, and expect a full sweep to take
// noticeably longer as a result; that's the real cost of this endpoint's
// limit, not a bug in the pacing logic itself.
const MIN_INTERVAL_MS = 400;
let lastCallAt = 0;
async function pace() {
  const wait = lastCallAt + MIN_INTERVAL_MS - Date.now();
  if (wait > 0) await new Promise((r) => setTimeout(r, wait));
  lastCallAt = Date.now();
}

export async function query(gql, variables = {}, attempt = 1) {
  await pace();
  const res = await fetch(SUBGRAPH_URL, {
    method: "POST",
    headers: { "Content-Type": "application/json" },
    body: JSON.stringify({ query: gql, variables }),
  });
  const text = await res.text();
  let json;
  try {
    json = JSON.parse(text);
  } catch {
    if (attempt <= 6) {
      const backoffMs = 1000 * 2 ** (attempt - 1);
      process.stderr.write(
        `  [retry] subgraph query non-JSON response (likely rate-limited: "${text.slice(0, 60)}"), waiting ${backoffMs}ms (attempt ${attempt}/6)\n`
      );
      await new Promise((r) => setTimeout(r, backoffMs));
      return query(gql, variables, attempt + 1);
    }
    throw new Error(`Subgraph returned non-JSON after retries: ${text.slice(0, 200)}`);
  }
  if (json.errors) {
    throw new Error(`Subgraph query error: ${JSON.stringify(json.errors)}`);
  }
  return json.data;
}

// Cursor-paginated fetch of every row of a list field, past graph-node's
// 5000-row `skip` ceiling — needed here because some entity lists (e.g.
// legacy Resolver rows, one per address+node) run past the 1000-row single
// page this tool otherwise uses elsewhere. `fieldSelector` is the field
// list inside `{ }`; must include `id`.
export async function queryAll(entityField, fieldSelector) {
  const rows = [];
  let lastId = "";
  for (;;) {
    const data = await query(
      `{ ${entityField}(first: 1000, orderBy: id, orderDirection: asc, where: { id_gt: "${lastId}" }) { ${fieldSelector} } }`
    );
    const page = data[entityField];
    rows.push(...page);
    if (page.length < 1000) break;
    lastId = page[page.length - 1].id;
  }
  return rows;
}
