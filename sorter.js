// Sorts dbdiagram.io (DBML) source: groups top-level blocks by kind, alphabetical within a group.
(function (root) {
  const GROUP_ORDER = ['project', 'enum', 'tablepartial', 'table', 'ref', 'tablegroup', 'note', 'records', 'other'];
  const collator = new Intl.Collator('en', { numeric: true, sensitivity: 'base' });

  // Advances past a string/comment starting at i, or returns i unchanged.
  function skipLiteral(src, i) {
    if (src.startsWith("'''", i)) {
      const end = src.indexOf("'''", i + 3);
      return end < 0 ? src.length : end + 3;
    }
    const c = src[i];
    if (c === '"' || c === "'" || c === '`') {
      let j = i + 1;
      while (j < src.length && src[j] !== c) j += src[j] === '\\' ? 2 : 1;
      return j + 1;
    }
    if (src.startsWith('//', i)) {
      const end = src.indexOf('\n', i);
      return end < 0 ? src.length : end;
    }
    if (src.startsWith('/*', i)) {
      const end = src.indexOf('*/', i + 2);
      return end < 0 ? src.length : end + 2;
    }
    return i;
  }

  // Returns index just past the `}` matching the `{` at i.
  function skipBraces(src, i) {
    let depth = 0;
    while (i < src.length) {
      const next = skipLiteral(src, i);
      if (next !== i) { i = next; continue; }
      if (src[i] === '{') depth++;
      else if (src[i] === '}' && --depth === 0) return i + 1;
      i++;
    }
    return i;
  }

  // Splits source into top-level blocks; comments directly above a block stay attached to it.
  function parse(src) {
    src = src.replace(/\r\n?/g, '\n');
    const blocks = [];
    let pending = [];
    let i = 0;
    while (i < src.length) {
      if (/\s/.test(src[i])) {
        // A blank line detaches pending comments from the next block.
        if (src[i] === '\n' && /^\n[ \t]*\n/.test(src.slice(i, i + 64)) && pending.length) {
          blocks.push({ kind: 'comment', text: pending.join('\n') });
          pending = [];
        }
        i++;
        continue;
      }
      if (src.startsWith('//', i) || src.startsWith('/*', i)) {
        const end = skipLiteral(src, i);
        pending.push(src.slice(i, end).trim());
        i = end;
        continue;
      }
      const start = i;
      // Read the header up to `{` or end of line.
      while (i < src.length && src[i] !== '\n' && src[i] !== '{') {
        const next = skipLiteral(src, i);
        if (next !== i && !src.startsWith('//', i) && !src.startsWith('/*', i)) { i = next; continue; }
        if (next !== i) break; // trailing comment ends the header
        i++;
      }
      if (src[i] !== '{') {
        // Allow `{` on the following line.
        const header = src.slice(start, i);
        const isInlineRef = /^Ref\b/i.test(header) && findTopLevelColon(header) > 0;
        const m = /^\s*\{/.exec(src.slice(i));
        if (m && !isInlineRef) i += m[0].length - 1;
      }
      if (src[i] === '{') i = skipBraces(src, i);
      // Keep a trailing same-line comment.
      const rest = /^[ \t]*(\/\/[^\n]*)?/.exec(src.slice(i));
      i += rest[0].length;
      const text = src.slice(start, i).replace(/[ \t]+$/, '');
      blocks.push(describe(text, pending));
      pending = [];
    }
    if (pending.length) blocks.push({ kind: 'comment', text: pending.join('\n') });
    return blocks;
  }

  const unquote = (s) => s.replace(/["`]/g, '').trim();

  function describe(text, comments) {
    const kw = (/^(\w+)/.exec(text) || [, ''])[1].toLowerCase();
    const kind = GROUP_ORDER.includes(kw) ? kw : 'other';
    const header = text.split(/[{\n]/)[0];
    if (kind === 'ref') {
      const colon = findTopLevelColon(header);
      const body = text.includes('{') ? text.slice(text.indexOf('{') + 1, text.lastIndexOf('}')) : header.slice(colon + 1);
      return { kind, text, comments, key: refSortKey(body) };
    }
    const m = /^\w+\s+((?:"[^"]*"|`[^`]*`|[\w$]+)(?:\s*\.\s*(?:"[^"]*"|`[^`]*`|[\w$]+))*)/.exec(header);
    return { kind, text, comments, key: [m ? unquote(m[1]) : header] };
  }

  function findTopLevelColon(s) {
    for (let i = 0; i < s.length; i++) {
      const next = skipLiteral(s, i);
      if (next !== i) { i = next - 1; continue; }
      if (s[i] === ':') return i;
    }
    return -1;
  }

  const ENDPOINT = /(?:"[^"]*"|[\w$]+)(?:\s*\.\s*(?:"[^"]*"|[\w$]+|\([^)]*\)))+/g;

  // Refs sort by the table holding the foreign key, then the referenced table.
  function refSortKey(body) {
    const clean = body.replace(/\[[^\]]*\]\s*$/, '');
    const eps = clean.match(ENDPOINT) || [];
    const left = unquote(eps[0] || '');
    const right = unquote(eps[1] || '');
    const between = eps.length > 1 ? clean.slice(clean.indexOf(eps[0]) + eps[0].length, clean.lastIndexOf(eps[1])) : '';
    // `<` puts the foreign key on the right side, `>` on the left; `-` and `<>` default to left.
    const fkRight = between.includes('<') && !between.includes('>');
    return fkRight ? [right, left] : [left, right];
  }

  function compareKeys(a, b) {
    for (let i = 0; i < a.length; i++) {
      const c = collator.compare(a[i], b[i] || '');
      if (c) return c;
    }
    return 0;
  }

  function sortDbml(src) {
    const blocks = parse(src.trim());
    const groups = new Map(GROUP_ORDER.map((k) => [k, []]));
    const loose = [];
    for (const b of blocks) (b.kind === 'comment' ? loose : groups.get(b.kind)).push(b);

    for (const list of groups.values()) list.sort((a, b) => compareKeys(a.key, b.key));

    const render = (b) => [...b.comments, b.text].join('\n');
    const sections = [];
    if (loose.length) sections.push(loose.map((b) => b.text).join('\n\n'));
    for (const list of groups.values()) {
      if (list.length) sections.push(list.map(render).join('\n\n'));
    }
    return sections.join('\n\n');
  }

  root.DbmlSorter = { sortDbml, parse };
  if (typeof module !== 'undefined') module.exports = root.DbmlSorter;
})(typeof window !== 'undefined' ? window : globalThis);
