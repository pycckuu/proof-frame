#![no_std]

extern crate alloc;

use alloc::{string::String, vec::Vec};
use serde::{Deserialize, Serialize};

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
    pub exif: ExifFields,
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
