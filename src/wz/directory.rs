//! WZ directory and image entry structures.
//!
//! A WZ file contains a tree of directories and images.
//! Each directory entry has a type (1-4), name, size, checksum, and offset.

use serde::{Deserialize, Serialize};

use super::binary_reader::WzBinaryReader;
use super::error::{WzError, WzResult};
use super::types::WzDirectoryType;

#[derive(Debug, Clone, Serialize, Deserialize)]
pub struct WzDirectoryEntry {
    pub name: String,
    pub size: i32,
    pub checksum: i32,
    pub offset: u64,
    pub entry_type: u8,
    pub subdirectories: Vec<WzDirectoryEntry>,
    pub images: Vec<WzImageEntry>,
}

#[derive(Debug, Clone, Serialize, Deserialize)]
pub struct WzImageEntry {
    pub name: String,
    pub size: i32,
    pub checksum: i32,
    pub offset: u64,
}

impl WzDirectoryEntry {
    pub fn new(name: String, entry_type: u8) -> Self {
        WzDirectoryEntry {
            name,
            size: 0,
            checksum: 0,
            offset: 0,
            entry_type,
            subdirectories: Vec::new(),
            images: Vec::new(),
        }
    }

    pub fn parse<R: std::io::Read + std::io::Seek>(
        reader: &mut WzBinaryReader<R>,
    ) -> WzResult<Self> {
        let entry_count = reader.read_compressed_int()?;

        // Sanity check — garbled data from wrong version hash will produce huge counts
        if !(0..=100_000).contains(&entry_count) {
            return Err(WzError::Custom(format!(
                "Invalid entry count {} — likely wrong version hash",
                entry_count
            )));
        }

        let mut dir = WzDirectoryEntry::new(String::new(), WzDirectoryType::Directory as u8);

        struct RawEntry {
            entry_type: u8,
            name: String,
            size: i32,
            checksum: i32,
            offset: u64,
        }
        let mut raw_entries = Vec::with_capacity(entry_count as usize);

        for _ in 0..entry_count {
            let mut entry_type = reader.read_u8()?;
            let dir_type = WzDirectoryType::try_from(entry_type);

            let (name, remember_pos) = match dir_type {
                Ok(WzDirectoryType::UnknownType) => {
                    let _unknown = reader.read_i32()?;
                    let _unknown2 = reader.read_i16()?;
                    let _offset = reader.read_wz_offset()?;
                    continue;
                }
                Ok(WzDirectoryType::RetrieveStringFromOffset) => {
                    let string_offset = reader.read_i32()?;
                    let remember_pos = reader.position()?;

                    let fstart = reader.header.data_start as u64;
                    reader.seek(fstart + string_offset as u64)?;
                    entry_type = reader.read_u8()?;
                    let name = reader.read_wz_string()?;

                    (name, remember_pos)
                }
                Ok(WzDirectoryType::Directory) | Ok(WzDirectoryType::Image) => {
                    let name = reader.read_wz_string()?;
                    let remember_pos = reader.position()?;
                    (name, remember_pos)
                }
                Err(unknown) => {
                    return Err(WzError::UnknownDirectoryType(unknown));
                }
            };

            reader.seek(remember_pos)?;
            let size = reader.read_compressed_int()?;
            let checksum = reader.read_compressed_int()?;
            let offset = reader.read_wz_offset()?;

            raw_entries.push(RawEntry {
                entry_type,
                name,
                size,
                checksum,
                offset,
            });
        }

        let mut subdirs_with_offset: Vec<(WzDirectoryEntry, u64)> = Vec::new();

        for entry in raw_entries {
            if entry.entry_type == WzDirectoryType::Directory as u8 {
                let mut subdir = WzDirectoryEntry::new(
                    entry.name,
                    WzDirectoryType::Directory as u8,
                );
                subdir.size = entry.size;
                subdir.checksum = entry.checksum;
                subdir.offset = entry.offset;
                subdirs_with_offset.push((subdir, entry.offset));
            } else {
                // Types 2 (resolved) and 4 → image
                let img = WzImageEntry {
                    name: entry.name,
                    size: entry.size,
                    checksum: entry.checksum,
                    offset: entry.offset,
                };
                dir.images.push(img);
            }
        }

        for (mut subdir, offset) in subdirs_with_offset {
            reader.seek(offset)?;
            match WzDirectoryEntry::parse(reader) {
                Ok(parsed) => {
                    subdir.subdirectories = parsed.subdirectories;
                    subdir.images = parsed.images;
                    dir.subdirectories.push(subdir);
                }
                Err(_) => {
                    // If subdirectory parse fails, still include it (empty)
                    dir.subdirectories.push(subdir);
                }
            }
        }

        Ok(dir)
    }
}
