import type {
  MsEntryInfo,
  WasmExports,
  WzDirectoryTree,
  WzFileType,
  WzMapleVersion,
  WzPngFormat,
  WzPropertyNode,
} from './types.js';
import { WzNode, WzNodeType } from './wz-node.js';

/** High-level WZ file parser wrapping the WASM module. */
export class WzParser {
  private wasm: WasmExports;

  private constructor(wasm: WasmExports) {
    this.wasm = wasm;
  }

  static async create(wasmUrl?: string | URL): Promise<WzParser> {
    // @ts-ignore — wasm-pkg is generated at build time
    const wasmModule = await import('../wasm-pkg/wzlib_rs.js');
    await wasmModule.default(wasmUrl);
    return new WzParser(wasmModule as unknown as WasmExports);
  }

  // ── File type detection ───────────────────────────────────────────

  /** Detect whether `data` is a standard WZ, hotfix Data.wz, or List.wz. */
  detectFileType(data: Uint8Array): WzFileType {
    return this.wasm.detectWzFileType(data);
  }

  // ── Standard WZ ───────────────────────────────────────────────────

  parseFile(data: Uint8Array, version: WzMapleVersion, patchVersion?: number): WzNode {
    const json = this.wasm.parseWzFile(data, version, patchVersion);
    const tree: WzDirectoryTree = JSON.parse(json);
    return this.buildTree(tree);
  }

  // ── List.wz ───────────────────────────────────────────────────────

  /** Parse a List.wz file, returning the list of .img paths it indexes. */
  parseListFile(data: Uint8Array, version: WzMapleVersion): string[] {
    const json = this.wasm.parseWzListFile(data, version);
    return JSON.parse(json);
  }

  // ── Hotfix Data.wz ────────────────────────────────────────────────

  /** Parse a hotfix Data.wz file (entire file is a single WzImage). */
  parseHotfixFile(data: Uint8Array, version: WzMapleVersion): WzPropertyNode[] {
    const json = this.wasm.parseHotfixDataWz(data, version);
    return JSON.parse(json);
  }

  // ── Image / pixel decoding ────────────────────────────────────────

  decompressPng(compressed: Uint8Array, wzKey?: Uint8Array): Uint8Array {
    return this.wasm.decompressPngData(compressed, wzKey);
  }

  decodePixels(raw: Uint8Array, width: number, height: number, format: WzPngFormat): Uint8Array {
    return this.wasm.decodePixels(raw, width, height, format);
  }

  decodeCanvas(
    compressedPng: Uint8Array,
    width: number,
    height: number,
    format: WzPngFormat,
  ): Uint8Array {
    const raw = this.decompressPng(compressedPng);
    return this.decodePixels(raw, width, height, format);
  }

  toImageData(rgba: Uint8Array, width: number, height: number): ImageData {
    const copy = new Uint8ClampedArray(rgba.length);
    copy.set(rgba);
    return new ImageData(copy, width, height);
  }

  // ── Key / version utilities ───────────────────────────────────────

  generateKey(iv: Uint8Array, size: number): Uint8Array {
    return this.wasm.generateWzKey(iv, size);
  }

  getVersionIv(version: WzMapleVersion): Uint8Array {
    return this.wasm.getVersionIv(version);
  }

  computeVersionHash(version: number): number {
    return this.wasm.computeVersionHash(version);
  }

  // ── MS file (.ms) ──────────────────────────────────────────────────

  /** Parse a .ms file, returning the list of entry metadata. */
  parseMsFile(data: Uint8Array, fileName: string): MsEntryInfo[] {
    const json = this.wasm.parseMsFile(data, fileName);
    const parsed: { entries: MsEntryInfo[] } = JSON.parse(json);
    return parsed.entries;
  }

  /** Decrypt and parse a single .ms entry as a WZ image property tree. */
  parseMsImage(data: Uint8Array, fileName: string, entryIndex: number): WzPropertyNode[] {
    const json = this.wasm.parseMsImage(data, fileName, entryIndex);
    return JSON.parse(json);
  }

  /** Decode a canvas from a .ms entry. Returns `[width_le32, height_le32, ...rgba]`. */
  decodeMsCanvas(
    data: Uint8Array,
    fileName: string,
    entryIndex: number,
    propPath: string,
  ): Uint8Array {
    return this.wasm.decodeMsCanvas(data, fileName, entryIndex, propPath);
  }

  /** Extract raw video bytes from a standard WZ file. */
  extractVideo(
    data: Uint8Array,
    versionName: WzMapleVersion,
    imgOffset: number,
    versionHash: number,
    propPath: string,
  ): Uint8Array {
    return this.wasm.extractWzVideo(data, versionName, imgOffset, versionHash, propPath);
  }

  /** Extract raw video bytes from a .ms entry. */
  extractMsVideo(
    data: Uint8Array,
    fileName: string,
    entryIndex: number,
    propPath: string,
  ): Uint8Array {
    return this.wasm.extractMsVideo(data, fileName, entryIndex, propPath);
  }

  /** Extract sound data from a .ms entry. */
  extractMsSound(
    data: Uint8Array,
    fileName: string,
    entryIndex: number,
    propPath: string,
  ): Uint8Array {
    return this.wasm.extractMsSound(data, fileName, entryIndex, propPath);
  }

  // ── Internal ──────────────────────────────────────────────────────

  private buildTree(dir: WzDirectoryTree): WzNode {
    const node = new WzNode(dir.name || 'root', WzNodeType.Directory);

    for (const subdir of dir.subdirectories) {
      node.addChild(this.buildTree(subdir));
    }

    for (const img of dir.images) {
      const imgNode = new WzNode(img.name, WzNodeType.Image, {
        size: img.size,
        checksum: img.checksum,
        offset: img.offset,
      });
      node.addChild(imgNode);
    }

    return node;
  }
}
