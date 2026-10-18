import http from 'node:http';
import { LegendKeeper } from '@legendkeeper/sdk';
import { createHandler } from './handler.mjs';

const allowedOrigins = new Set((process.env.ALLOWED_ORIGINS ?? '').split(',').map(x => x.trim()).filter(Boolean));
const port = Number(process.env.PORT ?? 8787);
if (!Number.isInteger(port) || port < 1 || port > 65535) throw new Error('Invalid PORT.');
let config;
try { config = JSON.parse(process.env.LK_PROJECTS_JSON ?? '{}'); }
catch { throw new Error('LK_PROJECTS_JSON must be valid JSON.'); }
if (!config || typeof config !== 'object' || Array.isArray(config) || !Object.keys(config).length) {
  throw new Error('LK_PROJECTS_JSON must contain at least one alias.');
}
const projects = new Map();
for (const [alias, entry] of Object.entries(config)) {
  if (!/^[a-z0-9_-]{1,64}$/.test(alias) || !entry || typeof entry.apiKey !== 'string' || !entry.apiKey.trim()) {
    throw new Error(`Invalid API key or alias: ${alias}`);
  }
  projects.set(alias, { client: new LegendKeeper({ apiKey: entry.apiKey }), bridgeToken: entry.bridgeToken });
}
const server = http.createServer(createHandler({ projects, allowedOrigins }));
server.requestTimeout = 25000;
server.headersTimeout = 10000;
server.listen(port, '0.0.0.0', () => console.log(`LegendKeeper bridge v0.0.1 listening on ${port} (${projects.size} project(s))`));
