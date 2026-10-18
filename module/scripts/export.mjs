/**
 * Conservative LegendKeeper -> Foundry Journal HTML conversion.
 * Only explicitly supported public text blocks are emitted. Unknown blocks,
 * properties, external embeds, and secret/hidden subtrees are ignored.
 * The output has escaped text and constant HTML tags; never trust LK HTML.
 */
function escapeHTML(input) {
  return String(input ?? '').replace(/[&<>"']/g, c => ({'&':'&amp;', '<':'&lt;', '>':'&gt;', '"':'&quot;', "'":'&#39;'}[c]));
}

function runText(content) {
  if (!Array.isArray(content)) return '';
  return content.map(run => {
    if (typeof run === 'string') return run;
    if (!run || typeof run !== 'object') return '';
    if (typeof run.text === 'string') return run.text;
    if (run.kind === 'break' || run.type === 'break') return '\n';
    return ''; // Mentions/links without explicit text must not leak target metadata.
  }).join('');
}

const CONTAINERS = new Set(['layout', 'layoutColumn', 'expand', 'textField', 'callout', 'listItem', 'bulletList', 'orderedList', 'quote']);
const TEXT = new Set(['paragraph', 'heading', 'code']);

function renderOne(block, counters, depth = 0) {
  if (!block || typeof block !== 'object' || depth > 35) return '';
  if (block.isHidden === true || block.kind === 'secret' || block.kind === 'property') {
    counters.omitted++;
    return '';
  }
  const kind = block.kind;
  if (kind === 'rule') return '<hr>';
  if (TEXT.has(kind)) {
    const raw = runText(block.content);
    if (!raw.trim()) return '';
    const content = escapeHTML(raw).replace(/\n/g, '<br>');
    if (kind === 'heading') {
      const level = Math.max(2, Math.min(6, Number(block.level) || 2));
      return `<h${level}>${content}</h${level}>`;
    }
    return kind === 'code' ? `<pre>${content}</pre>` : `<p>${content}</p>`;
  }
  if (CONTAINERS.has(kind)) {
    const children = Array.isArray(block.children) ? block.children : [];
    // A quote may store its content directly rather than as children.
    let inner = children.map(child => renderOne(child, counters, depth + 1)).join('');
    if (!inner && Array.isArray(block.content)) inner = `<p>${escapeHTML(runText(block.content))}</p>`;
    if (!inner) return '';
    if (kind === 'bulletList') return `<ul>${inner}</ul>`;
    if (kind === 'orderedList') return `<ol>${inner}</ol>`;
    if (kind === 'listItem') return `<li>${inner}</li>`;
    if (kind === 'quote') return `<blockquote>${inner}</blockquote>`;
    return `<div>${inner}</div>`;
  }
  counters.omitted++;
  return '';
}

export function journalHTML(document) {
  const counters = { omitted: 0 };
  const blocks = Array.isArray(document?.blocks) ? document.blocks : [];
  const html = blocks.map(b => renderOne(b, counters)).join('\n');
  return { html, omitted: counters.omitted };
}
