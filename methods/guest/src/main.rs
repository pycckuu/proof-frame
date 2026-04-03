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

use proofframe_common::{extract_exif_from_png, parse_exif, GuestInput};
// Used in T2.2 and T2.3:
// use proofframe_common::{ProofOutput, Transform, LocationPrecision};
use risc0_zkvm::guest::env;
use sha2::{Digest, Sha256};

// ---------------------------------------------------------------------------
// Merkle proof verification (inline — sha2 is already available here)
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
// Main guest entry point
// ---------------------------------------------------------------------------

fn main() {
    // 1. Read private inputs
    let input: GuestInput = env::read();

    // 2. SHA-256 hash of the entire file (covers both pixels and EXIF)
    let file_hash: [u8; 32] = Sha256::digest(&input.image_bytes).into();

    // 3. ECDSA signature verification (raw, no Ethereum prefix)
    let vk = k256::ecdsa::VerifyingKey::from_sec1_bytes(&input.pubkey)
        .expect("invalid public key");
    let sig = k256::ecdsa::Signature::from_slice(&input.signature)
        .expect("invalid signature");
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
        None => proofframe_common::ExifFields::default(),
    };

    // TODO T2.2: Decode PNG → RGB pixels, apply transforms, compute pixel_hash
    // TODO T2.3: Selective disclosure + commit ProofOutput

    // Temporary: suppress unused warnings until T2.2/T2.3
    let _ = exif;
    let _ = file_hash;
    let _ = input.transform;
    let _ = input.disclosure;
}
