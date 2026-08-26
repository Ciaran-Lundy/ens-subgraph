// Port of src/nameWrapper.ts::decodeName — parses DNS-wire-encoded bytes
// into [firstLabel, fullDottedName], returning null if any label fails
// checkValidLabel (null byte / '.' / '[' / ']'). event.params.name on
// NameWrapped is passed as these DNS-wire bytes directly, so this needs no
// external hash-reversal (unlike Domain.name/labelName elsewhere in
// ENSv1, which use graph-node's built-in ens.nameByHash() reverse lookup —
// not independently reproducible by this tool; documented in README).
function checkValidLabel(name) {
  if (name == null) return false;
  for (const ch of name) {
    const code = ch.charCodeAt(0);
    if (code === 0 || code === 46 || code === 91 || code === 93) return false;
  }
  return true;
}

export function decodeDnsName(hexBytes) {
  const bytes = Buffer.from(hexBytes.slice(2), "hex");
  let offset = 0;
  let firstLabel = "";
  const parts = [];
  let len = bytes[offset++];
  if (len === 0) return [firstLabel, "."];
  while (len) {
    const labelBytes = bytes.subarray(offset, offset + len);
    const label = labelBytes.toString("utf8");
    if (!checkValidLabel(label)) return null;
    parts.push(label);
    if (parts.length === 1) firstLabel = label;
    offset += len;
    len = bytes[offset++];
  }
  return [firstLabel, parts.join(".")];
}
