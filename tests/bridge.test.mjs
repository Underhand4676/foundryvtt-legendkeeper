import test from 'node:test';
import assert from 'node:assert/strict';
import http from 'node:http';
import { createHandler } from '../bridge/handler.mjs';

const rakvaToken = 'a'.repeat(64);
const starwarsToken = 'b'.repeat(64);
const origin = 'https://foundry.example.org';
const calls = [];
const projects = new Map([
  ['rakva', { bridgeToken: rakvaToken, client: {
    project: async () => ({ name: 'Rakva', id: 'project_r' }),
    resources: {
      list: async ({ cursor }) => {
        calls.push(cursor || '<first>');
        if (!cursor) return { data: [{ id: 'entry1', name: 'City', parentId: null }], hasMore: true, nextCursor: 'abc' };
        return { data: [{ id: 'entry2', name: 'Forest', parentId: null }], hasMore: false, nextCursor: null };
      },
      get: async ({ resourceId }) => ({ id: resourceId, name: 'City', documents: [] })
    },
    documents: { getBlocks: async () => ({ blocks: [], text: 'Hello' }) },
    search: { search: async ({ q }) => ({ data: [{ resource: { id: 'entry1', name: q } }] }) }
  }}],
  ['starwars', { bridgeToken: starwarsToken, client: { project: async () => ({ name: 'Star Wars' }) } }]
]);

async function withServer(run, instance = projects) {
  const server = http.createServer(createHandler({ projects: instance, allowedOrigins: new Set([origin]) }));
  await new Promise(resolve => server.listen(0, '127.0.0.1', resolve));
  try { await run(`http://127.0.0.1:${server.address().port}`); }
  finally { await new Promise(resolve => server.close(resolve)); }
}
async function req(url, headers = {}, method = 'GET') {
  const result = await fetch(url, { headers, method });
  return { status: result.status, body: result.status === 204 ? null : await result.json(), headers: result.headers };
}
const auth = (token, extras = {}) => ({ authorization: `Bearer ${token}`, ...extras });

test('per-project credentials cannot cross into another project', async () => {
  await withServer(async url => {
    assert.equal((await req(`${url}/api/project?project=rakva`)).status, 401);
    assert.equal((await req(`${url}/api/project?project=rakva`, auth(starwarsToken))).status, 401);
    assert.equal((await req(`${url}/api/project?project=starwars`, auth(rakvaToken))).status, 401);
    assert.equal((await req(`${url}/api/project?project=nonexistent`, auth(rakvaToken))).status, 401);
    assert.equal((await req(`${url}/api/project?project=starwars`, auth(starwarsToken))).body.name, 'Star Wars');
    assert.equal((await req(`${url}/api/project?project=rakva`, auth(rakvaToken))).body.name, 'Rakva');
  });
});

test('paginates using SDK nextCursor; supports document, search and resource reads', async () => {
  calls.length = 0;
  await withServer(async url => {
    const headers = auth(rakvaToken, { origin });
    const tree = await req(`${url}/api/resources?project=rakva`, headers);
    assert.deepEqual(tree.body.data.map(x => x.name), ['City', 'Forest']);
    assert.deepEqual(calls, ['<first>', 'abc']);
    assert.equal((await req(`${url}/api/resource/entry1?project=rakva`, headers)).body.id, 'entry1');
    assert.equal((await req(`${url}/api/document/entry1/doc1?project=rakva`, headers)).body.text, 'Hello');
    assert.equal((await req(`${url}/api/search?project=rakva&q=Tower`, headers)).body.data[0].resource.name, 'Tower');
    assert.equal((await req(`${url}/api/search?project=rakva&q=`, headers)).status, 400);
    assert.equal((await req(`${url}/api/resource/%3Cbad%3E?project=rakva`, headers)).status, 404);
  });
});

test('CORS blocks foreign Foundry origins; health leaks no project data', async () => {
  await withServer(async url => {
    assert.equal((await req(`${url}/api/project?project=rakva`, auth(rakvaToken, { origin: 'https://evil.example' }))).status, 403);
    assert.equal((await req(`${url}/api/project?project=rakva`, auth(rakvaToken), 'POST')).status, 405);
    const preflight = await req(`${url}/api/project`, { origin }, 'OPTIONS');
    assert.equal(preflight.status, 204);
    assert.equal(preflight.headers.get('access-control-allow-origin'), origin);
    assert.deepEqual((await req(`${url}/health`)).body, { ok: true });
  });
});

test('rejects weak credentials and malformed bridge configuration', () => {
  assert.throws(() => createHandler({ projects: new Map([['foo', { client: {}, bridgeToken: 'weak' }]]), allowedOrigins: new Set([origin]) }), /64 hex/);
  assert.throws(() => createHandler({ projects, allowedOrigins: new Set() }), /ALLOWED_ORIGINS/);
});
