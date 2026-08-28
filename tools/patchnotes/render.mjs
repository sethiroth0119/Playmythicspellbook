import fs from 'fs';

const md = fs.readFileSync(process.argv[2], 'utf8').replace(/\r\n/g, '\n');

const esc = s => s.replace(/&/g, '&amp;').replace(/</g, '&lt;').replace(/>/g, '&gt;');

// Inline spans. Code is pulled out FIRST and restored LAST, so its contents can
// never be re-processed as bold/italic/link markup.
function inline(s) {
  const codes = [];
  s = esc(s).replace(/`([^`]+)`/g, (_, c) => '@@C' + (codes.push(c) - 1) + '@@');
  s = s.replace(/\[([^\]]+)\]\(([^)\s]+)\)/g, '<a href="$2">$1</a>');
  // Non-greedy across asterisks so a bold span may contain a nested italic.
  s = s.replace(/\*\*([\s\S]+?)\*\*/g, '<strong>$1</strong>');
  s = s.replace(/(^|[\s(—·])\*([^*\n]+)\*(?=$|[\s.,;:!?)—·])/g, '$1<em>$2</em>');
  // Typographic quotes. Safe here because the markdown carries no HTML attributes —
  // the escape pass above has already turned any stray angle bracket into an entity.
  // '>' counts as an opening context: any literal '>' left at this point closes a tag
  // this function generated, so a quote after it starts a span (**"like this"**).
  s = s.replace(/(^|[\s(\[—·>])"/g, '$1“').replace(/"/g, '”');
  s = s.replace(/(\p{L})'(\p{L})/gu, '$1’$2');
  s = s.replace(/@@C(\d+)@@/g, (_, i) => '<code>' + codes[+i] + '</code>');
  return s;
}

// A leading glyph on a bullet or paragraph encodes the KIND of change.
const TAGS = [
  { glyph: '\u{1F534}', cls: 'tag-major', label: 'Critical fix' },
  { glyph: '\u{1F41B}', cls: 'tag-fix', label: 'Fixed' },
];
function chip(text) {
  for (const t of TAGS) {
    if (text.startsWith(t.glyph)) {
      return {
        tag: '<span class="tag ' + t.cls + '">' + t.label + '</span>',
        rest: text.slice(t.glyph.length).trimStart(),
        cls: ' class="tagged"',
      };
    }
  }
  return { tag: '', rest: text, cls: '' };
}

const slugSeen = new Set();
function slug(s) {
  const base = s.toLowerCase().replace(/[^a-z0-9\s-]/g, '').trim().replace(/\s+/g, '-') || 'section';
  let id = base, k = 2;
  while (slugSeen.has(id)) id = base + '-' + k++;
  slugSeen.add(id);
  return id;
}
// Strip the leading emoji for the contents-rail label; the heading keeps it.
const label = s => s.replace(/^[^\p{L}\p{N}]+/u, '').trim();

const lines = md.split('\n');
const toc = [];
const out = [];
let i = 0, open = false, started = false;

const push = h => out.push(h);
function closeSection() { if (open) { push('</section>'); open = false; } }

while (i < lines.length) {
  const line = lines[i];

  // Front matter belongs to the masthead, not the document.
  if (!started && !/^#{1,4}\s/.test(line)) { i++; continue; }

  // ── table ──
  if (/^\|/.test(line) && /^\|[\s:|-]+\|$/.test(lines[i + 1] || '')) {
    const cells = r => r.trim().replace(/^\||\|$/g, '').split('|').map(c => inline(c.trim()));
    const head = cells(line);
    i += 2;
    const body = [];
    while (i < lines.length && /^\|/.test(lines[i])) body.push(cells(lines[i++]));
    push('<div class="tw"><table><thead><tr>' + head.map(c => '<th>' + c + '</th>').join('') +
      '</tr></thead><tbody>' +
      body.map(r => '<tr>' + r.map(c => '<td>' + c + '</td>').join('') + '</tr>').join('') +
      '</tbody></table></div>');
    continue;
  }

  // ── lists ──
  const isUl = /^-\s+(.*)$/.test(line);
  const isOl = /^(\d+)\.\s+(.*)$/.test(line);
  if (isUl || isOl) {
    const tag = isUl ? 'ul' : 'ol';
    const items = [];
    while (i < lines.length) {
      const m = isUl ? /^-\s+(.*)$/.exec(lines[i]) : /^(\d+)\.\s+(.*)$/.exec(lines[i]);
      if (!m) break;
      let text = isUl ? m[1] : m[2];
      i++;
      // Indented continuation lines fold into the same item.
      while (i < lines.length && /^\s{2,}\S/.test(lines[i]) && !/^\s{2,}[-\d]/.test(lines[i])) {
        text += ' ' + lines[i].trim();
        i++;
      }
      const c = chip(text);
      items.push('<li' + c.cls + '>' + c.tag + inline(c.rest) + '</li>');
    }
    push('<' + tag + '>' + items.join('') + '</' + tag + '>');
    continue;
  }

  // ── headings ──
  const h = /^(#{1,4})\s+(.*)$/.exec(line);
  if (h) {
    const level = h[1].length;
    const text = h[2].trim();
    // The H1 and the build-range H2 already live in the masthead.
    if (level === 1 || (level === 2 && /^Builds/i.test(text))) { i++; continue; }
    if (level === 2) {
      closeSection();
      const id = slug(text);
      toc.push({ id, label: label(text) });
      push('<section id="' + id + '">');
      open = true;
      started = true;
      push('<h2>' + inline(text) + '</h2>');
    } else {
      push('<h' + level + '>' + inline(text) + '</h' + level + '>');
    }
    i++;
    continue;
  }

  if (/^---+\s*$/.test(line)) { i++; continue; }
  if (!line.trim()) { i++; continue; }

  // ── paragraph ──
  const para = [line];
  i++;
  while (i < lines.length && lines[i].trim() && !/^(#{1,4}\s|-\s|\d+\.\s|\||---)/.test(lines[i])) {
    para.push(lines[i++]);
  }
  const text = para.join(' ').trim();
  if (/^\*[^*]+\*$/.test(text)) continue;   // the trailing italic colophon; the page has its own
  const c = chip(text);
  push('<p' + c.cls + '>' + c.tag + inline(c.rest) + '</p>');
}
closeSection();

const html = out.filter(Boolean).join('\n');
fs.writeFileSync(process.argv[3], html);
fs.writeFileSync(process.argv[4], JSON.stringify(toc, null, 1));
console.error('sections: ' + toc.length + '  blocks: ' + out.length + '  bytes: ' + html.length);
