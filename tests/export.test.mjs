import test from 'node:test';
import assert from 'node:assert/strict';
import { journalHTML } from '../module/scripts/export.mjs';

test('publishes safe paragraphs and headings and escapes HTML', () => {
  const { html, omitted } = journalHTML({ blocks: [
    { kind: 'heading', level: 2, content: [{ text: 'A & B' }] },
    { kind: 'paragraph', content: [{ text: '<script>alert(1)</script>' }] }
  ] });
  assert.match(html, /<h2>A &amp; B<\/h2>/);
  assert.match(html, /&lt;script&gt;alert\(1\)&lt;\/script&gt;/);
  assert.doesNotMatch(html, /<script>/);
  assert.equal(omitted, 0);
});

test('never exports secret, hidden or unknown blocks, including nested secrets', () => {
  const { html, omitted } = journalHTML({ blocks: [
    { kind: 'paragraph', content: [{ text: 'Public' }] },
    { kind: 'secret', children: [{ kind: 'paragraph', content: [{ text: 'Dark truth' }] }] },
    { kind: 'expand', children: [
      { kind: 'paragraph', content: [{ text: 'Safe' }] },
      { kind: 'secret', children: [{ kind: 'paragraph', content: [{ text: 'Hidden nested' }] }] },
    ] },
    { kind: 'paragraph', isHidden: true, content: [{ text: 'Hide' }] },
    { kind: 'embed', html: '<img src=x onerror=alert(1)>', content: [{ text: 'unsafe' }] },
  ] });
  assert.match(html, /Public/);
  assert.match(html, /Safe/);
  for (const word of ['Dark truth', 'Hidden nested', 'Hide', 'unsafe', 'onerror']) assert.doesNotMatch(html, new RegExp(word));
  assert.equal(omitted, 4);
});

test('empty response yields empty journal and does not accidentally use document.text', () => {
  assert.deepEqual(journalHTML({ text: 'Sensitive upstream plain text' }), { html: '', omitted: 0 });
});
