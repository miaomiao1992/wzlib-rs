import init, {
  parseWzFile,
  parseWzImage,
  decodeWzCanvas,
  extractWzSound,
  computeVersionHash,
  generateWzKey,
  getVersionIv,
  decompressPngData,
  decodePixels,
  detectWzMapleVersion,
  detectWzFileType,
  parseWzListFile,
  parseHotfixDataWz,
  parseMsFile,
  parseMsImage,
  decodeMsCanvas,
  extractMsSound,
  extractWzVideo,
  extractMsVideo,
} from '../ts-wrapper/wasm-pkg/wzlib_rs.js';

// ── State ────────────────────────────────────────────────────────────
let wasmReady = false;
let parsedTree = null;
let selectedNode = null;
let wzData = null;       // Uint8Array of the full .wz/.ms file
let wzVersionHash = 0;   // version hash from parsing
let wzVersionName = '';   // "gms", "ems", "bms"
let fileMode = 'standard'; // 'standard' | 'hotfix' | 'list' | 'ms'
let msFileName = '';        // original .ms filename for key derivation
let currentMsEntryIndex = -1;

// ── Search worker ───────────────────────────────────────────────────
const searchWorker = new Worker(new URL('./search-worker.js', import.meta.url));
let pendingSearchQuery = null; // track the latest query to discard stale results

// ── Lazy property tree rendering ────────────────────────────────────
let currentImgOffset = 0;
let propChildrenData = new Map();  // path → prop.children array
let childContainerMap = new Map(); // path → child container DOM element

// ── DOM refs ─────────────────────────────────────────────────────────
const $loading     = document.getElementById('loading');
const $loadingText = document.getElementById('loading-text');
const $dropZone    = document.getElementById('drop-zone');
const $fileInput   = document.getElementById('file-input');
const $main        = document.getElementById('main');
const $fileName    = document.getElementById('file-name');
const $fileStats   = document.getElementById('file-stats');
const $searchBox   = document.getElementById('search-box');
const $tree        = document.getElementById('tree-container');
const $detail      = document.getElementById('detail-content');
const $detailEmpty = document.getElementById('detail-empty');
const $statusWasm  = document.getElementById('status-wasm');
const $statusFile  = document.getElementById('status-file');
const $statusParse = document.getElementById('status-parse');
const $version     = document.getElementById('version-select');

// ── WASM init ────────────────────────────────────────────────────────
try {
  await init();
  wasmReady = true;
  $statusWasm.textContent = 'WASM: ready';
  $loading.classList.add('hidden');
} catch (e) {
  $loadingText.textContent = `Failed to load WASM: ${e.message}`;
  $statusWasm.textContent = 'WASM: error';
  console.error(e);
}

// ── File input ───────────────────────────────────────────────────────
$dropZone.addEventListener('click', () => $fileInput.click());
$fileInput.addEventListener('change', (e) => {
  if (e.target.files.length > 0) handleFile(e.target.files[0]);
});

$dropZone.addEventListener('dragover', (e) => {
  e.preventDefault();
  $dropZone.classList.add('active');
});
$dropZone.addEventListener('dragleave', () => {
  $dropZone.classList.remove('active');
});
$dropZone.addEventListener('drop', (e) => {
  e.preventDefault();
  $dropZone.classList.remove('active');
  if (e.dataTransfer.files.length > 0) handleFile(e.dataTransfer.files[0]);
});

// ── Search ───────────────────────────────────────────────────────────
$searchBox.addEventListener('input', () => {
  const q = $searchBox.value.trim().toLowerCase();
  const nodes = $tree.querySelectorAll('.tree-node');
  if (!q) {
    nodes.forEach(n => n.style.display = '');
    return;
  }
  nodes.forEach(n => {
    const name = n.dataset.name?.toLowerCase() || '';
    n.style.display = name.includes(q) ? '' : 'none';
  });
});

// ── Parse file ───────────────────────────────────────────────────────
async function handleFile(file) {
  if (!wasmReady) return alert('WASM module not ready');

  $loading.classList.remove('hidden');
  $loadingText.textContent = `Reading ${file.name} (${formatBytes(file.size)})...`;

  const buffer = await file.arrayBuffer();
  const data = new Uint8Array(buffer);
  const version = $version.value;

  $loadingText.textContent = 'Detecting file type...';

  try {
    const isMsFile = file.name.toLowerCase().endsWith('.ms');

    if (isMsFile) {
      handleMsFile(file, data);
    } else {
      const fileType = detectWzFileType(data);

      if (fileType === 'list') {
        handleListFile(file, data, version);
      } else if (fileType === 'hotfix') {
        handleHotfixFile(file, data, version);
      } else {
        handleStandardFile(file, data, version);
      }
    }

    $dropZone.classList.add('hidden');
    $main.classList.add('visible');
  } catch (e) {
    alert(`Parse error: ${e.message}\n\nTry a different encryption version.`);
    console.error(e);
  } finally {
    $loading.classList.add('hidden');
  }
}

// Shared auto-detect + parse logic for all file types.
function parseWithVersion(data, version, parseFn) {
  if (version === 'auto') {
    $loadingText.textContent = 'Auto-detecting encryption variant...';
    const result = JSON.parse(detectWzMapleVersion(data));
    return { result, detectedVersion: result.versionName };
  }
  return { result: JSON.parse(parseFn(data, version)), detectedVersion: version };
}

function finalizeFileState(data, detectedVersion, versionHash, tree, mode = 'standard') {
  wzData = data;
  wzVersionName = detectedVersion;
  wzVersionHash = versionHash;
  parsedTree = tree;
  fileMode = mode;
  msFileName = '';
  currentMsEntryIndex = -1;
  if (detectedVersion !== $version.value) $version.value = detectedVersion;
}

function handleStandardFile(file, data, version) {
  $loadingText.textContent = 'Parsing WZ file...';
  const t0 = performance.now();

  const { result, detectedVersion } = parseWithVersion(data, version, parseWzFile);
  const elapsed = (performance.now() - t0).toFixed(1);

  finalizeFileState(data, detectedVersion, result.versionHash, result.directory);

  const versionLabel = version === 'auto' ? ` (detected: ${detectedVersion.toUpperCase()})` : '';
  const counts = countNodes(parsedTree);
  $fileName.textContent = file.name;
  $fileStats.textContent = `${counts.dirs} dirs, ${counts.images} imgs`;
  $statusFile.textContent = `File: ${file.name} (${formatBytes(file.size)})`;
  $statusParse.textContent = `Parsed in ${elapsed}ms | v${result.version} ${result.is64bit ? '(64-bit)' : ''}${versionLabel} hash=${result.versionHash}`;

  renderTree(parsedTree);
}

function handleListFile(file, data, version) {
  $loadingText.textContent = 'Parsing List.wz...';
  const t0 = performance.now();

  const { result, detectedVersion } = parseWithVersion(data, version, parseWzListFile);
  const entries = result.entries || result;
  const elapsed = (performance.now() - t0).toFixed(1);

  finalizeFileState(data, detectedVersion, 0, null);

  const versionLabel = version === 'auto' ? ` (detected: ${detectedVersion.toUpperCase()})` : '';
  $fileName.textContent = file.name;
  $fileStats.textContent = `${entries.length} entries`;
  $statusFile.textContent = `File: ${file.name} (${formatBytes(file.size)})`;
  $statusParse.textContent = `Parsed in ${elapsed}ms | List.wz${versionLabel}`;

  renderListEntries(entries);
}

function handleHotfixFile(file, data, version) {
  $loadingText.textContent = 'Parsing hotfix Data.wz...';
  const t0 = performance.now();

  const { result, detectedVersion } = parseWithVersion(data, version, parseHotfixDataWz);
  const properties = result.properties || result;
  const elapsed = (performance.now() - t0).toFixed(1);

  finalizeFileState(data, detectedVersion, 0, null);

  const versionLabel = version === 'auto' ? ` (detected: ${detectedVersion.toUpperCase()})` : '';
  $fileName.textContent = file.name;
  $fileStats.textContent = `${countProps(properties)} properties`;
  $statusFile.textContent = `File: ${file.name} (${formatBytes(file.size)})`;
  $statusParse.textContent = `Parsed in ${elapsed}ms | Hotfix Data.wz${versionLabel}`;

  renderHotfixTree(file.name, properties);
}

function handleMsFile(file, data) {
  $loadingText.textContent = 'Parsing MS file...';
  const t0 = performance.now();

  const json = parseMsFile(data, file.name);
  const parsed = JSON.parse(json);
  const elapsed = (performance.now() - t0).toFixed(1);

  wzData = data;
  wzVersionName = 'bms';
  wzVersionHash = 0;
  fileMode = 'ms';
  msFileName = file.name;
  parsedTree = null;

  $fileName.textContent = file.name;
  $fileStats.textContent = `${parsed.entryCount} entries`;
  $statusFile.textContent = `File: ${file.name} (${formatBytes(file.size)})`;
  $statusParse.textContent = `Parsed in ${elapsed}ms | MS archive, ${parsed.entryCount} entries`;

  renderMsEntries(parsed.entries);
}

function renderMsEntries(entries) {
  $tree.innerHTML = '';
  const fragment = document.createDocumentFragment();

  // Group entries by category prefix (e.g. "Mob/", "Skill/")
  const groups = new Map();
  for (const entry of entries) {
    const slash = entry.name.indexOf('/');
    const group = slash >= 0 ? entry.name.substring(0, slash) : '(root)';
    if (!groups.has(group)) groups.set(group, []);
    groups.get(group).push(entry);
  }

  for (const [group, groupEntries] of groups) {
    const dirEl = createNodeEl(group, 'dir', 0, groupEntries.length);
    dirEl.dataset.nodeType = 'dir';
    dirEl.dataset.name = group;
    fragment.appendChild(dirEl);

    const children = document.createElement('div');
    children.style.display = 'none';
    children.classList.add('tree-children');

    for (const entry of groupEntries) {
      const slash = entry.name.indexOf('/');
      const shortName = slash >= 0 ? entry.name.substring(slash + 1) : entry.name;
      const el = createNodeEl(shortName, 'img', 1, 0);
      el.dataset.nodeType = 'img';
      el.dataset.name = shortName;

      el.addEventListener('click', () => {
        selectNode(el, { type: 'image', name: shortName, size: entry.size, msIndex: entry.index });
        openMsImage(entry);
      });
      children.appendChild(el);
    }

    fragment.appendChild(children);

    dirEl.addEventListener('click', () => {
      const isOpen = children.style.display !== 'none';
      children.style.display = isOpen ? 'none' : '';
      dirEl.querySelector('.toggle').textContent = isOpen ? '\u25B6' : '\u25BC';
    });
  }

  $tree.appendChild(fragment);

  // Show summary in detail panel
  $detailEmpty.style.display = 'none';
  $detail.style.display = '';
  $detail.innerHTML = `
    <h2>${escapeHtml(msFileName)}</h2>
    <table class="props">
      <tr><th>Type</th><td>MS Archive (Snow2 encrypted)</td></tr>
      <tr><th>Entries</th><td>${entries.length}</td></tr>
      <tr><th>Categories</th><td>${groups.size}</td></tr>
    </table>
    <p style="color: var(--text-dim); margin-top: 12px;">
      .ms files are BMS MapleStory encrypted archives containing WZ images.
      Click an entry to decrypt and inspect its properties.
    </p>
  `;
}

const msImgCache = new Map(); // entryIndex → parsed properties

async function openMsImage(entry) {
  if (!wzData) return;

  currentMsEntryIndex = entry.index;

  if (msImgCache.has(entry.index)) {
    showMsImageProperties(entry, msImgCache.get(entry.index));
    return;
  }

  $detail.innerHTML = `
    <h2>${escapeHtml(entry.name)}</h2>
    <div class="img-parsing">Decrypting &amp; parsing image...</div>
  `;

  await new Promise(r => setTimeout(r, 0));

  try {
    const t0 = performance.now();
    const json = parseMsImage(wzData, msFileName, entry.index);
    const t1 = performance.now();
    const properties = JSON.parse(json);
    msImgCache.set(entry.index, properties);
    $statusParse.textContent = `MS entry decrypted+parsed in ${(t1 - t0).toFixed(1)}ms (${properties.length} props)`;
    showMsImageProperties(entry, properties);
  } catch (e) {
    $detail.innerHTML = `
      <h2>${escapeHtml(entry.name)}</h2>
      <table class="props">
        <tr><th>Type</th><td>MS Entry</td></tr>
        <tr><th>Size</th><td>${formatBytes(entry.size)}</td></tr>
        <tr><th>Index</th><td>${entry.index}</td></tr>
      </table>
      <div style="color: var(--accent); margin-top: 12px;">Decrypt/parse error: ${escapeHtml(e.message)}</div>
    `;
    console.error('MS entry parse error:', e);
  }
}

function showMsImageProperties(entry, properties) {
  activeAnimControllers.forEach(c => c.destroy());
  activeAnimControllers = [];

  $detail.innerHTML = `
    <h2>${escapeHtml(entry.name)}</h2>
    <table class="props">
      <tr><th>Type</th><td>MS Entry</td></tr>
      <tr><th>Size</th><td>${formatBytes(entry.size)}</td></tr>
      <tr><th>Index</th><td>${entry.index}</td></tr>
      <tr><th>Properties</th><td>${countProps(properties)}</td></tr>
    </table>
    <div class="search-editor" id="search-editor">
      <div class="search-editor-toolbar">
        <div class="search-input-wrap">
          <input type="text" id="search-editor-input" placeholder="Search properties... (Ctrl+F)" />
          <div class="search-toggles">
            <button class="search-toggle" id="toggle-regex" title="Use Regular Expression (Alt+R)">.*</button>
            <button class="search-toggle" id="toggle-case" title="Match Case (Alt+C)">Aa</button>
            <button class="search-toggle" id="toggle-word" title="Match Whole Word (Alt+W)">ab</button>
          </div>
        </div>
        <span class="search-results-count" id="search-results-count"></span>
      </div>
      <div class="search-results" id="search-results"></div>
    </div>
    <div class="prop-tree" id="prop-tree"></div>
  `;

  initPropertyView(document.getElementById('prop-tree'), properties, entry.index);
}

// ── Canvas/Sound dispatch (WZ vs MS) ────────────────────────────────
function dispatchDecodeCanvas(imgOffsetOrEntryIndex, propPath) {
  if (fileMode === 'ms') {
    return decodeMsCanvas(wzData, msFileName, imgOffsetOrEntryIndex, propPath);
  }
  return decodeWzCanvas(wzData, wzVersionName, imgOffsetOrEntryIndex, wzVersionHash, propPath);
}

function dispatchExtractSound(imgOffsetOrEntryIndex, propPath) {
  if (fileMode === 'ms') {
    return extractMsSound(wzData, msFileName, imgOffsetOrEntryIndex, propPath);
  }
  return extractWzSound(wzData, wzVersionName, imgOffsetOrEntryIndex, wzVersionHash, propPath);
}

function dispatchExtractVideo(imgOffsetOrEntryIndex, propPath) {
  if (fileMode === 'ms') {
    return extractMsVideo(wzData, msFileName, imgOffsetOrEntryIndex, propPath);
  }
  return extractWzVideo(wzData, wzVersionName, imgOffsetOrEntryIndex, wzVersionHash, propPath);
}

// ── Tree rendering ───────────────────────────────────────────────────
function renderTree(root) {
  $tree.innerHTML = '';
  const fragment = document.createDocumentFragment();

  // Render subdirectories
  for (const dir of root.subdirectories || []) {
    renderDirNode(fragment, dir, 0);
  }
  // Render images at root level
  for (const img of root.images || []) {
    renderImgNode(fragment, img, 0);
  }

  $tree.appendChild(fragment);
}

function renderListEntries(entries) {
  $tree.innerHTML = '';
  const fragment = document.createDocumentFragment();

  // Group entries by top-level directory
  const groups = new Map();
  for (const entry of entries) {
    const slash = entry.indexOf('/');
    const group = slash >= 0 ? entry.substring(0, slash) : '(root)';
    if (!groups.has(group)) groups.set(group, []);
    groups.get(group).push(entry);
  }

  for (const [group, paths] of groups) {
    const dirEl = createNodeEl(group, 'dir', 0, paths.length);
    dirEl.dataset.nodeType = 'dir';
    dirEl.dataset.name = group;
    fragment.appendChild(dirEl);

    const children = document.createElement('div');
    children.style.display = 'none';
    children.classList.add('tree-children');

    for (const path of paths) {
      const name = path.substring(path.indexOf('/') + 1) || path;
      const el = createNodeEl(name, 'img', 1, 0);
      el.dataset.nodeType = 'list-entry';
      el.dataset.name = name;
      el.addEventListener('click', () => {
        document.querySelectorAll('.tree-node.selected').forEach(n => n.classList.remove('selected'));
        el.classList.add('selected');
        showListEntryDetail(path);
      });
      children.appendChild(el);
    }

    fragment.appendChild(children);

    dirEl.addEventListener('click', () => {
      const isOpen = children.style.display !== 'none';
      children.style.display = isOpen ? 'none' : '';
      dirEl.querySelector('.toggle').textContent = isOpen ? '\u25B6' : '\u25BC';
    });
  }

  $tree.appendChild(fragment);

  // Show summary in detail panel
  $detailEmpty.style.display = 'none';
  $detail.style.display = '';
  $detail.innerHTML = `
    <h2>List.wz</h2>
    <table class="props">
      <tr><th>Type</th><td>List File (pre-Big Bang)</td></tr>
      <tr><th>Entries</th><td>${entries.length}</td></tr>
      <tr><th>Categories</th><td>${groups.size}</td></tr>
    </table>
    <p style="color: var(--text-dim); margin-top: 12px;">
      List.wz is a path index used by pre-Big Bang MapleStory clients.
      Each entry is a relative path to an .img file within Data.wz.
    </p>
  `;
}

function showListEntryDetail(path) {
  $detailEmpty.style.display = 'none';
  $detail.style.display = '';
  $detail.innerHTML = `
    <h2>${escapeHtml(path)}</h2>
    <table class="props">
      <tr><th>Type</th><td>List Entry</td></tr>
      <tr><th>Path</th><td>${escapeHtml(path)}</td></tr>
    </table>
  `;
}

function renderHotfixTree(fileName, properties) {
  // Show a single root node in the tree sidebar
  $tree.innerHTML = '';
  const fragment = document.createDocumentFragment();

  const rootEl = createNodeEl(fileName, 'img', 0, 0);
  rootEl.dataset.nodeType = 'img';
  rootEl.dataset.name = fileName;
  rootEl.classList.add('selected');
  fragment.appendChild(rootEl);
  $tree.appendChild(fragment);

  // Show properties directly in the detail panel (like opening an IMG)
  activeAnimControllers.forEach(c => c.destroy());
  activeAnimControllers = [];

  $detailEmpty.style.display = 'none';
  $detail.style.display = '';
  $detail.innerHTML = `
    <h2>${escapeHtml(fileName)}</h2>
    <table class="props">
      <tr><th>Type</th><td>Hotfix Data.wz</td></tr>
      <tr><th>Properties</th><td>${countProps(properties)}</td></tr>
    </table>
    <div class="search-editor" id="search-editor">
      <div class="search-editor-toolbar">
        <div class="search-input-wrap">
          <input type="text" id="search-editor-input" placeholder="Search properties... (Ctrl+F)" />
          <div class="search-toggles">
            <button class="search-toggle" id="toggle-regex" title="Use Regular Expression (Alt+R)">.*</button>
            <button class="search-toggle" id="toggle-case" title="Match Case (Alt+C)">Aa</button>
            <button class="search-toggle" id="toggle-word" title="Match Whole Word (Alt+W)">ab</button>
          </div>
        </div>
        <span class="search-results-count" id="search-results-count"></span>
      </div>
      <div class="search-results" id="search-results"></div>
    </div>
    <div class="prop-tree" id="prop-tree"></div>
  `;

  initPropertyView(document.getElementById('prop-tree'), properties, 0);
}

function renderDirNode(parent, dir, depth) {
  const childCount = (dir.subdirectories?.length || 0) + (dir.images?.length || 0);
  const el = createNodeEl(dir.name, 'dir', depth, childCount);
  el.dataset.nodeType = 'dir';
  el.dataset.name = dir.name;
  parent.appendChild(el);

  // Children container (hidden by default)
  const children = document.createElement('div');
  children.style.display = 'none';
  children.classList.add('tree-children');

  for (const sub of dir.subdirectories || []) {
    renderDirNode(children, sub, depth + 1);
  }
  for (const img of dir.images || []) {
    renderImgNode(children, img, depth + 1);
  }

  parent.appendChild(children);

  // Toggle expand/collapse
  el.addEventListener('click', () => {
    const isOpen = children.style.display !== 'none';
    children.style.display = isOpen ? 'none' : '';
    el.querySelector('.toggle').textContent = isOpen ? '\u25B6' : '\u25BC';
    selectNode(el, { type: 'directory', ...dir });
  });
}

function renderImgNode(parent, img, depth) {
  const el = createNodeEl(img.name, 'img', depth, 0);
  el.dataset.nodeType = 'img';
  el.dataset.name = img.name;
  parent.appendChild(el);

  el.addEventListener('click', () => {
    selectNode(el, { type: 'image', ...img });
    openImage(img);
  });
}

function createNodeEl(name, type, depth, childCount) {
  const el = document.createElement('div');
  el.className = `tree-node ${type}`;
  el.style.setProperty('--depth', depth);

  const toggle = type === 'dir' ? '\u25B6' : '';
  const icon = type === 'dir' ? '\uD83D\uDCC1' : '\uD83D\uDCC4';

  el.innerHTML = `
    <span class="toggle">${toggle}</span>
    <span class="icon">${icon}</span>
    <span class="name">${escapeHtml(name)}</span>
    ${childCount > 0 ? `<span class="count">${childCount}</span>` : ''}
  `;
  return el;
}

// ── Node selection / detail panel ────────────────────────────────────
function selectNode(el, data) {
  document.querySelectorAll('.tree-node.selected').forEach(n => n.classList.remove('selected'));
  el.classList.add('selected');
  selectedNode = data;
  showDetail(data);
}

function showDetail(data) {
  $detailEmpty.style.display = 'none';
  $detail.style.display = '';

  if (data.type === 'directory') {
    const subdirs = data.subdirectories?.length || 0;
    const imgs = data.images?.length || 0;
    $detail.innerHTML = `
      <h2>${escapeHtml(data.name)}</h2>
      <table class="props">
        <tr><th>Type</th><td>Directory</td></tr>
        <tr><th>Subdirectories</th><td>${subdirs}</td></tr>
        <tr><th>Images</th><td>${imgs}</td></tr>
        <tr><th>Size</th><td>${data.size ?? '—'}</td></tr>
        <tr><th>Checksum</th><td>${data.checksum != null ? '0x' + (data.checksum >>> 0).toString(16).toUpperCase() : '—'}</td></tr>
        <tr><th>Offset</th><td>${data.offset != null ? '0x' + data.offset.toString(16).toUpperCase() : '—'}</td></tr>
      </table>
    `;
  } else {
    // Image detail is handled by openImage() — show basic info as placeholder
    $detail.innerHTML = `
      <h2>${escapeHtml(data.name)}</h2>
      <div class="img-parsing">Loading...</div>
    `;
  }
}

// ── IMG parsing ──────────────────────────────────────────────────────
const imgCache = new Map(); // offset → parsed properties

async function openImage(img) {
  if (!wzData) return;

  const cacheKey = img.offset;
  if (imgCache.has(cacheKey)) {
    showImageProperties(img, imgCache.get(cacheKey));
    return;
  }

  // Show loading state in detail panel
  $detail.innerHTML = `
    <h2>${escapeHtml(img.name)}</h2>
    <div class="img-parsing">Parsing image...</div>
  `;

  // Use setTimeout to let the UI update before blocking on WASM
  await new Promise(r => setTimeout(r, 0));

  try {
    const t0 = performance.now();
    const json = parseWzImage(wzData, wzVersionName, img.offset, img.size, wzVersionHash);
    const t1 = performance.now();
    const properties = JSON.parse(json);
    imgCache.set(cacheKey, properties);
    $statusParse.textContent = `IMG parsed in ${(t1 - t0).toFixed(1)}ms (${properties.length} props)`;
    showImageProperties(img, properties);
  } catch (e) {
    $detail.innerHTML = `
      <h2>${escapeHtml(img.name)}</h2>
      <table class="props">
        <tr><th>Type</th><td>Image</td></tr>
        <tr><th>Size</th><td>${formatBytes(img.size)}</td></tr>
        <tr><th>Offset</th><td>0x${img.offset.toString(16).toUpperCase()}</td></tr>
      </table>
      <div style="color: var(--accent); margin-top: 12px;">Parse error: ${escapeHtml(e.message)}</div>
    `;
    console.error('IMG parse error:', e);
  }
}

function showImageProperties(img, properties) {
  // Stop any running animations from previous view
  activeAnimControllers.forEach(c => c.destroy());
  activeAnimControllers = [];

  $detail.innerHTML = `
    <h2>${escapeHtml(img.name)}</h2>
    <table class="props">
      <tr><th>Type</th><td>Image</td></tr>
      <tr><th>Size</th><td>${formatBytes(img.size)}</td></tr>
      <tr><th>Offset</th><td>0x${img.offset.toString(16).toUpperCase()}</td></tr>
      <tr><th>Properties</th><td>${countProps(properties)}</td></tr>
    </table>
    <div class="search-editor" id="search-editor">
      <div class="search-editor-toolbar">
        <div class="search-input-wrap">
          <input type="text" id="search-editor-input" placeholder="Search properties... (Ctrl+F)" />
          <div class="search-toggles">
            <button class="search-toggle" id="toggle-regex" title="Use Regular Expression (Alt+R)">.*</button>
            <button class="search-toggle" id="toggle-case" title="Match Case (Alt+C)">Aa</button>
            <button class="search-toggle" id="toggle-word" title="Match Whole Word (Alt+W)">ab</button>
          </div>
        </div>
        <span class="search-results-count" id="search-results-count"></span>
      </div>
      <div class="search-results" id="search-results"></div>
    </div>
    <div class="prop-tree" id="prop-tree"></div>
  `;

  initPropertyView(document.getElementById('prop-tree'), properties, img.offset);
}

// Shared setup for property tree views (used by both IMG and hotfix rendering).
function initPropertyView(container, properties, imgOffset) {
  currentImgOffset = imgOffset;
  propPathMap = new Map();
  propChildrenData = new Map();
  childContainerMap = new Map();
  renderPropertyLevel(container, properties, 0, '');
  feedWorkerData(properties);
  setupSearchEditor();
}

let activeAnimControllers = [];

function getCanvasAnimFrames(prop) {
  if (!prop.children || prop.children.length < 2) return null;
  // Find the lowest numeric Canvas child to determine the start index
  let start = -1;
  for (const c of prop.children) {
    const n = parseInt(c.name, 10);
    if (!isNaN(n) && String(n) === String(c.name) && c.type === 'Canvas') {
      if (start === -1 || n < start) start = n;
    }
  }
  if (start === -1) return null;
  const frames = [];
  for (let i = start; ; i++) {
    const child = prop.children.find(c => String(c.name) === String(i));
    if (!child || child.type !== 'Canvas') break;
    frames.push(child);
  }
  return frames.length >= 2 ? frames : null;
}

function renderPropertyLevel(container, props, depth, parentPath) {
  for (const prop of props) {
    const el = document.createElement('div');
    const propPath = parentPath ? `${parentPath}/${prop.name}` : prop.name;

    const hasChildren = prop.children && prop.children.length > 0;
    const isCanvas = prop.type === 'Canvas';
    const isSound = prop.type === 'Sound';
    const isVideo = prop.type === 'Video';

    const item = document.createElement('div');
    item.className = 'prop-item';
    item.style.setProperty('--pdepth', depth);
    item.dataset.path = propPath;
    if (propPathMap) propPathMap.set(propPath, item);

    const toggle = document.createElement('span');
    toggle.className = 'prop-toggle';
    toggle.textContent = (hasChildren || isCanvas || isSound || isVideo) ? '\u25B6' : ' ';
    item.appendChild(toggle);

    const nameSpan = document.createElement('span');
    nameSpan.className = 'pname';
    nameSpan.textContent = prop.name;
    item.appendChild(nameSpan);

    const typeSpan = document.createElement('span');
    typeSpan.className = 'ptype';
    typeSpan.textContent = prop.type;
    item.appendChild(typeSpan);

    const valSpan = document.createElement('span');
    valSpan.className = 'pval';
    const valText = formatPropValue(prop);
    if (valText) {
      if (prop.type === 'String') valSpan.classList.add('str');
      else if (prop.type === 'UOL') valSpan.classList.add('link');
      else if (['Short','Int','Long','Float','Double'].includes(prop.type)) valSpan.classList.add('num');
      valSpan.textContent = valText;
      item.appendChild(valSpan);
    }

    el.appendChild(item);

    // Container for children + canvas preview
    const childContainer = document.createElement('div');
    childContainer.className = 'prop-children';
    childContainer.style.display = 'none';

    if (isCanvas) {
      const canvasHolder = document.createElement('div');
      canvasHolder.className = 'canvas-loading';
      canvasHolder.style.setProperty('--pdepth', depth);
      canvasHolder.textContent = 'Click to load preview...';
      canvasHolder.dataset.loaded = 'false';
      childContainer.appendChild(canvasHolder);
    }

    if (isSound) {
      const soundHolder = document.createElement('div');
      soundHolder.className = 'sound-loading';
      soundHolder.style.setProperty('--pdepth', depth);
      soundHolder.textContent = 'Click to load player...';
      soundHolder.dataset.loaded = 'false';
      childContainer.appendChild(soundHolder);
    }

    if (isVideo) {
      const videoHolder = document.createElement('div');
      videoHolder.className = 'video-loading';
      videoHolder.style.setProperty('--pdepth', depth);
      videoHolder.textContent = 'Click to extract video...';
      videoHolder.dataset.loaded = 'false';
      childContainer.appendChild(videoHolder);
    }

    // Store children data for lazy rendering (no recursion)
    if (hasChildren) {
      propChildrenData.set(propPath, { children: prop.children, type: prop.type });
    }

    el.appendChild(childContainer);
    childContainerMap.set(propPath, childContainer);

    if (hasChildren || isCanvas || isSound || isVideo) {
      item.style.cursor = 'pointer';
      item.addEventListener('click', (e) => {
        e.stopPropagation();
        const open = childContainer.style.display !== 'none';
        childContainer.style.display = open ? 'none' : '';
        toggle.textContent = open ? '\u25B6' : '\u25BC';

        // Lazy render children on first expand
        if (!open && hasChildren) {
          ensureChildrenRendered(propPath);
        }

        // Load canvas image on first expand
        if (isCanvas && !open) {
          const holder = childContainer.querySelector('.canvas-loading');
          if (holder && holder.dataset.loaded === 'false') {
            holder.dataset.loaded = 'true';
            holder.textContent = 'Decoding...';
            loadCanvasPreview(holder, currentImgOffset, propPath, prop.width, prop.height, depth);
          }
        }

        // Load sound player on first expand
        if (isSound && !open) {
          const holder = childContainer.querySelector('.sound-loading');
          if (holder && holder.dataset.loaded === 'false') {
            holder.dataset.loaded = 'true';
            holder.textContent = 'Extracting audio...';
            loadSoundPlayer(holder, currentImgOffset, propPath, prop.duration_ms, depth);
          }
        }

        // Load video download on first expand
        if (isVideo && !open) {
          const holder = childContainer.querySelector('.video-loading');
          if (holder && holder.dataset.loaded === 'false') {
            holder.dataset.loaded = 'true';
            holder.textContent = 'Extracting video...';
            loadVideoDownload(holder, currentImgOffset, propPath, prop, depth);
          }
        }

        // Init animation player on first expand, stop on collapse
        if (childContainer._animPlayer) {
          if (!open) childContainer._animPlayer._anim.init();
          else childContainer._animPlayer._anim.destroy();
        }
      });
    }

    container.appendChild(el);
  }
}

/** Lazily render children of a node and set up animation player if applicable. */
function ensureChildrenRendered(propPath) {
  const container = childContainerMap.get(propPath);
  if (!container || container.dataset.rendered === 'true') return;
  container.dataset.rendered = 'true';

  const data = propChildrenData.get(propPath);
  if (!data) return;

  const childDepth = propPath.split('/').length;

  // Detect animation sequence before rendering children
  if ((data.type === 'SubProperty' || data.type === 'Convex')) {
    const animFrames = getCanvasAnimFrames({ children: data.children });
    if (animFrames) {
      const animPlayerEl = createAnimPlayer(animFrames, currentImgOffset, propPath, childDepth - 1);
      container.appendChild(animPlayerEl);
      container._animPlayer = animPlayerEl;
      animPlayerEl._anim.init();
    }
  }

  renderPropertyLevel(container, data.children, childDepth, propPath);
}

/** Ensure all ancestors of a path are rendered (triggers lazy rendering). */
function expandToPath(targetPath) {
  const segments = targetPath.split('/');
  let current = '';
  for (let i = 0; i < segments.length - 1; i++) {
    current = current ? `${current}/${segments[i]}` : segments[i];
    ensureChildrenRendered(current);
  }
}

function loadCanvasPreview(holder, imgOffset, propPath, width, height, depth) {
  // Use setTimeout to let UI update
  setTimeout(() => {
    try {
      const result = dispatchDecodeCanvas(imgOffset, propPath);

      // Result format: [width_le32, height_le32, ...rgba_bytes]
      const w = result[0] | (result[1] << 8) | (result[2] << 16) | (result[3] << 24);
      const h = result[4] | (result[5] << 8) | (result[6] << 16) | (result[7] << 24);
      const rgba = result.slice(8);

      const cvs = document.createElement('canvas');
      cvs.width = w;
      cvs.height = h;
      const ctx = cvs.getContext('2d');
      const imgData = new ImageData(new Uint8ClampedArray(rgba.buffer, rgba.byteOffset, rgba.byteLength), w, h);
      ctx.putImageData(imgData, 0, 0);

      const wrapper = document.createElement('div');
      wrapper.className = 'canvas-preview';
      wrapper.style.setProperty('--pdepth', depth);
      wrapper.title = `${w}x${h} — click to toggle size`;

      // Auto-detect small sprites: use pixelated rendering for images <= 200px in both dimensions
      const isSprite = w <= 200 && h <= 200;
      if (isSprite) wrapper.classList.add('pixelated');

      wrapper.appendChild(cvs);

      // Render mode toggle button
      const renderToggle = document.createElement('button');
      renderToggle.className = 'render-toggle';
      renderToggle.textContent = isSprite ? 'smooth' : 'pixel';
      renderToggle.title = 'Toggle rendering mode';
      renderToggle.addEventListener('click', (e) => {
        e.stopPropagation();
        wrapper.classList.toggle('pixelated');
        renderToggle.textContent = wrapper.classList.contains('pixelated') ? 'smooth' : 'pixel';
      });
      wrapper.appendChild(renderToggle);

      // Toggle between fit and actual size
      wrapper.addEventListener('click', (e) => {
        e.stopPropagation();
        wrapper.classList.toggle('expanded');
      });

      holder.replaceWith(wrapper);
    } catch (e) {
      holder.textContent = `Decode error: ${e.message}`;
      holder.style.color = 'var(--accent)';
      console.error('Canvas decode error:', e);
    }
  }, 10);
}

let currentAudio = null; // Track currently playing audio for stop functionality
let currentPlayBtn = null;
let currentStopBtn = null;

function loadSoundPlayer(holder, imgOffset, propPath, durationMs, depth) {
  setTimeout(() => {
    try {
      const audioBytes = dispatchExtractSound(imgOffset, propPath);

      // Create a Blob URL for the audio — try MP3 first, browser will handle it
      const blob = new Blob([audioBytes], { type: 'audio/mpeg' });
      const url = URL.createObjectURL(blob);

      const wrapper = document.createElement('div');
      wrapper.className = 'sound-player';
      wrapper.style.setProperty('--pdepth', depth);

      const playBtn = document.createElement('button');
      playBtn.textContent = '\u25B6 Play';

      const stopBtn = document.createElement('button');
      stopBtn.textContent = '\u25A0 Stop';
      stopBtn.disabled = true;

      const info = document.createElement('span');
      info.className = 'sound-info';
      info.textContent = `${(durationMs / 1000).toFixed(1)}s \u00B7 ${formatBytes(audioBytes.length)}`;

      const audio = new Audio(url);

      playBtn.addEventListener('click', (e) => {
        e.stopPropagation();
        if (currentAudio && currentAudio !== audio) {
          currentAudio.pause();
          currentAudio.currentTime = 0;
          if (currentPlayBtn) currentPlayBtn.disabled = false;
          if (currentStopBtn) currentStopBtn.disabled = true;
        }
        currentAudio = audio;
        currentPlayBtn = playBtn;
        currentStopBtn = stopBtn;
        audio.play();
        playBtn.disabled = true;
        stopBtn.disabled = false;
      });

      stopBtn.addEventListener('click', (e) => {
        e.stopPropagation();
        audio.pause();
        audio.currentTime = 0;
        playBtn.disabled = false;
        stopBtn.disabled = true;
      });

      audio.addEventListener('ended', () => {
        playBtn.disabled = false;
        stopBtn.disabled = true;
      });

      audio.addEventListener('error', () => {
        info.textContent = `${(durationMs / 1000).toFixed(1)}s \u00B7 format not supported by browser`;
        info.style.color = 'var(--accent)';
        playBtn.disabled = true;
      });

      const volLabel = document.createElement('span');
      volLabel.className = 'vol-label';
      volLabel.textContent = '100%';

      const volSlider = document.createElement('input');
      volSlider.type = 'range';
      volSlider.min = '0';
      volSlider.max = '100';
      volSlider.value = '100';
      volSlider.title = 'Volume';
      volSlider.addEventListener('input', (e) => {
        e.stopPropagation();
        const v = volSlider.value / 100;
        audio.volume = v;
        volLabel.textContent = `${volSlider.value}%`;
      });
      volSlider.addEventListener('click', (e) => e.stopPropagation());

      wrapper.appendChild(playBtn);
      wrapper.appendChild(stopBtn);
      wrapper.appendChild(volSlider);
      wrapper.appendChild(volLabel);
      wrapper.appendChild(info);
      holder.replaceWith(wrapper);
    } catch (e) {
      holder.textContent = `Audio error: ${e.message}`;
      holder.style.color = 'var(--accent)';
      console.error('Sound extract error:', e);
    }
  }, 10);
}

function loadVideoDownload(holder, imgOffset, propPath, prop, depth) {
  setTimeout(() => {
    try {
      const videoBytes = dispatchExtractVideo(imgOffset, propPath);

      const wrapper = document.createElement('div');
      wrapper.className = 'sound-player'; // reuse sound-player layout
      wrapper.style.setProperty('--pdepth', depth);

      const dlBtn = document.createElement('button');
      dlBtn.textContent = '\u2B07 Download';
      dlBtn.addEventListener('click', (e) => {
        e.stopPropagation();
        const blob = new Blob([videoBytes], { type: 'application/octet-stream' });
        const url = URL.createObjectURL(blob);
        const a = document.createElement('a');
        a.href = url;
        a.download = `${prop.name || 'video'}.mcv`;
        a.click();
        URL.revokeObjectURL(url);
      });

      const info = document.createElement('span');
      info.className = 'sound-info';
      let desc = formatBytes(videoBytes.length);
      if (prop.mcv) {
        desc = `${prop.mcv.width}x${prop.mcv.height} ${prop.mcv.frameCount}f \u00B7 ${desc}`;
      }
      info.textContent = desc;

      wrapper.appendChild(dlBtn);
      wrapper.appendChild(info);
      holder.replaceWith(wrapper);
    } catch (e) {
      holder.textContent = `Video error: ${e.message}`;
      holder.style.color = 'var(--accent)';
      console.error('Video extract error:', e);
    }
  }, 10);
}

// ── Animation player ─────────────────────────────────────────────────
function createAnimPlayer(frames, imgOffset, parentPath, depth) {
  const player = document.createElement('div');
  player.className = 'anim-player';
  player.style.setProperty('--pdepth', depth);

  // Find max dimensions for stable canvas size
  let maxW = 0, maxH = 0;
  for (const f of frames) {
    if (f.width > maxW) maxW = f.width;
    if (f.height > maxH) maxH = f.height;
  }

  // Canvas display
  const canvasWrap = document.createElement('div');
  canvasWrap.className = 'anim-canvas-wrap';
  // Auto-detect small sprites for pixelated rendering
  if (maxW <= 200 && maxH <= 200) canvasWrap.classList.add('pixelated');
  const cvs = document.createElement('canvas');
  cvs.width = maxW;
  cvs.height = maxH;
  canvasWrap.appendChild(cvs);
  player.appendChild(canvasWrap);

  // Controls
  const controls = document.createElement('div');
  controls.className = 'anim-controls';

  const playBtn = document.createElement('button');
  playBtn.textContent = '\u25B6 Play';
  const stopBtn = document.createElement('button');
  stopBtn.textContent = '\u25A0 Stop';
  stopBtn.disabled = true;

  const frameInfo = document.createElement('span');
  frameInfo.className = 'anim-frame';
  frameInfo.textContent = `${frames.length} frames`;

  const delayLabel = document.createElement('label');
  delayLabel.textContent = 'Delay: ';
  const delayInput = document.createElement('input');
  delayInput.type = 'number';
  delayInput.value = '100';
  delayInput.min = '10';
  delayInput.max = '5000';
  delayInput.step = '10';
  delayLabel.appendChild(delayInput);
  delayLabel.appendChild(document.createTextNode(' ms'));

  controls.append(playBtn, stopBtn, frameInfo, delayLabel);
  player.appendChild(controls);

  // State
  const frameCache = new Map();
  let animTimer = null;
  let currentFrame = 0;
  let playing = false;
  let initialized = false;

  function decodeFrame(idx) {
    if (frameCache.has(idx)) return frameCache.get(idx);
    const frame = frames[idx];
    const path = parentPath ? `${parentPath}/${frame.name}` : frame.name;
    const result = dispatchDecodeCanvas(imgOffset, path);
    const w = result[0] | (result[1] << 8) | (result[2] << 16) | (result[3] << 24);
    const h = result[4] | (result[5] << 8) | (result[6] << 16) | (result[7] << 24);
    const rgba = result.slice(8);
    const data = { w, h, rgba };
    frameCache.set(idx, data);
    return data;
  }

  function showFrame(idx) {
    try {
      const { w, h, rgba } = decodeFrame(idx);
      cvs.width = maxW;
      cvs.height = maxH;
      const ctx = cvs.getContext('2d');
      ctx.clearRect(0, 0, maxW, maxH);
      const imgData = new ImageData(new Uint8ClampedArray(rgba.buffer, rgba.byteOffset, rgba.byteLength), w, h);
      const ox = Math.floor((maxW - w) / 2);
      const oy = Math.floor((maxH - h) / 2);
      ctx.putImageData(imgData, ox, oy);
      frameInfo.textContent = `${idx + 1} / ${frames.length}`;
    } catch (e) {
      frameInfo.textContent = `Frame ${idx} error`;
      console.error('Anim decode error:', e);
    }
  }

  function play() {
    if (playing) return;
    playing = true;
    playBtn.textContent = '\u23F8 Pause';
    stopBtn.disabled = false;
    tick();
  }

  function tick() {
    showFrame(currentFrame);
    currentFrame = (currentFrame + 1) % frames.length;
    const delay = Math.max(10, parseInt(delayInput.value) || 100);
    animTimer = setTimeout(tick, delay);
  }

  function pause() {
    playing = false;
    playBtn.textContent = '\u25B6 Play';
    if (animTimer) { clearTimeout(animTimer); animTimer = null; }
  }

  function stop() {
    pause();
    currentFrame = 0;
    showFrame(0);
    stopBtn.disabled = true;
  }

  playBtn.addEventListener('click', (e) => {
    e.stopPropagation();
    if (playing) pause();
    else play();
  });

  stopBtn.addEventListener('click', (e) => {
    e.stopPropagation();
    stop();
  });

  delayInput.addEventListener('click', (e) => e.stopPropagation());
  delayInput.addEventListener('keydown', (e) => e.stopPropagation());

  // Controller for external access
  player._anim = {
    init() {
      if (initialized) return;
      initialized = true;
      activeAnimControllers.push(player._anim);
      showFrame(0);
    },
    destroy() {
      pause();
    }
  };

  return player;
}

// ── Search Editor (Web Worker) ───────────────────────────────────────
let searchEditorOptions = { regex: false, caseSensitive: false, wholeWord: false };
/** The DOM element currently highlighted as the active match */
let propSearchCurrentEl = null;
/** Map from path → DOM element, built incrementally during lazy rendering */
let propPathMap = null;

/** Send the current IMG's property data to the worker so it can index it. */
function feedWorkerData(properties) {
  searchWorker.postMessage({ type: 'set-data', payload: properties });
}

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

/** Build a RegExp for highlighting matches in search results. */
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

/** Escape HTML then highlight regex matches with <mark> tags. */
function highlightAndEscape(text, regex) {
  if (!text) return '';
  if (!regex) return escapeHtml(text);
  const parts = text.split(regex);
  return parts.map((part, i) => i % 2 === 1 ? `<mark>${escapeHtml(part)}</mark>` : escapeHtml(part)).join('');
}

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

/** Navigate from search results to a property in the tree view. */
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

  // Ensure ancestors are lazily rendered
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

  // Highlight and scroll
  if (propSearchCurrentEl) propSearchCurrentEl.classList.remove('search-match', 'search-current');
  item.classList.add('search-match', 'search-current');
  propSearchCurrentEl = item;
  item.scrollIntoView({ behavior: 'smooth', block: 'center' });
  setTimeout(() => item.classList.remove('search-match', 'search-current'), 3000);
}

function setupSearchEditor() {
  const input = document.getElementById('search-editor-input');
  const countEl = document.getElementById('search-results-count');
  const resultsEl = document.getElementById('search-results');
  const propTree = document.getElementById('prop-tree');
  const regexBtn = document.getElementById('toggle-regex');
  const caseBtn = document.getElementById('toggle-case');
  const wordBtn = document.getElementById('toggle-word');
  if (!input) return;

  // Restore toggle state
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

// Global Ctrl+F to focus search editor input when an IMG is open
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

function formatPropValue(prop) {
  switch (prop.type) {
    case 'Short': case 'Int': case 'Long': return String(prop.value);
    case 'Float': case 'Double': return Number(prop.value).toFixed(4);
    case 'String': return `"${prop.value}"`;
    case 'UOL': return `-> ${prop.value}`;
    case 'Vector': return `(${prop.x}, ${prop.y})`;
    case 'Canvas': return `${prop.width}x${prop.height} fmt=${prop.format} [${formatBytes(prop.dataLength)}]`;
    case 'Sound': return `${prop.duration_ms}ms [${formatBytes(prop.dataLength)}]`;
    case 'Video': {
      let desc = `type=${prop.videoType} [${formatBytes(prop.dataLength)}]`;
      if (prop.mcv) desc += ` ${prop.mcv.width}x${prop.mcv.height} ${prop.mcv.frameCount}f`;
      return desc;
    }
    case 'Lua': case 'RawData': return `[${formatBytes(prop.dataLength)}]`;
    case 'Null': return 'null';
    default: return '';
  }
}

function countProps(props) {
  let count = 0;
  for (const p of props) {
    count++;
    if (p.children) count += countProps(p.children);
  }
  return count;
}

// ── Utilities ────────────────────────────────────────────────────────
function countNodes(tree) {
  let dirs = 0, images = 0;
  function walk(node) {
    for (const sub of node.subdirectories || []) { dirs++; walk(sub); }
    images += (node.images || []).length;
  }
  walk(tree);
  return { dirs, images };
}

function formatBytes(bytes) {
  if (bytes < 1024) return bytes + ' B';
  if (bytes < 1024 * 1024) return (bytes / 1024).toFixed(1) + ' KB';
  return (bytes / (1024 * 1024)).toFixed(1) + ' MB';
}

function escapeHtml(s) {
  const div = document.createElement('div');
  div.textContent = s;
  return div.innerHTML;
}
