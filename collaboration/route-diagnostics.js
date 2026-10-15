// Compare content only at the same CRDT version; ordinary in-flight edits are not mismatches.
export async function routeFingerprint(document) {
  const version = document.versionKey(), canonical = document.canonical();
  const hash = async text => Array.from(new Uint8Array(await crypto.subtle.digest('SHA-256', new TextEncoder().encode(text))), n => n.toString(16).padStart(2, '0')).join('');
  const [vectorHash, contentHash] = await Promise.all([hash(version), hash(canonical)]);
  return {vectorHash, contentHash};
}
export function compareFingerprints(local, remote) {
  if (!local || !remote || local.vectorHash !== remote.vectorHash) return 'syncing';
  return local.contentHash === remote.contentHash ? 'synced' : 'mismatch';
}
