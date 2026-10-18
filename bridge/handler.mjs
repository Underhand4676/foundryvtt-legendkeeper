import { timingSafeEqual } from 'node:crypto';

const MAX_RESOURCES = 5000;
const PAGE_SIZE = 100;

function validId(id) { return /^[A-Za-z0-9_-]{1,128}$/.test(id ?? ''); }
function respond(res, status, payload) {
  res.writeHead(status, {
    'content-type': 'application/json; charset=utf-8',
    'cache-control': 'no-store',
    'x-content-type-options': 'nosniff',
    'referrer-policy': 'no-referrer'
  });
  res.end(JSON.stringify(payload));
}
function tokenMatches(candidate, expected) {
  const a = Buffer.from(candidate ?? '');
  const b = Buffer.from(expected);
  return a.length === b.length && timingSafeEqual(a, b);
}

/** Each project has its own bearer token. There is no cross-project master token. */
export function createHandler({ projects, allowedOrigins }) {
  if (!(projects instanceof Map) || !projects.size) throw new Error('Configure at least one project.');
  if (!(allowedOrigins instanceof Set) || !allowedOrigins.size) throw new Error('Configure ALLOWED_ORIGINS.');
  for (const [alias, project] of projects) {
    if (!/^[a-z0-9_-]{1,64}$/.test(alias) || !project?.client || !/^[a-f0-9]{64}$/i.test(project?.bridgeToken ?? '')) {
      throw new Error(`Project ${alias}: bridgeToken must be 64 hex characters.`);
    }
  }
  return async function handler(req, res) {
    const origin = req.headers.origin;
    if (origin && !allowedOrigins.has(origin)) return respond(res, 403, { error: 'Origin not allowed.' });
    if (origin) {
      res.setHeader('Access-Control-Allow-Origin', origin);
      res.setHeader('Vary', 'Origin');
      res.setHeader('Access-Control-Allow-Headers', 'Authorization');
      res.setHeader('Access-Control-Allow-Methods', 'GET, OPTIONS');
    }
    if (req.method === 'OPTIONS') { res.writeHead(204); return res.end(); }
    if (req.method === 'GET' && req.url === '/health') return respond(res, 200, { ok: true });
    if (req.method !== 'GET') return respond(res, 405, { error: 'Read-only bridge.' });
    const url = new URL(req.url ?? '/', 'http://bridge.local');
    const project = projects.get(url.searchParams.get('project') ?? '');
    const header = req.headers.authorization ?? '';
    const candidate = header.startsWith('Bearer ') ? header.slice(7) : '';
    // Avoid disclosing whether an alias exists before authentication.
    if (!project || !tokenMatches(candidate, project.bridgeToken)) {
      return respond(res, 401, { error: 'Bridge credential is invalid for this project.' });
    }
    const lk = project.client;
    const parts = url.pathname.split('/').filter(Boolean);
    try {
      if (url.pathname === '/api/project') return respond(res, 200, await lk.project());
      if (url.pathname === '/api/resources') {
        const data = [];
        const cursors = new Set();
        let cursor;
        while (true) {
          const page = await lk.resources.list({ limit: PAGE_SIZE, ...(cursor ? { cursor } : {}) });
          if (!Array.isArray(page?.data)) throw new Error('Unexpected resources response.');
          if (data.length + page.data.length > MAX_RESOURCES) {
            return respond(res, 413, { error: `Project exceeds the ${MAX_RESOURCES}-resource limit.` });
          }
          data.push(...page.data);
          if (!page.hasMore) break;
          if (!page.nextCursor || cursors.has(page.nextCursor)) throw new Error('Invalid pagination cursor.');
          cursors.add(page.nextCursor);
          cursor = page.nextCursor;
        }
        return respond(res, 200, { data });
      }
      if (parts[0] === 'api' && parts[1] === 'resource' && parts.length === 3 && validId(parts[2])) {
        return respond(res, 200, await lk.resources.get({ resourceId: parts[2] }));
      }
      if (parts[0] === 'api' && parts[1] === 'document' && parts.length === 4 && validId(parts[2]) && validId(parts[3])) {
        return respond(res, 200, await lk.documents.getBlocks({ resourceId: parts[2], documentId: parts[3] }));
      }
      if (url.pathname === '/api/search') {
        const q = (url.searchParams.get('q') ?? '').trim();
        if (!q || q.length > 150) return respond(res, 400, { error: 'Search must contain 1–150 characters.' });
        const results = await lk.search.search({ q, limit: 50 });
        return respond(res, 200, { data: results.data });
      }
      return respond(res, 404, { error: 'Unknown endpoint.' });
    } catch (error) {
      console.error('LegendKeeper request failed', { name: error?.name, code: error?.code, status: error?.status });
      return respond(res, 502, { error: 'LegendKeeper API request failed. Check the bridge logs.' });
    }
  };
}
