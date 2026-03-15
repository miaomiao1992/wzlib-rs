// Web Worker for property tree search — keeps the main thread responsive.
// Supports regex, case-sensitive, and whole-word matching.

/** @type {Array<{path:string, name:string, type:string, value:string}>} */
let flatIndex = null;

function formatValue(prop) {
  switch (prop.type) {
    case 'Short': case 'Int': case 'Long': return String(prop.value);
    case 'Float': case 'Double': return Number(prop.value).toFixed(4);
    case 'String': return prop.value;
    case 'UOL': return prop.value;
    case 'Vector': return `${prop.x}, ${prop.y}`;
    case 'Canvas': return `${prop.width}\u00D7${prop.height}`;
    case 'Sound': return `${prop.duration_ms}ms`;
    case 'Null': return 'null';
    default: return '';
  }
}

function buildIndex(props, parentPath) {
  for (const prop of props) {
    const path = parentPath ? `${parentPath}/${prop.name}` : prop.name;
    const lastSlash = path.lastIndexOf('/');
    flatIndex.push({
      path,
      parent: lastSlash >= 0 ? path.substring(0, lastSlash) : '',
      name: prop.name,
      type: prop.type,
      value: formatValue(prop),
    });
    if (prop.children && prop.children.length > 0) {
      buildIndex(prop.children, path);
    }
  }
}

function escapeRegex(s) {
  return s.replace(/[.*+?^${}()|[\]\\]/g, '\\$&');
}

self.onmessage = (e) => {
  const { type, payload } = e.data;

  if (type === 'set-data') {
    flatIndex = [];
    buildIndex(payload, '');
    self.postMessage({ type: 'ready', count: flatIndex.length });
    return;
  }

  if (type === 'search') {
    const { query, regex, caseSensitive, wholeWord } = payload;

    if (!query) {
      self.postMessage({ type: 'results', query, matches: [] });
      return;
    }

    let pattern;
    try {
      let src = regex ? query : escapeRegex(query);
      if (wholeWord) src = `\\b${src}\\b`;
      const flags = caseSensitive ? 'g' : 'gi';
      pattern = new RegExp(src, flags);
    } catch (err) {
      self.postMessage({ type: 'results', query, matches: [], error: err.message });
      return;
    }

    const matches = [];
    for (const entry of flatIndex) {
      pattern.lastIndex = 0;
      const nameHit = pattern.test(entry.name);
      pattern.lastIndex = 0;
      const valueHit = entry.value ? pattern.test(entry.value) : false;
      pattern.lastIndex = 0;
      const typeHit = pattern.test(entry.type);
      pattern.lastIndex = 0;

      if (nameHit || valueHit || typeHit) {
        matches.push({
          path: entry.path,
          parent: entry.parent,
          name: entry.name,
          type: entry.type,
          value: entry.value,
        });
      }
    }

    self.postMessage({ type: 'results', query, matches });
  }
};
