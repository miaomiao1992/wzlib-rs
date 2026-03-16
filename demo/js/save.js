import {
  parseWzImageForEdit,
  parseHotfixForEdit,
  parseMsImageForEdit,
  parseMsFile,
  buildWzImage,
  buildWzFile,
  buildMsFile,
} from '../../ts-wrapper/wasm-pkg/wzlib_rs.js';
import { state, $ } from './state.js';
import { formatBytes } from './utils.js';

// ── Packed binary helpers ────────────────────────────────────────────

function unpackEditResult(packed) {
  const view = new DataView(packed.buffer, packed.byteOffset, packed.byteLength);
  let offset = 0;

  const jsonLen = view.getUint32(offset, true);
  offset += 4;
  const json = JSON.parse(new TextDecoder().decode(packed.subarray(offset, offset + jsonLen)));
  offset += jsonLen;

  const blobCount = view.getUint32(offset, true);
  offset += 4;
  const blobs = [];
  for (let i = 0; i < blobCount; i++) {
    const blobLen = view.getUint32(offset, true);
    offset += 4;
    blobs.push(packed.slice(offset, offset + blobLen));
    offset += blobLen;
  }

  return { properties: json, blobs };
}

function packBlobs(blobs) {
  let totalSize = 4;
  for (const b of blobs) totalSize += 4 + b.byteLength;

  const buf = new Uint8Array(totalSize);
  const view = new DataView(buf.buffer);
  let offset = 0;

  view.setUint32(offset, blobs.length, true);
  offset += 4;
  for (const b of blobs) {
    view.setUint32(offset, b.byteLength, true);
    offset += 4;
    buf.set(b, offset);
    offset += b.byteLength;
  }

  return buf;
}

// Collect images depth-first matching attach_image_data traversal order
function collectImages(dir) {
  const images = [];
  for (const img of dir.images) images.push(img);
  for (const sub of dir.subdirectories) images.push(...collectImages(sub));
  return images;
}

// ── Helpers ─────────────────────────────────────────────────────────

function downloadBlob(data, filename) {
  const blob = new Blob([data], { type: 'application/octet-stream' });
  const url = URL.createObjectURL(blob);
  const a = document.createElement('a');
  a.href = url;
  a.download = filename;
  a.click();
  URL.revokeObjectURL(url);
}

function withProgress(label, fn) {
  $.loading.classList.remove('hidden');
  $.loadingText.textContent = label;

  // Yield to the UI so the loading overlay renders before the sync WASM call
  return new Promise((resolve) => setTimeout(resolve, 0)).then(() => {
    try {
      const t0 = performance.now();
      const result = fn();
      const elapsed = (performance.now() - t0).toFixed(1);
      $.statusParse.textContent = `Saved in ${elapsed}ms (${formatBytes(result.length)})`;
      return result;
    } finally {
      $.loading.classList.add('hidden');
    }
  });
}

// ── Build a single image via parse-for-edit + buildWzImage ──────────

function buildImageFromWz(imgOffset, imgSize) {
  const packed = parseWzImageForEdit(state.wzData, state.wzVersionName, imgOffset, imgSize, state.wzVersionHash);
  const { properties, blobs } = unpackEditResult(packed);
  return buildWzImage(JSON.stringify(properties), packBlobs(blobs), state.wzVersionName);
}

function buildImageFromHotfix() {
  const packed = parseHotfixForEdit(state.wzData, state.wzVersionName);
  const { properties, blobs } = unpackEditResult(packed);
  return buildWzImage(JSON.stringify(properties), packBlobs(blobs), state.wzVersionName);
}

function buildImageFromMs(entryIndex) {
  const packed = parseMsImageForEdit(state.wzData, state.msFileName, entryIndex);
  const { properties, blobs } = unpackEditResult(packed);
  return buildWzImage(JSON.stringify(properties), packBlobs(blobs), 'bms');
}

// ── Save entire file ────────────────────────────────────────────────

export async function saveCurrentFile() {
  if (!state.wzData) return;

  try {
    switch (state.fileMode) {
      case 'standard': {
        const result = await withProgress('Saving WZ file...', () => {
          const images = collectImages(state.parsedTree);
          const imageBlobs = images.map((img) => {
            // Unchanged images: pass through original bytes (no parse/serialize round-trip)
            if (!state.modifiedImages?.has(img.offset)) {
              return state.wzData.slice(img.offset, img.offset + img.size);
            }
            return buildImageFromWz(img.offset, img.size);
          });
          return buildWzFile(
            JSON.stringify(state.parsedTree),
            packBlobs(imageBlobs),
            state.wzPatchVersion,
            state.wzVersionName,
            state.wzIs64bit,
          );
        });
        downloadBlob(result, state.fileName.replace(/\.wz$/i, '_saved.wz'));
        break;
      }
      case 'hotfix': {
        const result = await withProgress('Saving hotfix Data.wz...', () => buildImageFromHotfix());
        downloadBlob(result, state.fileName.replace(/\.wz$/i, '_saved.wz'));
        break;
      }
      case 'ms': {
        const result = await withProgress('Saving MS file (building all entries)...', () => {
          const parsed = JSON.parse(parseMsFile(state.wzData, state.msFileName));
          const entryDefs = parsed.entries.map((e) => ({ name: e.name, entryKey: e.entryKey }));
          const imageBlobs = parsed.entries.map((_, i) => buildImageFromMs(i));
          return buildMsFile(state.msFileName, state.msSalt, JSON.stringify(entryDefs), packBlobs(imageBlobs));
        });
        downloadBlob(result, state.fileName.replace(/\.ms$/i, '_saved.ms'));
        break;
      }
      case 'list':
        alert('List.wz files are read-only path indexes and cannot be saved.');
        return;
    }
  } catch (e) {
    $.loading.classList.add('hidden');
    alert(`Save error: ${e.message}`);
    console.error('Save error:', e);
  }
}

// ── Save individual image ───────────────────────────────────────────

export async function saveCurrentImage(imgOffset, imgName) {
  if (!state.wzData) return;

  try {
    const result = await withProgress(`Saving image ${imgName}...`, () =>
      buildImageFromWz(imgOffset, 0),
    );
    downloadBlob(result, imgName);
  } catch (e) {
    $.loading.classList.add('hidden');
    alert(`Save image error: ${e.message}`);
    console.error('Save image error:', e);
  }
}

export async function saveCurrentMsImage(entryIndex, entryName) {
  if (!state.wzData) return;

  try {
    const result = await withProgress(`Saving MS entry ${entryName}...`, () =>
      buildImageFromMs(entryIndex),
    );
    const shortName = entryName.includes('/') ? entryName.split('/').pop() : entryName;
    downloadBlob(result, shortName);
  } catch (e) {
    $.loading.classList.add('hidden');
    alert(`Save image error: ${e.message}`);
    console.error('Save image error:', e);
  }
}
