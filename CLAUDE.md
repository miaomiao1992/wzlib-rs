# CLAUDE.md

This file provides guidance to Claude Code (claude.ai/code) when working with code in this repository.

## Project Overview

MapleStory WZ file parser written in Rust, compiled to WebAssembly via wasm-pack, with a TypeScript wrapper for browser usage. Parses encrypted binary WZ archives (directory trees, image property trees, Canvas images with DXT decompression, Sound extraction).

## Build Commands

```bash
# Rust tests
cargo test

# Build WASM (outputs to ts-wrapper/wasm-pkg/)
wasm-pack build --target web --out-dir ts-wrapper/wasm-pkg

# TypeScript wrapper
cd ts-wrapper && npm install && npx tsc

# All-in-one build (from ts-wrapper/)
npm run build

# Run demo server at http://localhost:8080
node demo/serve.mjs
```

## Testing

tests across various source files. All tests are inline (`#[cfg(test)]` modules) using synthetic byte arrays — no external test data files needed.

```bash
cargo test --lib              # Run all unit tests
cargo llvm-cov --lib          # Coverage report (requires cargo-llvm-cov)
cargo llvm-cov --lib --html   # HTML coverage report
```

## Architecture

**Three-layer stack:** Rust core → WASM (wasm-bindgen) → TypeScript wrapper

### Rust Core (`src/`)

- **`wasm_api.rs`** — All wasm-bindgen exports. This is the WASM boundary; complex data crosses via JSON serialization, binary data (canvas pixels, audio) as raw bytes.
- **`crypto/`** — MapleStory encryption: AES-256-ECB key generation (`aes_encryption.rs`), Snow 2.0 stream cipher (`snow2.rs`), byte-level custom cipher, IV shuffling. Three IV variants: GMS `[0x4D,0x23,0xC7,0x2B]`, EMS/MSEA `[0xB9,0x7D,0x63,0xE9]`, BMS/Classic `[0x00,0x00,0x00,0x00]`.
- **`wz/`** — Binary format parsing:
  - `file.rs` — Top-level WZ file: PKG1 header, 64-bit format detection (v770+), brute-force version detection (0–2000) with CRC32 validation. Also: `WzFileType` enum and `detect_file_type()` for distinguishing standard/hotfix/list formats, `parse_hotfix_data_wz()` for headerless Data.wz files.
  - `binary_reader.rs` — Encrypted int/string/offset reading with lazy key generation.
  - `directory.rs` — Directory tree parsing (entry types 1–4: skip, string-ref, subdirectory, image).
  - `image.rs` — IMG property tree parsing, produces `WzProperty` enum (16 variants: Null, Short, Int, Long, Float, Double, String, SubProperty, Canvas, Convex, Sound, Vector, Uol, Lua, RawData, Video).
  - `list_file.rs` — List.wz parser (pre-Big Bang path index). Different binary format: `[i32 len][u16 chars × len][u16 null]` entries, XOR-encrypted with WZ key (no incremental mask).
  - `properties/mod.rs` — `WzProperty` enum definition and serialization.
- **`image/`** — Pixel format decoders (BGRA4444, BGRA8888, ARGB1555, RGB565, DXT3, DXT5) all converting to RGBA8888. Handles zlib decompression and encrypted block formats.

### TypeScript Wrapper (`ts-wrapper/src/`)

- **`wz-parser.ts`** — `WzParser` class: loads WASM, exposes `parseFile()`, `detectFileType()`, `parseListFile()`, `parseHotfixFile()`, `decodeCanvas()`, `toImageData()`.
- **`wz-node.ts`** — `WzNode` class: tree navigation with `getChild()`, `resolve()`, `walk()`. Slash-separated paths (e.g., `"0/info/icon"`).
- **`types.ts`** — `WzMapleVersion`, `WzFileType`, `WzPngFormat`, `WzPropertyNode`, `WasmExports` interface, directory tree types.

### Data Flow

**Standard WZ files:**
1. Full `.wz` file loaded as `Uint8Array` in JS
2. `detectWzFileType()` → `"standard"`, `"hotfix"`, or `"list"`
3. `parseWzFile()` → returns JSON directory tree + version hash
4. `parseWzImage()` → returns JSON property tree (no binary data)
5. `decodeWzCanvas()` / `extractWzSound()` → returns raw bytes on demand (binary data fetched lazily, not included in JSON)

**Hotfix Data.wz:** No PKG1 header — first byte is `0x73`. Entire file is a single WzImage. `parseHotfixDataWz()` parses directly. `parseWzImage()`/`decodeWzCanvas()`/`extractWzSound()` auto-detect hotfix files.

**List.wz (pre-Big Bang):** Not PKG1 format. `parseWzListFile()` returns a JSON array of `.img` path strings.

## Key Patterns

- **WASM ↔ TypeScript sync:** When adding or changing `#[wasm_bindgen]` exports in `wasm_api.rs`, always update the `WasmExports` interface in `ts-wrapper/src/types.ts`, add a corresponding method to `WzParser` in `wz-parser.ts`, and import the new function in `demo/app.js` if the demo uses it.

- **Lazy key generation:** WZ decryption keys computed on first use, cached in `WzBinaryReader`.
- **JSON for structured data, raw bytes for binary:** WASM boundary uses JSON serialization for trees, `Uint8Array` for pixels/audio.
- **Canvas decode returns `[width_le32, height_le32, ...rgba_bytes]`** — first 8 bytes are little-endian dimensions.
- **Version detection is brute-force:** Iterates patch versions 0–2000, validates via CRC32 hash against header.
- **Crate type is `["cdylib", "rlib"]`:** builds both WASM binary and Rust library.
- **WASM optimized for size:** `opt-level = "s"`, LTO enabled.

## Comment Conventions

Code should be self-explanatory. Minimize comments — only add them when the code alone cannot convey the intent.

### Keep
- **Module `//!` headers** (Rust) — one line: file purpose + port origin if applicable
- **Why comments** — explain *why*, never *what* (C# compatibility quirks, design decisions, non-obvious constraints)
- **Format specs** — bit-field layouts, encoding schemes, magic byte meanings, algorithm steps not expressible through naming
- **Section dividers** — `// ── Title ──────…` in large files for organization
- **Reference annotations** — IV values, format IDs, constants whose meaning isn't obvious from the name

### Remove
- Doc comments (`///` / `/** */`) that restate the function/type name or signature
- Parameter docs that mirror the type signature
- Inline comments describing *what* the next line does when the code is clear
- Trivial getter/setter/accessor doc comments

### Rule of thumb
> If deleting the comment and reading just the code + names leaves you equally informed, delete the comment.