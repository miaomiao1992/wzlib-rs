# wzlib-rs Demo

A simple browser-based WZ file explorer powered by the `wzlib-rs` WASM module. No build tools required — just a static file server.

## Running

```bash
# From the project root
node demo/serve.mjs

# Open in browser
# http://localhost:8080
```

The server listens on port 8080 and serves files from the project root with correct MIME types (including `application/wasm`).

## Usage

1. **Select encryption version** — Use the dropdown in the top-right corner:
   - **BMS / Classic** — Most modern WZ files (post-2022), unencrypted
   - **GMS** — Global MapleStory
   - **EMS / MSEA** — Europe / Southeast Asia

2. **Load a `.wz` file** — Drag and drop onto the page, or click to browse

3. **Browse the directory tree** — Left sidebar shows folders and `.img` entries
   - Click folders to expand/collapse
   - Use the search box to filter by name

4. **Inspect IMG properties** — Click any `.img` entry to parse and display its property tree
   - Properties are color-coded: strings in green, numbers in gold, UOL links in red
   - Type badges show the property type (Int, String, Canvas, Sound, etc.)

5. **View images** — Expand a `Canvas` property to decode and display the image
   - Checkerboard background shows transparency
   - Click the image to toggle between fit-to-400px and actual size

6. **Play sounds** — Expand a `Sound` property to load the audio player
   - Play / Stop buttons
   - Volume slider (0–100%)
   - Duration and file size shown

## How It Works

The demo uses the WASM module directly (no bundler):

```
index.html  ─── styles.css
  └── app.js
        ├── imports from ../ts-wrapper/wasm-pkg/wzlib_rs.js
        │     └── loads wzlib_rs_bg.wasm (~100KB)
        │
        ├── parseWzFile()      → directory tree JSON
        ├── parseWzImage()     → IMG property tree JSON
        ├── decodeWzCanvas()   → RGBA pixel bytes → <canvas>
        └── extractWzSound()   → MP3 bytes → Audio API
```

All parsing and decoding happens in WASM. The JS layer handles UI rendering and user interaction.

## Files

| File | Description |
|---|---|
| `index.html` | Page structure — links CSS and JS |
| `styles.css` | All styles for the demo UI |
| `app.js` | Application logic — WASM integration, tree rendering, canvas/sound/animation |
| `serve.mjs` | Zero-dependency Node.js HTTP server with WASM MIME support |

## Notes

- WASM files must be served with `Content-Type: application/wasm` — the included server handles this
- The demo stores the full `.wz` file in memory (`Uint8Array`) for re-parsing individual IMGs on demand
- Canvas images and parsed IMGs are cached in memory to avoid re-decoding
- Only one sound plays at a time — starting a new one stops the previous
