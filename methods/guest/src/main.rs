// ProofFrame ZK Guest Program
// Runs inside RISC Zero zkVM. All inputs are PRIVATE. Only journal is PUBLIC.
//
// Flow:
// 1. Read GuestInput (private)
// 2. SHA-256(image_bytes) → file_hash
// 3. ECDSA verify(file_hash, signature, pubkey)
// 4. Merkle verify(pubkey_hash, proof, root)
// 5. Decode PNG → raw RGB pixels (metadata stripped by construction)
// 6. Apply transforms (crop, grayscale, brighten)
// 7. SHA-256(final_pixels) → pixel_hash
// 8. Selective disclosure of EXIF fields
// 9. Commit ProofOutput to journal (public)

// TODO: Implement T2 — see tasks/TASKS.md

fn main() {
    // Stub — will be implemented in T2
}
