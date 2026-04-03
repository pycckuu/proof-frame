#![no_std]

extern crate alloc;

use alloc::{string::String, vec::Vec};
use serde::{Deserialize, Serialize};

// ---------------------------------------------------------------------------
// Types
// ---------------------------------------------------------------------------

/// Image transform to apply inside the zkVM guest.
#[derive(Serialize, Deserialize, Clone, Debug)]
pub enum Transform {
    None,
    Crop {
        x: u32,
        y: u32,
        width: u32,
        height: u32,
    },
    Grayscale,
    Brighten {
        value: i32,
    },
    Chain(Vec<Transform>),
}

/// Precision level for disclosed GPS location.
#[derive(Serialize, Deserialize, Clone, Debug, PartialEq)]
pub enum LocationPrecision {
    Exact,
    City,
    Country,
    Hidden,
}

/// Controls which EXIF fields the photographer chooses to reveal.
#[derive(Serialize, Deserialize, Clone, Debug)]
pub struct DisclosurePolicy {
    pub reveal_date: bool,
    pub reveal_location: bool,
    pub reveal_camera_make: bool,
    pub location_precision: LocationPrecision,
}

impl Default for DisclosurePolicy {
    fn default() -> Self {
        Self {
            reveal_date: false,
            reveal_location: false,
            reveal_camera_make: false,
            location_precision: LocationPrecision::Hidden,
        }
    }
}

/// Parsed EXIF metadata from the original image file.
#[derive(Serialize, Deserialize, Clone, Debug, Default)]
pub struct ExifFields {
    pub date: Option<String>,
    pub gps_lat: Option<f64>,
    pub gps_lon: Option<f64>,
    pub camera_make: Option<String>,
    pub camera_model: Option<String>,
    pub image_width: u32,
    pub image_height: u32,
}

/// Private inputs to the ZK guest program.
/// Note: EXIF is NOT a separate input — the guest extracts it from image_bytes.
/// This prevents metadata forgery: the signature covers the entire file including EXIF,
/// so forging any field would invalidate the camera's signature.
#[derive(Serialize, Deserialize, Clone, Debug)]
pub struct GuestInput {
    pub image_bytes: Vec<u8>,
    pub signature: Vec<u8>,
    pub pubkey: Vec<u8>,
    /// Merkle proof: each element is (is_right_sibling, sibling_hash).
    pub merkle_proof: Vec<(bool, [u8; 32])>,
    pub merkle_root: [u8; 32],
    pub transform: Transform,
    pub disclosure: DisclosurePolicy,
}

/// Public outputs committed to the journal by the ZK guest.
/// Field order here defines journal encoding — contract MUST match exactly.
#[derive(Serialize, Deserialize, Clone, Debug)]
pub struct ProofOutput {
    pub pixel_hash: [u8; 32],
    pub file_hash: [u8; 32],
    pub merkle_root: [u8; 32],
    pub transform_desc: String,
    pub disclosed_date: Option<String>,
    pub disclosed_location: Option<String>,
    pub disclosed_camera_make: Option<String>,
    pub image_width: u32,
    pub image_height: u32,
}

/// Request payload sent from the frontend to the relayer API.
#[derive(Serialize, Deserialize, Clone, Debug)]
pub struct RelayRequest {
    pub seal: Vec<u8>,
    pub journal: Vec<u8>,
    pub pixel_hash: [u8; 32],
    pub world_id_proof: Option<Vec<u8>>,
}

// ---------------------------------------------------------------------------
// PNG eXIf chunk extraction
// ---------------------------------------------------------------------------

/// Extract raw TIFF-encoded EXIF bytes from a PNG file's eXIf chunk.
/// Returns None if no eXIf chunk is found.
pub fn extract_exif_from_png(data: &[u8]) -> Option<&[u8]> {
    if data.len() < 8 || &data[..8] != b"\x89PNG\r\n\x1a\n" {
        return None;
    }
    let mut pos = 8;
    while pos + 12 <= data.len() {
        let length = u32::from_be_bytes([data[pos], data[pos + 1], data[pos + 2], data[pos + 3]])
            as usize;
        let chunk_type = &data[pos + 4..pos + 8];

        if chunk_type == b"eXIf" && pos + 8 + length <= data.len() {
            return Some(&data[pos + 8..pos + 8 + length]);
        }
        if chunk_type == b"IEND" {
            break;
        }
        pos += 4 + 4 + length + 4;
    }
    None
}

// ---------------------------------------------------------------------------
// Minimal TIFF EXIF parser
// ---------------------------------------------------------------------------

/// Read a u16 from TIFF data respecting byte order (true = big-endian).
fn tiff_u16(data: &[u8], offset: usize, big_endian: bool) -> u16 {
    if big_endian {
        u16::from_be_bytes([data[offset], data[offset + 1]])
    } else {
        u16::from_le_bytes([data[offset], data[offset + 1]])
    }
}

/// Read a u32 from TIFF data respecting byte order.
fn tiff_u32(data: &[u8], offset: usize, big_endian: bool) -> u32 {
    if big_endian {
        u32::from_be_bytes([data[offset], data[offset + 1], data[offset + 2], data[offset + 3]])
    } else {
        u32::from_le_bytes([data[offset], data[offset + 1], data[offset + 2], data[offset + 3]])
    }
}

/// Read a TIFF ASCII string value from an IFD entry.
fn tiff_ascii(data: &[u8], offset: usize, count: u32, big_endian: bool) -> Option<&str> {
    let count = count as usize;
    if count <= 4 {
        let s = &data[offset..offset + count];
        core::str::from_utf8(s.split(|&b| b == 0).next().unwrap_or(s)).ok()
    } else {
        let ptr = tiff_u32(data, offset, big_endian) as usize;
        if ptr + count <= data.len() {
            let s = &data[ptr..ptr + count];
            core::str::from_utf8(s.split(|&b| b == 0).next().unwrap_or(s)).ok()
        } else {
            None
        }
    }
}

/// Read a TIFF RATIONAL (two u32: numerator/denominator).
fn tiff_rational(data: &[u8], offset: usize, big_endian: bool) -> (u32, u32) {
    (
        tiff_u32(data, offset, big_endian),
        tiff_u32(data, offset + 4, big_endian),
    )
}

/// Convert GPS degrees/minutes/seconds (3 RATIONALs) to decimal degrees.
fn gps_to_decimal(data: &[u8], offset: usize, big_endian: bool) -> f64 {
    let (d_n, d_d) = tiff_rational(data, offset, big_endian);
    let (m_n, m_d) = tiff_rational(data, offset + 8, big_endian);
    let (s_n, s_d) = tiff_rational(data, offset + 16, big_endian);
    let deg = if d_d != 0 { d_n as f64 / d_d as f64 } else { 0.0 };
    let min = if m_d != 0 { m_n as f64 / m_d as f64 } else { 0.0 };
    let sec = if s_d != 0 { s_n as f64 / s_d as f64 } else { 0.0 };
    deg + min / 60.0 + sec / 3600.0
}

/// Parse TIFF-encoded EXIF data and extract the fields we need.
/// Handles IFD0 (Make, Model, DateTime) and GPS IFD (lat/lon).
pub fn parse_exif(tiff_data: &[u8]) -> ExifFields {
    let mut fields = ExifFields::default();

    if tiff_data.len() < 8 {
        return fields;
    }

    let big_endian = &tiff_data[0..2] == b"MM";
    let magic = tiff_u16(tiff_data, 2, big_endian);
    if magic != 42 {
        return fields;
    }

    let ifd0_offset = tiff_u32(tiff_data, 4, big_endian) as usize;
    if ifd0_offset + 2 > tiff_data.len() {
        return fields;
    }

    let mut gps_ifd_offset: Option<usize> = None;

    let entry_count = tiff_u16(tiff_data, ifd0_offset, big_endian) as usize;
    for i in 0..entry_count {
        let entry_offset = ifd0_offset + 2 + i * 12;
        if entry_offset + 12 > tiff_data.len() {
            break;
        }

        let tag = tiff_u16(tiff_data, entry_offset, big_endian);
        let count = tiff_u32(tiff_data, entry_offset + 4, big_endian);
        let value_offset = entry_offset + 8;

        match tag {
            0x010F => {
                if let Some(s) = tiff_ascii(tiff_data, value_offset, count, big_endian) {
                    fields.camera_make = Some(String::from(s));
                }
            }
            0x0110 => {
                if let Some(s) = tiff_ascii(tiff_data, value_offset, count, big_endian) {
                    fields.camera_model = Some(String::from(s));
                }
            }
            0x0132 => {
                if let Some(s) = tiff_ascii(tiff_data, value_offset, count, big_endian) {
                    fields.date = Some(String::from(s));
                }
            }
            0x8825 => {
                gps_ifd_offset = Some(tiff_u32(tiff_data, value_offset, big_endian) as usize);
            }
            _ => {}
        }
    }

    if let Some(gps_off) = gps_ifd_offset {
        if gps_off + 2 <= tiff_data.len() {
            let gps_count = tiff_u16(tiff_data, gps_off, big_endian) as usize;
            let mut lat_ref: u8 = b'N';
            let mut lon_ref: u8 = b'E';
            let mut lat_offset: Option<usize> = None;
            let mut lon_offset: Option<usize> = None;

            for i in 0..gps_count {
                let entry_off = gps_off + 2 + i * 12;
                if entry_off + 12 > tiff_data.len() {
                    break;
                }

                let tag = tiff_u16(tiff_data, entry_off, big_endian);
                let value_off = entry_off + 8;

                match tag {
                    0x0001 => lat_ref = tiff_data[value_off],
                    0x0002 => {
                        let ptr = tiff_u32(tiff_data, value_off, big_endian) as usize;
                        if ptr + 24 <= tiff_data.len() {
                            lat_offset = Some(ptr);
                        }
                    }
                    0x0003 => lon_ref = tiff_data[value_off],
                    0x0004 => {
                        let ptr = tiff_u32(tiff_data, value_off, big_endian) as usize;
                        if ptr + 24 <= tiff_data.len() {
                            lon_offset = Some(ptr);
                        }
                    }
                    _ => {}
                }
            }

            if let Some(off) = lat_offset {
                let mut lat = gps_to_decimal(tiff_data, off, big_endian);
                if lat_ref == b'S' {
                    lat = -lat;
                }
                fields.gps_lat = Some(lat);
            }
            if let Some(off) = lon_offset {
                let mut lon = gps_to_decimal(tiff_data, off, big_endian);
                if lon_ref == b'W' {
                    lon = -lon;
                }
                fields.gps_lon = Some(lon);
            }
        }
    }

    fields
}

// ---------------------------------------------------------------------------
// Merkle proof verification (requires "crypto" feature)
// ---------------------------------------------------------------------------

/// Verify a Merkle proof: leaf hashes up through siblings to match root.
#[cfg(any(feature = "crypto", test))]
pub fn verify_merkle(leaf: [u8; 32], proof: &[(bool, [u8; 32])], root: [u8; 32]) -> bool {
    use sha2::{Digest, Sha256};
    let mut current = leaf;
    for (is_right_sibling, sibling) in proof {
        let mut hasher = Sha256::new();
        if *is_right_sibling {
            hasher.update(current);
            hasher.update(sibling);
        } else {
            hasher.update(sibling);
            hasher.update(current);
        }
        current = hasher.finalize().into();
    }
    current == root
}

// ---------------------------------------------------------------------------
// Tests
// ---------------------------------------------------------------------------

#[cfg(test)]
mod tests {
    extern crate std;
    use std::vec;
    use super::*;
    use sha2::{Digest, Sha256};

    // -- PNG chunk extraction tests --

    #[test]
    fn test_extract_exif_from_valid_png() {
        // Minimal PNG: signature + IHDR + eXIf + IEND
        let mut png = Vec::new();
        // PNG signature
        png.extend_from_slice(b"\x89PNG\r\n\x1a\n");
        // IHDR chunk (13 bytes data)
        let ihdr_data = [0u8; 13];
        png.extend_from_slice(&13u32.to_be_bytes()); // length
        png.extend_from_slice(b"IHDR");
        png.extend_from_slice(&ihdr_data);
        png.extend_from_slice(&0u32.to_be_bytes()); // CRC (dummy)
        // eXIf chunk with fake TIFF data
        let exif_data = b"MM\x00\x2a\x00\x00\x00\x08"; // big-endian TIFF header
        png.extend_from_slice(&(exif_data.len() as u32).to_be_bytes());
        png.extend_from_slice(b"eXIf");
        png.extend_from_slice(exif_data);
        png.extend_from_slice(&0u32.to_be_bytes()); // CRC
        // IEND
        png.extend_from_slice(&0u32.to_be_bytes());
        png.extend_from_slice(b"IEND");
        png.extend_from_slice(&0u32.to_be_bytes());

        let result = extract_exif_from_png(&png);
        assert!(result.is_some());
        assert_eq!(result.unwrap(), exif_data);
    }

    #[test]
    fn test_extract_exif_no_exif_chunk() {
        let mut png = Vec::new();
        png.extend_from_slice(b"\x89PNG\r\n\x1a\n");
        // IHDR
        png.extend_from_slice(&13u32.to_be_bytes());
        png.extend_from_slice(b"IHDR");
        png.extend_from_slice(&[0u8; 13]);
        png.extend_from_slice(&0u32.to_be_bytes());
        // IEND (no eXIf)
        png.extend_from_slice(&0u32.to_be_bytes());
        png.extend_from_slice(b"IEND");
        png.extend_from_slice(&0u32.to_be_bytes());

        assert!(extract_exif_from_png(&png).is_none());
    }

    #[test]
    fn test_extract_exif_not_png() {
        assert!(extract_exif_from_png(b"not a png").is_none());
        assert!(extract_exif_from_png(b"").is_none());
    }

    // -- TIFF EXIF parsing tests --

    fn build_tiff_with_make(make: &str) -> Vec<u8> {
        // Build minimal big-endian TIFF with one IFD entry: Make (tag 0x010F)
        let mut tiff = Vec::new();
        // Header: MM (big-endian), magic 42, offset to IFD0 = 8
        tiff.extend_from_slice(b"MM");
        tiff.extend_from_slice(&42u16.to_be_bytes());
        tiff.extend_from_slice(&8u32.to_be_bytes());
        // IFD0 at offset 8: 1 entry
        tiff.extend_from_slice(&1u16.to_be_bytes());
        // Entry: tag=0x010F, type=2 (ASCII), count, value
        tiff.extend_from_slice(&0x010Fu16.to_be_bytes());
        tiff.extend_from_slice(&2u16.to_be_bytes()); // type ASCII
        let make_bytes = make.as_bytes();
        let count = make_bytes.len() as u32 + 1; // +1 for null terminator
        tiff.extend_from_slice(&count.to_be_bytes());
        if count <= 4 {
            // Inline value
            let mut val = [0u8; 4];
            val[..make_bytes.len()].copy_from_slice(make_bytes);
            tiff.extend_from_slice(&val);
        } else {
            // Pointer to string data at end of IFD
            let string_offset = 8 + 2 + 12 + 4; // header + count + 1 entry + next IFD ptr
            tiff.extend_from_slice(&(string_offset as u32).to_be_bytes());
        }
        // Next IFD offset = 0 (no more IFDs)
        tiff.extend_from_slice(&0u32.to_be_bytes());
        // String data (if pointed)
        if count > 4 {
            tiff.extend_from_slice(make_bytes);
            tiff.push(0); // null terminator
        }
        tiff
    }

    #[test]
    fn test_parse_exif_make_short() {
        let tiff = build_tiff_with_make("HP");
        let fields = parse_exif(&tiff);
        assert_eq!(fields.camera_make.as_deref(), Some("HP"));
    }

    #[test]
    fn test_parse_exif_make_long() {
        let tiff = build_tiff_with_make("Canon");
        let fields = parse_exif(&tiff);
        assert_eq!(fields.camera_make.as_deref(), Some("Canon"));
    }

    #[test]
    fn test_parse_exif_empty() {
        let fields = parse_exif(b"");
        assert!(fields.camera_make.is_none());
        assert!(fields.date.is_none());
        assert!(fields.gps_lat.is_none());
    }

    #[test]
    fn test_parse_exif_bad_magic() {
        let tiff = b"MM\x00\x99\x00\x00\x00\x08"; // magic = 0x99, not 42
        let fields = parse_exif(tiff);
        assert!(fields.camera_make.is_none());
    }

    #[test]
    fn test_parse_exif_real_test_image() {
        // Read the actual test image if available
        let png_path = std::path::Path::new("test_images/ethglobal_cannes.png");
        if !png_path.exists() {
            return; // skip if test images not generated
        }
        let data = std::fs::read(png_path).unwrap();
        let tiff_data = extract_exif_from_png(&data).expect("eXIf chunk not found");
        let fields = parse_exif(tiff_data);

        assert_eq!(fields.camera_make.as_deref(), Some("Apple"));
        assert!(fields.date.is_some());
        // GPS should be near Cannes (43.5N, 7.0E)
        let lat = fields.gps_lat.expect("GPS lat missing");
        let lon = fields.gps_lon.expect("GPS lon missing");
        assert!((lat - 43.55).abs() < 0.1, "lat={lat}, expected ~43.55");
        assert!((lon - 7.02).abs() < 0.1, "lon={lon}, expected ~7.02");
    }

    // -- Merkle proof tests --

    fn sha256(data: &[u8]) -> [u8; 32] {
        Sha256::digest(data).into()
    }

    fn hash_pair(left: [u8; 32], right: [u8; 32]) -> [u8; 32] {
        let mut hasher = Sha256::new();
        hasher.update(left);
        hasher.update(right);
        hasher.finalize().into()
    }

    #[test]
    fn test_verify_merkle_single_leaf() {
        // Tree with 1 leaf = root is the leaf itself
        let leaf = sha256(b"key1");
        // Empty proof means leaf == root
        assert!(super::verify_merkle(leaf, &[], leaf));
    }

    #[test]
    fn test_verify_merkle_two_leaves() {
        let leaf_a = sha256(b"key_a");
        let leaf_b = sha256(b"key_b");
        let root = hash_pair(leaf_a, leaf_b);

        // Prove leaf_a: sibling is leaf_b on the right
        let proof_a = vec![(true, leaf_b)];
        assert!(super::verify_merkle(leaf_a, &proof_a, root));

        // Prove leaf_b: sibling is leaf_a on the left
        let proof_b = vec![(false, leaf_a)];
        assert!(super::verify_merkle(leaf_b, &proof_b, root));
    }

    #[test]
    fn test_verify_merkle_four_leaves() {
        let leaves: Vec<[u8; 32]> = (0..4).map(|i| sha256(&[i])).collect();
        let h01 = hash_pair(leaves[0], leaves[1]);
        let h23 = hash_pair(leaves[2], leaves[3]);
        let root = hash_pair(h01, h23);

        // Prove leaf[0]: path is leaf[1] right, then h23 right
        let proof = vec![(true, leaves[1]), (true, h23)];
        assert!(super::verify_merkle(leaves[0], &proof, root));

        // Prove leaf[3]: path is leaf[2] left, then h01 left
        let proof = vec![(false, leaves[2]), (false, h01)];
        assert!(super::verify_merkle(leaves[3], &proof, root));
    }

    #[test]
    fn test_verify_merkle_invalid_proof() {
        let leaf_a = sha256(b"key_a");
        let leaf_b = sha256(b"key_b");
        let root = hash_pair(leaf_a, leaf_b);

        // Wrong sibling
        let bad_proof = vec![(true, sha256(b"wrong"))];
        assert!(!super::verify_merkle(leaf_a, &bad_proof, root));
    }

    #[test]
    fn test_verify_merkle_wrong_root() {
        let leaf = sha256(b"key");
        let wrong_root = sha256(b"wrong_root");
        assert!(!super::verify_merkle(leaf, &[], wrong_root));
    }

    // -- Integration: PNG with EXIF end-to-end --

    #[test]
    fn test_png_exif_roundtrip() {
        // Build a PNG with eXIf containing "Canon" as Make
        let tiff = build_tiff_with_make("Canon");

        let mut png = Vec::new();
        png.extend_from_slice(b"\x89PNG\r\n\x1a\n");
        // IHDR
        png.extend_from_slice(&13u32.to_be_bytes());
        png.extend_from_slice(b"IHDR");
        png.extend_from_slice(&[0u8; 13]);
        png.extend_from_slice(&0u32.to_be_bytes());
        // eXIf
        png.extend_from_slice(&(tiff.len() as u32).to_be_bytes());
        png.extend_from_slice(b"eXIf");
        png.extend_from_slice(&tiff);
        png.extend_from_slice(&0u32.to_be_bytes());
        // IEND
        png.extend_from_slice(&0u32.to_be_bytes());
        png.extend_from_slice(b"IEND");
        png.extend_from_slice(&0u32.to_be_bytes());

        // Extract and parse
        let exif_bytes = extract_exif_from_png(&png).expect("should find eXIf");
        let fields = parse_exif(exif_bytes);
        assert_eq!(fields.camera_make.as_deref(), Some("Canon"));
    }
}
