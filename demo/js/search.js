import { propPathMap } from './state.js';
import { escapeHtml } from './utils.js';
import { expandToPath } from './property-view.js';

// ── Search worker ────────────────────────────────────────────────────
const searchWorker = new Worker(new URL('./search-worker.js', import.meta.url));

let pendingSearchQuery = null;
let searchEditorOptions = { regex: false, caseSensitive: false, wholeWord: false };
let propSearchCurrentEl = null;

export function feedWorkerData(properties) {
  searchWorker.postMessage({ type: 'set-data', payload: properties });
}

// ── Worker message handler ───────────────────────────────────────────

searchWorker.onmessage = (e) => {
  const { type, query, matches, error } = e.data;
  if (type !== 'results') return;
  if (query !== pendingSearchQuery) return;

  const countEl = document.getElementById('search-results-count');
  const resultsEl = document.getElementById('search-results');
  const propTree = document.getElementById('prop-tree');
  if (!resultsEl) return;

  if (error) {
    if (countEl) { countEl.textContent = `Invalid pattern: ${error}`; countEl.classList.add('error'); }
    return;
  }
  if (countEl) countEl.classList.remove('error');

  if (matches.length === 0) {
    if (countEl) countEl.textContent = 'No results found';
    resultsEl.innerHTML = '<div class="search-no-results">No results found</div>';
    resultsEl.style.display = 'block';
    if (propTree) propTree.style.display = 'none';
    return;
  }

  // Group by parent path
  const groups = new Map();
  for (const m of matches) {
    const key = m.parent || '(root)';
    if (!groups.has(key)) groups.set(key, []);
    groups.get(key).push(m);
  }

  if (countEl) countEl.textContent = `${matches.length} result${matches.length !== 1 ? 's' : ''} in ${groups.size} group${groups.size !== 1 ? 's' : ''}`;

  renderSearchResults(resultsEl, groups, 1000);
  resultsEl.style.display = 'block';
  if (propTree) propTree.style.display = 'none';
};

// ── Highlight helpers ────────────────────────────────────────────────

function buildHighlightRegex() {
  try {
    const q = pendingSearchQuery;
    if (!q) return null;
    let src = searchEditorOptions.regex ? q : q.replace(/[.*+?^${}()|[\]\\]/g, '\\$&');
    if (searchEditorOptions.wholeWord) src = `\\b${src}\\b`;
    const flags = searchEditorOptions.caseSensitive ? 'g' : 'gi';
    return new RegExp(`(${src})`, flags);
  } catch { return null; }
}

function highlightAndEscape(text, regex) {
  if (!text) return '';
  if (!regex) return escapeHtml(text);
  const parts = text.split(regex);
  return parts.map((part, i) => i % 2 === 1 ? `<mark>${escapeHtml(part)}</mark>` : escapeHtml(part)).join('');
}

// ── Search results rendering ─────────────────────────────────────────

function renderSearchResults(container, groups, limit) {
  container.innerHTML = '';
  let count = 0;
  const re = buildHighlightRegex();

  for (const [parentPath, matches] of groups) {
    if (count >= limit) break;

    const group = document.createElement('div');
    group.className = 'search-group';

    const header = document.createElement('div');
    header.className = 'search-group-header';

    const toggle = document.createElement('span');
    toggle.className = 'search-group-toggle';
    toggle.textContent = '\u25BC';

    const pathSpan = document.createElement('span');
    pathSpan.className = 'search-group-path';
    pathSpan.textContent = parentPath;

    const badge = document.createElement('span');
    badge.className = 'search-group-badge';
    badge.textContent = matches.length;

    header.append(toggle, pathSpan, badge);
    group.appendChild(header);

    const body = document.createElement('div');
    body.className = 'search-group-body';

    for (const match of matches) {
      if (count >= limit) break;

      const line = document.createElement('div');
      line.className = 'search-result-line';
      line.dataset.path = match.path;

      const nameEl = document.createElement('span');
      nameEl.className = 'search-result-name';
      nameEl.innerHTML = highlightAndEscape(match.name, re);

      const typeEl = document.createElement('span');
      typeEl.className = 'search-result-type';
      typeEl.innerHTML = highlightAndEscape(match.type, re);

      const valueEl = document.createElement('span');
      valueEl.className = 'search-result-value';
      if (match.value) {
        if (match.type === 'String') valueEl.classList.add('str');
        else if (match.type === 'UOL') valueEl.classList.add('link');
        else if (['Short','Int','Long','Float','Double'].includes(match.type)) valueEl.classList.add('num');
        const display = match.type === 'String' ? `"${match.value}"` :
                         match.type === 'UOL' ? `\u2192 ${match.value}` : match.value;
        valueEl.innerHTML = highlightAndEscape(display, re);
      }

      line.append(nameEl, typeEl);
      if (match.value) line.appendChild(valueEl);
      line.addEventListener('click', () => navigateToProperty(match.path));

      body.appendChild(line);
      count++;
    }

    group.appendChild(body);

    header.addEventListener('click', () => {
      const collapsed = body.style.display === 'none';
      body.style.display = collapsed ? '' : 'none';
      toggle.textContent = collapsed ? '\u25BC' : '\u25B6';
    });

    container.appendChild(group);
  }

  if (count >= limit) {
    const more = document.createElement('div');
    more.className = 'search-more';
    const total = [...groups.values()].reduce((a, g) => a + g.length, 0);
    more.textContent = `Showing first ${limit} of ${total} results`;
    container.appendChild(more);
  }
}

// ── Navigate to property ─────────────────────────────────────────────

function navigateToProperty(path) {
  const input = document.getElementById('search-editor-input');
  const resultsEl = document.getElementById('search-results');
  const propTree = document.getElementById('prop-tree');
  const countEl = document.getElementById('search-results-count');

  if (input) input.value = '';
  if (resultsEl) { resultsEl.style.display = 'none'; resultsEl.innerHTML = ''; }
  if (propTree) propTree.style.display = '';
  if (countEl) countEl.textContent = '';
  pendingSearchQuery = null;

  expandToPath(path);

  const item = propPathMap?.get(path);
  if (!item) return;

  // Expand ancestor containers so the item is visible
  const tree = document.getElementById('prop-tree');
  let parent = item.parentElement;
  while (parent && parent !== tree) {
    if (parent.classList.contains('prop-children') && parent.style.display === 'none') {
      parent.style.display = '';
      const prevSib = parent.previousElementSibling;
      if (prevSib?.classList.contains('prop-item')) {
        const tog = prevSib.querySelector('.prop-toggle');
        if (tog) tog.textContent = '\u25BC';
      }
    }
    parent = parent.parentElement;
  }

  if (propSearchCurrentEl) propSearchCurrentEl.classList.remove('search-match', 'search-current');
  item.classList.add('search-match', 'search-current');
  propSearchCurrentEl = item;
  item.scrollIntoView({ behavior: 'smooth', block: 'center' });
  setTimeout(() => item.classList.remove('search-match', 'search-current'), 3000);
}

// ── Setup search editor ──────────────────────────────────────────────

export function setupSearchEditor() {
  const input = document.getElementById('search-editor-input');
  const countEl = document.getElementById('search-results-count');
  const resultsEl = document.getElementById('search-results');
  const propTree = document.getElementById('prop-tree');
  const regexBtn = document.getElementById('toggle-regex');
  const caseBtn = document.getElementById('toggle-case');
  const wordBtn = document.getElementById('toggle-word');
  if (!input) return;

  if (searchEditorOptions.regex) regexBtn.classList.add('active');
  if (searchEditorOptions.caseSensitive) caseBtn.classList.add('active');
  if (searchEditorOptions.wholeWord) wordBtn.classList.add('active');

  function doSearch() {
    const q = input.value.trim();
    if (!q) {
      pendingSearchQuery = null;
      if (countEl) countEl.textContent = '';
      if (resultsEl) { resultsEl.style.display = 'none'; resultsEl.innerHTML = ''; }
      if (propTree) propTree.style.display = '';
      return;
    }
    pendingSearchQuery = q;
    if (countEl) countEl.textContent = 'Searching\u2026';
    searchWorker.postMessage({
      type: 'search',
      payload: {
        query: q,
        regex: searchEditorOptions.regex,
        caseSensitive: searchEditorOptions.caseSensitive,
        wholeWord: searchEditorOptions.wholeWord,
      },
    });
  }

  let debounceTimer;
  input.addEventListener('input', () => {
    clearTimeout(debounceTimer);
    debounceTimer = setTimeout(doSearch, 200);
  });

  function toggleOption(btn, key) {
    searchEditorOptions[key] = !searchEditorOptions[key];
    btn.classList.toggle('active');
    if (input.value.trim()) doSearch();
  }

  regexBtn.addEventListener('click', (e) => { e.stopPropagation(); toggleOption(regexBtn, 'regex'); });
  caseBtn.addEventListener('click', (e) => { e.stopPropagation(); toggleOption(caseBtn, 'caseSensitive'); });
  wordBtn.addEventListener('click', (e) => { e.stopPropagation(); toggleOption(wordBtn, 'wholeWord'); });

  input.addEventListener('keydown', (e) => {
    if (e.key === 'Escape') {
      input.value = '';
      doSearch();
      input.blur();
    }
    if (e.altKey && e.key === 'r') { e.preventDefault(); toggleOption(regexBtn, 'regex'); }
    if (e.altKey && e.key === 'c') { e.preventDefault(); toggleOption(caseBtn, 'caseSensitive'); }
    if (e.altKey && e.key === 'w') { e.preventDefault(); toggleOption(wordBtn, 'wholeWord'); }
  });
}

// ── Global Ctrl+F ────────────────────────────────────────────────────

document.addEventListener('keydown', (e) => {
  if ((e.ctrlKey || e.metaKey) && e.key === 'f') {
    const input = document.getElementById('search-editor-input');
    if (input) {
      e.preventDefault();
      input.focus();
      input.select();
    }
  }
});
