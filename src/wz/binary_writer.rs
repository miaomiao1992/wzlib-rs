//! WZ binary writer — writes encrypted strings, compressed ints, and offsets.
//!
//! Ported from MapleLib's `WzBinaryWriter.cs`.

use std::collections::HashMap;
use std::io::{Seek, SeekFrom, Write};

use super::error::WzResult;
use super::header::WzHeader;
use super::keys::WzKey;
use crate::crypto::constants::WZ_OFFSET_CONSTANT;

pub struct WzBinaryWriter<W: Write + Seek> {
    writer: W,
    pub wz_key: WzKey,
    pub hash: u32,
    pub header: WzHeader,
    pub string_cache: HashMap<String, u32>,
}

impl<W: Write + Seek> WzBinaryWriter<W> {
    pub fn new(writer: W, iv: [u8; 4], header: WzHeader) -> Self {
        WzBinaryWriter {
            writer,
            wz_key: WzKey::new(iv),
            hash: 0,
            header,
            string_cache: HashMap::new(),
        }
    }

    pub fn position(&mut self) -> WzResult<u64> {
        Ok(self.writer.stream_position()?)
    }

    pub fn seek(&mut self, pos: u64) -> WzResult<()> {
        self.writer.seek(SeekFrom::Start(pos))?;
        Ok(())
    }

    // ── Primitive writes ─────────────────────────────────────────────

    pub fn write_u8(&mut self, val: u8) -> WzResult<()> {
        self.writer.write_all(&[val])?;
        Ok(())
    }

    pub fn write_i16(&mut self, val: i16) -> WzResult<()> {
        self.writer.write_all(&val.to_le_bytes())?;
        Ok(())
    }

    pub fn write_u16(&mut self, val: u16) -> WzResult<()> {
        self.writer.write_all(&val.to_le_bytes())?;
        Ok(())
    }

    pub fn write_i32(&mut self, val: i32) -> WzResult<()> {
        self.writer.write_all(&val.to_le_bytes())?;
        Ok(())
    }

    pub fn write_u32(&mut self, val: u32) -> WzResult<()> {
        self.writer.write_all(&val.to_le_bytes())?;
        Ok(())
    }

    pub fn write_i64(&mut self, val: i64) -> WzResult<()> {
        self.writer.write_all(&val.to_le_bytes())?;
        Ok(())
    }

    pub fn write_f32(&mut self, val: f32) -> WzResult<()> {
        self.writer.write_all(&val.to_le_bytes())?;
        Ok(())
    }

    pub fn write_f64(&mut self, val: f64) -> WzResult<()> {
        self.writer.write_all(&val.to_le_bytes())?;
        Ok(())
    }

    pub fn write_bytes(&mut self, data: &[u8]) -> WzResult<()> {
        self.writer.write_all(data)?;
        Ok(())
    }

    // ── Compressed writes ────────────────────────────────────────────

    pub fn write_compressed_int(&mut self, val: i32) -> WzResult<()> {
        if (-127..=127).contains(&val) && val != -128 {
            self.write_u8(val as u8)
        } else {
            self.write_u8(0x80)?; // -128 as i8
            self.write_i32(val)
        }
    }

    pub fn write_compressed_long(&mut self, val: i64) -> WzResult<()> {
        if (-127..=127).contains(&val) && val != -128 {
            self.write_u8(val as u8)
        } else {
            self.write_u8(0x80)?;
            self.write_i64(val)
        }
    }

    // ── Encrypted string writes ──────────────────────────────────────

    pub fn write_wz_string(&mut self, s: &str) -> WzResult<()> {
        if s.is_ascii() {
            self.write_wz_ascii_string(s)
        } else {
            self.write_wz_unicode_string(s)
        }
    }

    fn write_wz_unicode_string(&mut self, s: &str) -> WzResult<()> {
        let chars: Vec<u16> = s.encode_utf16().collect();
        let length = chars.len();

        if length >= 127 {
            self.write_u8(127)?; // sbyte.MaxValue
            self.write_i32(length as i32)?;
        } else {
            self.write_u8(length as u8)?;
        }

        self.wz_key.ensure_size(length * 2);
        let mut mask: u16 = 0xAAAA;

        for (i, &ch) in chars.iter().enumerate() {
            let key_lo = self.wz_key[i * 2] as u16;
            let key_hi = self.wz_key[i * 2 + 1] as u16;
            let key_word = key_lo | (key_hi << 8);

            let encrypted = ch ^ key_word ^ mask;
            mask = mask.wrapping_add(1);
            self.write_u16(encrypted)?;
        }

        Ok(())
    }

    fn write_wz_ascii_string(&mut self, s: &str) -> WzResult<()> {
        let bytes = s.as_bytes();
        let length = bytes.len();

        if length > 127 {
            self.write_u8(0x80)?; // -128 as i8
            self.write_i32(length as i32)?;
        } else {
            self.write_u8((-(length as i32)) as u8)?;
        }

        self.wz_key.ensure_size(length);
        let mut mask: u8 = 0xAA;

        for (i, &byte) in bytes.iter().enumerate() {
            let encrypted = byte ^ self.wz_key[i] ^ mask;
            mask = mask.wrapping_add(1);
            self.write_u8(encrypted)?;
        }

        Ok(())
    }

    // ── Offset encryption ────────────────────────────────────────────

    pub fn write_wz_offset(&mut self, value: u32) -> WzResult<()> {
        let cur_pos = self.position()? as u32;
        let fstart = self.header.data_start;

        let mut enc = (cur_pos.wrapping_sub(fstart)) ^ 0xFFFF_FFFF;
        enc = enc.wrapping_mul(self.hash);
        enc = enc.wrapping_sub(WZ_OFFSET_CONSTANT);
        enc = enc.rotate_left(enc & 0x1F);

        let write_val = enc ^ (value.wrapping_sub(fstart.wrapping_mul(2)));
        self.write_u32(write_val)
    }
}
