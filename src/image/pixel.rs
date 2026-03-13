//! Pixel format conversion routines.
//!
//! All output is RGBA8888 (4 bytes per pixel: R, G, B, A).

use crate::wz::error::{WzError, WzResult};

/// Validates input length and allocates the RGBA output buffer.
fn init_rgba(data: &[u8], pixel_count: usize, bytes_per_pixel: usize, format: &str) -> WzResult<Vec<u8>> {
    if data.len() < pixel_count * bytes_per_pixel {
        return Err(WzError::DecompressionFailed(
            format!("{} data too short", format),
        ));
    }
    Ok(vec![0u8; pixel_count * 4])
}

pub fn bgra4444_to_rgba(data: &[u8], pixel_count: usize) -> WzResult<Vec<u8>> {
    let mut rgba = init_rgba(data, pixel_count, 2, "BGRA4444")?;

    for i in 0..pixel_count {
        let lo = data[i * 2];
        let hi = data[i * 2 + 1];

        // BGRA4444: lo = [B3..B0 | G3..G0], hi = [R3..R0 | A3..A0]
        let b4 = lo & 0x0F;
        let g4 = (lo >> 4) & 0x0F;
        let r4 = hi & 0x0F;
        let a4 = (hi >> 4) & 0x0F;

        // Expand 4-bit to 8-bit: duplicate nibble
        rgba[i * 4] = r4 | (r4 << 4);
        rgba[i * 4 + 1] = g4 | (g4 << 4);
        rgba[i * 4 + 2] = b4 | (b4 << 4);
        rgba[i * 4 + 3] = a4 | (a4 << 4);
    }

    Ok(rgba)
}

pub fn bgra8888_to_rgba(data: &[u8], pixel_count: usize) -> WzResult<Vec<u8>> {
    let mut rgba = init_rgba(data, pixel_count, 4, "BGRA8888")?;

    for i in 0..pixel_count {
        let b = data[i * 4];
        let g = data[i * 4 + 1];
        let r = data[i * 4 + 2];
        let a = data[i * 4 + 3];

        rgba[i * 4] = r;
        rgba[i * 4 + 1] = g;
        rgba[i * 4 + 2] = b;
        rgba[i * 4 + 3] = a;
    }

    Ok(rgba)
}

pub fn argb1555_to_rgba(data: &[u8], pixel_count: usize) -> WzResult<Vec<u8>> {
    let mut rgba = init_rgba(data, pixel_count, 2, "ARGB1555")?;

    for i in 0..pixel_count {
        let val = u16::from_le_bytes([data[i * 2], data[i * 2 + 1]]);

        let a1 = (val >> 15) & 0x01;
        let r5 = (val >> 10) & 0x1F;
        let g5 = (val >> 5) & 0x1F;
        let b5 = val & 0x1F;

        // Expand 5-bit to 8-bit
        rgba[i * 4] = ((r5 << 3) | (r5 >> 2)) as u8;
        rgba[i * 4 + 1] = ((g5 << 3) | (g5 >> 2)) as u8;
        rgba[i * 4 + 2] = ((b5 << 3) | (b5 >> 2)) as u8;
        rgba[i * 4 + 3] = if a1 != 0 { 0xFF } else { 0x00 };
    }

    Ok(rgba)
}

pub fn rgb565_to_rgba(data: &[u8], pixel_count: usize) -> WzResult<Vec<u8>> {
    let mut rgba = init_rgba(data, pixel_count, 2, "RGB565")?;

    for i in 0..pixel_count {
        let val = u16::from_le_bytes([data[i * 2], data[i * 2 + 1]]);
        let (r, g, b) = rgb565_decode(val);

        rgba[i * 4] = r;
        rgba[i * 4 + 1] = g;
        rgba[i * 4 + 2] = b;
        rgba[i * 4 + 3] = 0xFF;
    }

    Ok(rgba)
}

pub fn rgb565_block_to_rgba(data: &[u8], width: u32, height: u32) -> WzResult<Vec<u8>> {
    let pixel_count = (width * height) as usize;
    let mut rgba = vec![0u8; pixel_count * 4];

    let blocks_x = (width / 16) as usize;
    let blocks_y = (height / 16) as usize;

    let mut data_idx = 0;
    for by in 0..blocks_y {
        for bx in 0..blocks_x {
            if data_idx + 2 > data.len() {
                break;
            }
            let val = u16::from_le_bytes([data[data_idx], data[data_idx + 1]]);
            let (r, g, b) = rgb565_decode(val);
            data_idx += 2;

            // Fill 16x16 block with the same color
            for dy in 0..16u32 {
                for dx in 0..16u32 {
                    let px = bx as u32 * 16 + dx;
                    let py = by as u32 * 16 + dy;
                    if px < width && py < height {
                        let idx = (py * width + px) as usize * 4;
                        rgba[idx] = r;
                        rgba[idx + 1] = g;
                        rgba[idx + 2] = b;
                        rgba[idx + 3] = 0xFF;
                    }
                }
            }
        }
    }

    Ok(rgba)
}

pub fn r16_to_rgba(data: &[u8], pixel_count: usize) -> WzResult<Vec<u8>> {
    let mut rgba = init_rgba(data, pixel_count, 2, "R16")?;

    for i in 0..pixel_count {
        let val = u16::from_le_bytes([data[i * 2], data[i * 2 + 1]]);
        rgba[i * 4] = (val >> 8) as u8;     // R (high byte of 16-bit)
        rgba[i * 4 + 1] = 0;                // G
        rgba[i * 4 + 2] = 0;                // B
        rgba[i * 4 + 3] = 0xFF;             // A
    }

    Ok(rgba)
}

pub fn a8_to_rgba(data: &[u8], pixel_count: usize) -> WzResult<Vec<u8>> {
    let mut rgba = init_rgba(data, pixel_count, 1, "A8")?;

    for i in 0..pixel_count {
        rgba[i * 4] = 0xFF;         // R
        rgba[i * 4 + 1] = 0xFF;     // G
        rgba[i * 4 + 2] = 0xFF;     // B
        rgba[i * 4 + 3] = data[i];  // A
    }

    Ok(rgba)
}

pub fn rgba1010102_to_rgba(data: &[u8], pixel_count: usize) -> WzResult<Vec<u8>> {
    let mut rgba = init_rgba(data, pixel_count, 4, "RGBA1010102")?;

    for i in 0..pixel_count {
        let val = u32::from_le_bytes([
            data[i * 4],
            data[i * 4 + 1],
            data[i * 4 + 2],
            data[i * 4 + 3],
        ]);

        let r10 = val & 0x3FF;
        let g10 = (val >> 10) & 0x3FF;
        let b10 = (val >> 20) & 0x3FF;
        let a2 = (val >> 30) & 0x3;

        // Scale 10-bit → 8-bit (>> 2), 2-bit → 8-bit (* 85)
        rgba[i * 4] = (r10 >> 2) as u8;
        rgba[i * 4 + 1] = (g10 >> 2) as u8;
        rgba[i * 4 + 2] = (b10 >> 2) as u8;
        rgba[i * 4 + 3] = (a2 * 85) as u8;
    }

    Ok(rgba)
}

pub fn rgba32float_to_rgba(data: &[u8], pixel_count: usize) -> WzResult<Vec<u8>> {
    let mut rgba = init_rgba(data, pixel_count, 16, "RGBA32Float")?;

    for i in 0..pixel_count {
        let off = i * 16;
        let r = f32::from_le_bytes([data[off], data[off + 1], data[off + 2], data[off + 3]]);
        let g = f32::from_le_bytes([data[off + 4], data[off + 5], data[off + 6], data[off + 7]]);
        let b =
            f32::from_le_bytes([data[off + 8], data[off + 9], data[off + 10], data[off + 11]]);
        let a =
            f32::from_le_bytes([data[off + 12], data[off + 13], data[off + 14], data[off + 15]]);

        rgba[i * 4] = (r.clamp(0.0, 1.0) * 255.0) as u8;
        rgba[i * 4 + 1] = (g.clamp(0.0, 1.0) * 255.0) as u8;
        rgba[i * 4 + 2] = (b.clamp(0.0, 1.0) * 255.0) as u8;
        rgba[i * 4 + 3] = (a.clamp(0.0, 1.0) * 255.0) as u8;
    }

    Ok(rgba)
}

#[inline]
pub fn rgb565_decode(val: u16) -> (u8, u8, u8) {
    let r5 = (val >> 11) & 0x1F;
    let g6 = (val >> 5) & 0x3F;
    let b5 = val & 0x1F;

    let r = ((r5 << 3) | (r5 >> 2)) as u8;
    let g = ((g6 << 2) | (g6 >> 4)) as u8;
    let b = ((b5 << 3) | (b5 >> 2)) as u8;

    (r, g, b)
}

#[cfg(test)]
mod tests {
    use super::*;

    // ── rgb565_decode ──────────────────────────────────────────────

    #[test]
    fn test_rgb565_white() {
        let (r, g, b) = rgb565_decode(0xFFFF);
        assert_eq!((r, g, b), (0xFF, 0xFF, 0xFF));
    }

    #[test]
    fn test_rgb565_black() {
        let (r, g, b) = rgb565_decode(0x0000);
        assert_eq!((r, g, b), (0, 0, 0));
    }

    #[test]
    fn test_rgb565_pure_red() {
        // Red = bits 15:11 all set, rest 0 → 0xF800
        let (r, g, b) = rgb565_decode(0xF800);
        assert_eq!((r, g, b), (0xFF, 0, 0));
    }

    // ── bgra8888_to_rgba ───────────────────────────────────────────

    #[test]
    fn test_bgra8888_to_rgba_swap() {
        let bgra = vec![0x00, 0x80, 0xFF, 0xC0]; // B=0, G=128, R=255, A=192
        let rgba = bgra8888_to_rgba(&bgra, 1).unwrap();
        assert_eq!(rgba, vec![0xFF, 0x80, 0x00, 0xC0]); // R=255, G=128, B=0, A=192
    }

    #[test]
    fn test_bgra8888_too_short() {
        assert!(bgra8888_to_rgba(&[0, 0, 0], 1).is_err());
    }

    // ── bgra4444_to_rgba ───────────────────────────────────────────

    #[test]
    fn test_bgra4444_all_ones() {
        // lo=0xFF (B=0xF, G=0xF), hi=0xFF (R=0xF, A=0xF)
        let rgba = bgra4444_to_rgba(&[0xFF, 0xFF], 1).unwrap();
        assert_eq!(rgba, vec![0xFF, 0xFF, 0xFF, 0xFF]);
    }

    #[test]
    fn test_bgra4444_all_zeros() {
        let rgba = bgra4444_to_rgba(&[0x00, 0x00], 1).unwrap();
        assert_eq!(rgba, vec![0, 0, 0, 0]);
    }

    #[test]
    fn test_bgra4444_specific_nibbles() {
        // lo=0x21 → B=1, G=2; hi=0x43 → R=3, A=4
        // B=1 → 0x11, G=2 → 0x22, R=3 → 0x33, A=4 → 0x44
        let rgba = bgra4444_to_rgba(&[0x21, 0x43], 1).unwrap();
        assert_eq!(rgba, vec![0x33, 0x22, 0x11, 0x44]);
    }

    #[test]
    fn test_bgra4444_too_short() {
        assert!(bgra4444_to_rgba(&[0x00], 1).is_err());
    }

    // ── argb1555_to_rgba ───────────────────────────────────────────

    #[test]
    fn test_argb1555_white_opaque() {
        // All bits set: A=1, R=31, G=31, B=31 → 0xFFFF
        let rgba = argb1555_to_rgba(&[0xFF, 0xFF], 1).unwrap();
        assert_eq!(rgba, vec![0xFF, 0xFF, 0xFF, 0xFF]);
    }

    #[test]
    fn test_argb1555_black_transparent() {
        let rgba = argb1555_to_rgba(&[0x00, 0x00], 1).unwrap();
        assert_eq!(rgba, vec![0, 0, 0, 0]);
    }

    #[test]
    fn test_argb1555_alpha_bit() {
        // A=1, R=0, G=0, B=0 → 0x8000
        let rgba = argb1555_to_rgba(&[0x00, 0x80], 1).unwrap();
        assert_eq!(rgba[3], 0xFF); // alpha on
        assert_eq!(rgba[0], 0);    // R=0
    }

    #[test]
    fn test_argb1555_too_short() {
        assert!(argb1555_to_rgba(&[0x00], 1).is_err());
    }

    // ── rgb565_to_rgba ─────────────────────────────────────────────

    #[test]
    fn test_rgb565_to_rgba_white() {
        let rgba = rgb565_to_rgba(&[0xFF, 0xFF], 1).unwrap();
        assert_eq!(rgba, vec![0xFF, 0xFF, 0xFF, 0xFF]); // always opaque
    }

    #[test]
    fn test_rgb565_to_rgba_black() {
        let rgba = rgb565_to_rgba(&[0x00, 0x00], 1).unwrap();
        assert_eq!(rgba, vec![0, 0, 0, 0xFF]); // opaque black
    }

    #[test]
    fn test_rgb565_to_rgba_too_short() {
        assert!(rgb565_to_rgba(&[0x00], 1).is_err());
    }

    // ── r16_to_rgba ────────────────────────────────────────────────

    #[test]
    fn test_r16_zero() {
        let rgba = r16_to_rgba(&[0x00, 0x00], 1).unwrap();
        assert_eq!(rgba, vec![0, 0, 0, 0xFF]);
    }

    #[test]
    fn test_r16_max() {
        let rgba = r16_to_rgba(&[0xFF, 0xFF], 1).unwrap();
        assert_eq!(rgba, vec![0xFF, 0, 0, 0xFF]);
    }

    #[test]
    fn test_r16_mid() {
        // 0x8000 → high byte = 0x80
        let rgba = r16_to_rgba(&[0x00, 0x80], 1).unwrap();
        assert_eq!(rgba[0], 0x80);
        assert_eq!(rgba[3], 0xFF);
    }

    #[test]
    fn test_r16_too_short() {
        assert!(r16_to_rgba(&[0x00], 1).is_err());
    }

    // ── a8_to_rgba ─────────────────────────────────────────────────

    #[test]
    fn test_a8_transparent() {
        let rgba = a8_to_rgba(&[0x00], 1).unwrap();
        assert_eq!(rgba, vec![0xFF, 0xFF, 0xFF, 0x00]);
    }

    #[test]
    fn test_a8_opaque() {
        let rgba = a8_to_rgba(&[0xFF], 1).unwrap();
        assert_eq!(rgba, vec![0xFF, 0xFF, 0xFF, 0xFF]);
    }

    #[test]
    fn test_a8_mid() {
        let rgba = a8_to_rgba(&[0x80], 1).unwrap();
        assert_eq!(rgba, vec![0xFF, 0xFF, 0xFF, 0x80]);
    }

    #[test]
    fn test_a8_too_short() {
        assert!(a8_to_rgba(&[], 1).is_err());
    }

    // ── rgba1010102_to_rgba ────────────────────────────────────────

    #[test]
    fn test_rgba1010102_all_ones() {
        let rgba = rgba1010102_to_rgba(&[0xFF, 0xFF, 0xFF, 0xFF], 1).unwrap();
        // R10=1023→255, G10=1023→255, B10=1023→255, A2=3→255
        assert_eq!(rgba, vec![0xFF, 0xFF, 0xFF, 0xFF]);
    }

    #[test]
    fn test_rgba1010102_all_zeros() {
        let rgba = rgba1010102_to_rgba(&[0x00, 0x00, 0x00, 0x00], 1).unwrap();
        assert_eq!(rgba, vec![0, 0, 0, 0]);
    }

    #[test]
    fn test_rgba1010102_too_short() {
        assert!(rgba1010102_to_rgba(&[0, 0, 0], 1).is_err());
    }

    // ── rgba32float_to_rgba ────────────────────────────────────────

    #[test]
    fn test_rgba32float_black_transparent() {
        let data: Vec<u8> = [0.0f32, 0.0, 0.0, 0.0]
            .iter()
            .flat_map(|f| f.to_le_bytes())
            .collect();
        let rgba = rgba32float_to_rgba(&data, 1).unwrap();
        assert_eq!(rgba, vec![0, 0, 0, 0]);
    }

    #[test]
    fn test_rgba32float_white_opaque() {
        let data: Vec<u8> = [1.0f32, 1.0, 1.0, 1.0]
            .iter()
            .flat_map(|f| f.to_le_bytes())
            .collect();
        let rgba = rgba32float_to_rgba(&data, 1).unwrap();
        assert_eq!(rgba, vec![255, 255, 255, 255]);
    }

    #[test]
    fn test_rgba32float_clamps_above_one() {
        let data: Vec<u8> = [2.0f32, -1.0, 0.5, 1.5]
            .iter()
            .flat_map(|f| f.to_le_bytes())
            .collect();
        let rgba = rgba32float_to_rgba(&data, 1).unwrap();
        assert_eq!(rgba[0], 255); // clamped to 1.0
        assert_eq!(rgba[1], 0);   // clamped to 0.0
        assert_eq!(rgba[2], 127); // 0.5 * 255 = 127
        assert_eq!(rgba[3], 255); // clamped to 1.0
    }

    #[test]
    fn test_rgba32float_too_short() {
        assert!(rgba32float_to_rgba(&[0; 15], 1).is_err());
    }
}
