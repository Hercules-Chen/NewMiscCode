// Tiny, safe Markdown subset renderer (escape first, then format).
// Supports: # headings, - lists, - [ ] / - [x] checkboxes, ``` code blocks, `code`, **bold**, *italic*, [text](https://url)
const esc = s => s.replace(/&/g, '&amp;').replace(/</g, '&lt;').replace(/>/g, '&gt;').replace(/"/g, '&quot;');

function inline(s) {
  return esc(s)
    .replace(/`([^`]+)`/g, '<code>$1</code>')
    .replace(/\*\*([^*]+)\*\*/g, '<strong>$1</strong>')
    .replace(/(^|[^*])\*([^*\s][^*]*)\*/g, '$1<em>$2</em>')
    .replace(/\[([^\]]+)\]\((https?:\/\/[^\s)]+)\)/g, '<a href="$2" target="_blank" rel="noopener noreferrer">$1</a>');
}

export function renderMarkdown(src) {
  const out = [];
  let list = false;
  let code = null;
  const closeList = () => { if (list) { out.push('</ul>'); list = false; } };
  for (const line of src.split('\n')) {
    if (code !== null) {
      if (/^```/.test(line)) { out.push(`<pre><code>${esc(code.join('\n'))}</code></pre>`); code = null; } else code.push(line);
      continue;
    }
    if (/^```/.test(line)) { closeList(); code = []; continue; }
    let m;
    if ((m = line.match(/^(#{1,4})\s+(.*)$/))) { closeList(); out.push(`<h${m[1].length + 1}>${inline(m[2])}</h${m[1].length + 1}>`); continue; }
    if ((m = line.match(/^\s*[-*]\s+\[([ xX])\]\s+(.*)$/))) {
      if (!list) { out.push('<ul class="md-list">'); list = true; }
      out.push(`<li class="md-check"><input type="checkbox" disabled${m[1] !== ' ' ? ' checked' : ''}> ${inline(m[2])}</li>`);
      continue;
    }
    if ((m = line.match(/^\s*[-*]\s+(.*)$/))) {
      if (!list) { out.push('<ul class="md-list">'); list = true; }
      out.push(`<li>${inline(m[1])}</li>`);
      continue;
    }
    closeList();
    if (line.trim() === '') continue;
    out.push(`<p>${inline(line)}</p>`);
  }
  if (code !== null) out.push(`<pre><code>${esc(code.join('\n'))}</code></pre>`);
  closeList();
  return out.join('\n');
}
