// ProofFrame Host Program
// Runs on the native machine. Prepares inputs and runs the RISC Zero prover.
//
// Flow:
// 1. Parse CLI args (image path, transforms, disclosure config)
// 2. Read PNG file bytes
// 3. Parse EXIF metadata
// 4. Mock sign: generate secp256k1 keypair, sign SHA-256(file_bytes)
// 5. Build Merkle tree from authorized pubkeys (hardcoded mock keys for MVP)
// 6. Assemble GuestInput
// 7. Run prover → receipt (seal + journal)
// 8. Decode ProofOutput from journal
// 9. Print results + save clean PNG

// TODO: Implement T3 — see docs/TASKS.md

fn main() {
    println!("ProofFrame host — not yet implemented. See docs/TASKS.md T3.");
}
