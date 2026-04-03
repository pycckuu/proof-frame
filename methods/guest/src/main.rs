// ProofFrame ZK Guest Program
// Runs inside RISC Zero zkVM. All inputs are PRIVATE. Only journal is PUBLIC.
//
// Flow:
// 1. Read GuestInput (private)
// 2. SHA-256(image_bytes) → file_hash
// 3. ECDSA verify(file_hash, signature, pubkey)
// 4. Merkle verify(pubkey_hash, proof, root)
// 5. Extract EXIF from PNG eXIf chunk
// 6. Decode PNG → raw RGB pixels (metadata stripped by construction)
// 7. Apply transforms (crop, grayscale, brighten)
// 8. SHA-256(final_pixels) → pixel_hash
// 9. Selective disclosure of EXIF fields
// 10. Commit ProofOutput to journal (public)

#![no_main]
extern crate alloc;
risc0_zkvm::guest::entry!(main);

use alloc::{format, string::String, vec::Vec};
use image::DynamicImage;
use proofframe_common::{
    apply_disclosure, extract_exif_from_png, parse_exif, ExifFields, GuestInput, ProofOutput,
    Transform,
};
use risc0_zkvm::guest::env;
use sha2::{Digest, Sha256};

// ---------------------------------------------------------------------------
// Merkle proof verification
// ---------------------------------------------------------------------------

fn verify_merkle(leaf: [u8; 32], proof: &[(bool, [u8; 32])], root: [u8; 32]) -> bool {
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
// Image transforms
// ---------------------------------------------------------------------------

/// Apply a transform to an image, returning the result and a human-readable description.
fn apply_transform(img: DynamicImage, transform: &Transform) -> (DynamicImage, String) {
    match transform {
        Transform::None => (img, String::from("none")),
        Transform::Crop {
            x,
            y,
            width,
            height,
        } => {
            let cropped = img.crop_imm(*x, *y, *width, *height);
            (cropped, format!("crop({},{},{},{})", x, y, width, height))
        }
        Transform::Grayscale => {
            // Convert to luma8 then back to dynamic for consistent RGB output
            (
                DynamicImage::ImageLuma8(img.to_luma8()),
                String::from("grayscale"),
            )
        }
        Transform::Brighten { value } => (img.brighten(*value), format!("brighten({})", value)),
        Transform::Chain(transforms) => {
            let mut current = img;
            let mut descs: Vec<String> = Vec::new();
            for t in transforms {
                let (new_img, desc) = apply_transform(current, t);
                current = new_img;
                descs.push(desc);
            }
            let joined = descs.join("+");
            (current, joined)
        }
    }
}

// ---------------------------------------------------------------------------
// Main guest entry point
// ---------------------------------------------------------------------------

fn main() {
    // 1. Read private inputs
    let input: GuestInput = env::read();

    // 2. SHA-256 hash of the entire file (covers both pixels and EXIF)
    let file_hash: [u8; 32] = Sha256::digest(&input.image_bytes).into();

    // 3. ECDSA signature verification (raw, no Ethereum prefix)
    let vk =
        k256::ecdsa::VerifyingKey::from_sec1_bytes(&input.pubkey).expect("invalid public key");
    let sig = k256::ecdsa::Signature::from_slice(&input.signature).expect("invalid signature");
    use k256::ecdsa::signature::hazmat::PrehashVerifier;
    vk.verify_prehash(&file_hash, &sig)
        .expect("signature verification failed");

    // 4. Merkle proof: signing key is in the authorized trust registry
    let pubkey_hash: [u8; 32] = Sha256::digest(&input.pubkey).into();
    assert!(
        verify_merkle(pubkey_hash, &input.merkle_proof, input.merkle_root),
        "merkle proof verification failed"
    );

    // 5. Extract EXIF from the signed PNG file bytes
    let exif = match extract_exif_from_png(&input.image_bytes) {
        Some(tiff_data) => parse_exif(tiff_data),
        None => ExifFields::default(),
    };

    // 6. Decode PNG → raw RGB pixels (metadata stripped by construction)
    let img = image::load_from_memory(&input.image_bytes).expect("failed to decode PNG");
    let (image_width, image_height) = (img.width(), img.height());

    // 7. Apply transforms (crop, grayscale, brighten)
    let (transformed, transform_desc) = apply_transform(img, &input.transform);

    // 8. SHA-256 of final RGB pixel bytes → pixel_hash
    let rgb_bytes = transformed.to_rgb8().into_raw();
    let pixel_hash: [u8; 32] = Sha256::digest(&rgb_bytes).into();

    // 9. Selective disclosure of EXIF fields
    let (disclosed_date, disclosed_location, disclosed_camera_make) =
        apply_disclosure(&exif, &input.disclosure);

    // 10. Commit ProofOutput to journal (public)
    env::commit(&ProofOutput {
        pixel_hash,
        file_hash,
        merkle_root: input.merkle_root,
        transform_desc,
        disclosed_date,
        disclosed_location,
        disclosed_camera_make,
        image_width,
        image_height,
    });
}
