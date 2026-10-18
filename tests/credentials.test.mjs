import test from 'node:test';
import assert from 'node:assert/strict';
import { normalizedBridgeUrl, connectionKey, getPairedToken, updatePairings } from '../module/scripts/credentials.mjs';

test('remember once and restore per world, alias and browser origin', () => {
  const a = connectionKey({ base: 'https://lk.example.org/', worldId: 'world-A', alias: 'rakva' });
  const b = connectionKey({ base: 'https://lk.example.org', worldId: 'world-B', alias: 'rakva' });
  const c = connectionKey({ base: 'https://lk.example.org', worldId: 'world-A', alias: 'starwars' });
  assert.notEqual(a, b);
  assert.notEqual(a, c);
  const saved = updatePairings({}, a, 'a'.repeat(64));
  assert.equal(getPairedToken(saved, a), 'a'.repeat(64));
  assert.equal(getPairedToken(saved, b), '');
  assert.equal(getPairedToken(saved, c), '');
  assert.equal(getPairedToken(updatePairings(saved, a, ''), a), '');
});

test('refuse insecure remote origins, embedded credentials and paths', () => {
  assert.equal(normalizedBridgeUrl(' https://lk.example.org/ '), 'https://lk.example.org');
  for (const url of ['http://lk.example.org', 'https://person:secret@lk.example.org', 'https://lk.example.org/private', 'https://lk.example.org?token=secret']) {
    assert.throws(() => normalizedBridgeUrl(url));
  }
  assert.equal(normalizedBridgeUrl('http://localhost:8787'), 'http://localhost:8787');
});
