// ── Shared mutable state ─────────────────────────────────────────────
export const state = {
  wasmReady: false,
  parsedTree: null,
  selectedNode: null,
  wzData: null,           // Uint8Array of the full .wz/.ms file
  wzVersionHash: 0,       // version hash from parsing
  wzVersionName: '',      // "gms", "ems", "bms"
  fileMode: 'standard',   // 'standard' | 'hotfix' | 'list' | 'ms'
  msFileName: '',         // original .ms filename for key derivation
  currentMsEntryIndex: -1,
  currentImgOffset: 0,
  activeAnimControllers: [],
  currentAudio: null,
  currentPlayBtn: null,
  currentStopBtn: null,
};

// ── Lazy property tree rendering state ───────────────────────────────
export let propChildrenData = new Map();  // path → { children, type }
export let childContainerMap = new Map(); // path → child container DOM element
export let propPathMap = null;            // path → prop-item DOM element

export function resetPropertyState() {
  propPathMap = new Map();
  propChildrenData = new Map();
  childContainerMap = new Map();
}

// ── Caches ───────────────────────────────────────────────────────────
export const imgCache = new Map();  // offset → parsed properties
export const msImgCache = new Map(); // entryIndex → parsed properties

// ── DOM refs ─────────────────────────────────────────────────────────
export const $ = {
  loading:     document.getElementById('loading'),
  loadingText: document.getElementById('loading-text'),
  dropZone:    document.getElementById('drop-zone'),
  main:        document.getElementById('main'),
  fileInput:   document.getElementById('file-input'),
  fileName:    document.getElementById('file-name'),
  fileStats:   document.getElementById('file-stats'),
  searchBox:   document.getElementById('search-box'),
  tree:        document.getElementById('tree-container'),
  detail:      document.getElementById('detail-content'),
  detailEmpty: document.getElementById('detail-empty'),
  statusWasm:  document.getElementById('status-wasm'),
  statusFile:  document.getElementById('status-file'),
  statusParse: document.getElementById('status-parse'),
  version:     document.getElementById('version-select'),
};
