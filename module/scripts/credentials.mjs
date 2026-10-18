/** Pure helpers. Browser credentials are stored in a private GM client setting, never world settings. */
export function normalizedBridgeUrl(raw) {
  const url = new URL(String(raw ?? '').trim());
  if (url.username || url.password || url.search || url.hash || url.pathname !== '/') {
    throw new Error('Use only the bridge origin, such as https://lkbridge.example.com');
  }
  const local = ['localhost', '127.0.0.1', '[::1]'].includes(url.hostname);
  if (url.protocol !== 'https:' && !(url.protocol === 'http:' && local)) {
    throw new Error('A remote bridge requires HTTPS.');
  }
  return url.origin;
}
export function connectionKey({ base, worldId, alias }) {
  if (!/^[a-z0-9_-]{1,64}$/.test(alias ?? '')) throw new Error('Invalid LegendKeeper project alias.');
  if (!worldId) throw new Error('A Foundry world must be loaded.');
  return JSON.stringify([worldId, normalizedBridgeUrl(base), alias]);
}
export function getPairedToken(store, key) {
  const token = store && typeof store === 'object' ? store[key] : '';
  return typeof token === 'string' ? token : '';
}
export function updatePairings(store, key, token) {
  const output = { ...(store && typeof store === 'object' ? store : {}) };
  if (token) output[key] = token;
  else delete output[key];
  return output;
}
