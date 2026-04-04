// ProofFrame Host Program
// Runs on the native machine. Prepares inputs and runs the RISC Zero prover.
//
// Two modes:
// 1. --key <path>: load pre-generated signing key (from generate-test-images.py)
// 2. No --key: generate fresh secp256k1 keypair and sign at runtime
//
// Usage:
//   RISC0_DEV_MODE=1 cargo run -p proofframe-host --release -- \
//     --image test_images/ethglobal_cannes.png \
//     --key test_images/ethglobal_cannes.signing_key.json

use std::path::PathBuf;

use anyhow::{Context, Result};
use clap::Parser;
use image::DynamicImage;
use k256::ecdsa::{signature::hazmat::PrehashSigner, SigningKey, VerifyingKey};
use proofframe_common::{
    build_merkle_tree, generate_merkle_proof, DisclosurePolicy, GuestInput, ProofOutput, Transform,
};
use proofframe_methods::PROOFFRAME_GUEST_ELF;
use risc0_zkvm::{default_prover, ExecutorEnv};
use serde::Deserialize;
use sha2::{Digest, Sha256};

// ---------------------------------------------------------------------------
// CLI
// ---------------------------------------------------------------------------

#[derive(Parser)]
#[command(name = "proofframe-host", about = "ProofFrame ZK proof generator")]
struct Args {
    /// Path to PNG image file (with embedded EXIF)
    #[arg(short, long)]
    image: PathBuf,

    /// Transform as JSON (default: "None")
    #[arg(short, long, default_value = r#""None""#)]
    transform: String,

    /// Disclosure policy as JSON
    #[arg(short, long, default_value = r#"{"reveal_date":false,"reveal_location":false,"reveal_camera_make":false,"location_precision":"Hidden"}"#)]
    disclosure: String,

    /// Path to signing key JSON (default: generate fresh keypair)
    #[arg(short, long)]
    key: Option<PathBuf>,

    /// Output directory for clean PNG + receipt
    #[arg(short, long, default_value = "output")]
    output: PathBuf,
}

// ---------------------------------------------------------------------------
// Signing key loading
// ---------------------------------------------------------------------------

#[derive(Deserialize)]
struct SigningKeyFile {
    private_key: String,
    signature: String,
    public_key: String,
}

/// Load a pre-generated signing key from JSON (from generate-test-images.py).
fn load_signing_key(path: &PathBuf) -> Result<(Vec<u8>, Vec<u8>, Vec<u8>)> {
    let data = std::fs::read_to_string(path).context("reading signing key file")?;
    let key_file: SigningKeyFile = serde_json::from_str(&data).context("parsing signing key")?;
    let pubkey = hex::decode(&key_file.public_key).context("decoding public key")?;
    let signature = hex::decode(&key_file.signature).context("decoding signature")?;
    let _private = hex::decode(&key_file.private_key).context("decoding private key")?;
    Ok((pubkey, signature, _private))
}

/// Generate a fresh keypair and sign the file hash.
fn fresh_sign(file_hash: &[u8; 32]) -> Result<(Vec<u8>, Vec<u8>)> {
    let sk = SigningKey::random(&mut rand::thread_rng());
    let vk = VerifyingKey::from(&sk);
    let (sig, _) = sk.sign_prehash(file_hash).context("signing failed")?;
    let pubkey = vk.to_sec1_bytes().to_vec(); // compressed, 33 bytes
    let signature = sig.to_bytes().to_vec(); // r||s, 64 bytes
    Ok((pubkey, signature))
}

// ---------------------------------------------------------------------------
// Mock trust registry (hardcoded keys for MVP)
// ---------------------------------------------------------------------------

/// 4 mock public keys for the trust registry. In production these would be
/// C2PA camera manufacturer keys fetched from a real registry.
const MOCK_PUBKEYS: [&str; 4] = [
    "02aaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaa",
    "02bbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbb",
    "02cccccccccccccccccccccccccccccccccccccccccccccccccccccccccccccccc",
    "02dddddddddddddddddddddddddddddddddddddddddddddddddddddddddddd",
];

// ---------------------------------------------------------------------------
// Image transforms (host-side, for saving clean PNG)
// ---------------------------------------------------------------------------

fn apply_transform_host(img: DynamicImage, transform: &Transform) -> DynamicImage {
    match transform {
        Transform::None => img,
        Transform::Crop {
            x,
            y,
            width,
            height,
        } => img.crop_imm(*x, *y, *width, *height),
        Transform::Grayscale => DynamicImage::ImageLuma8(img.to_luma8()),
        Transform::Brighten { value } => img.brighten(*value),
        Transform::Chain(transforms) => {
            let mut current = img;
            for t in transforms {
                current = apply_transform_host(current, t);
            }
            current
        }
    }
}

// ---------------------------------------------------------------------------
// Main
// ---------------------------------------------------------------------------

fn main() -> Result<()> {
    let args = Args::parse();

    println!("ProofFrame Host — ZK Proof Generator");
    println!("====================================");

    // 1. Read PNG file bytes
    println!("\n1. Reading image...");
    let image_bytes = std::fs::read(&args.image)
        .with_context(|| format!("reading image: {}", args.image.display()))?;
    println!("   File: {} ({} bytes)", args.image.display(), image_bytes.len());

    // 2. Parse CLI config
    let transform: Transform =
        serde_json::from_str(&args.transform).context("parsing transform JSON")?;
    let disclosure: DisclosurePolicy =
        serde_json::from_str(&args.disclosure).context("parsing disclosure JSON")?;

    // 3. SHA-256 of file bytes
    let file_hash: [u8; 32] = Sha256::digest(&image_bytes).into();
    println!("   File hash: {}", hex::encode(file_hash));

    // 4. Sign or load pre-signed key
    println!("\n2. Signing...");
    let (pubkey, signature) = if let Some(key_path) = &args.key {
        println!("   Loading pre-signed key from {}", key_path.display());
        let (pubkey, signature, _) = load_signing_key(key_path)?;
        (pubkey, signature)
    } else {
        println!("   Generating fresh secp256k1 keypair");
        fresh_sign(&file_hash)?
    };
    println!("   Public key: {}", hex::encode(&pubkey));

    // 5. Build Merkle tree (trust registry)
    println!("\n3. Building trust registry Merkle tree...");
    let mut leaves: Vec<[u8; 32]> = MOCK_PUBKEYS
        .iter()
        .map(|hex_key| {
            let bytes = hex::decode(hex_key).expect("invalid mock key hex");
            Sha256::digest(&bytes).into()
        })
        .collect();
    // Add the signing key's pubkey hash
    let pubkey_hash: [u8; 32] = Sha256::digest(&pubkey).into();
    leaves.push(pubkey_hash);
    leaves.sort(); // deterministic ordering

    let signing_key_index = leaves.iter().position(|l| *l == pubkey_hash).unwrap();
    let (merkle_root, layers) = build_merkle_tree(&leaves);
    let merkle_proof = generate_merkle_proof(&layers, signing_key_index);
    println!("   Merkle root: {}", hex::encode(merkle_root));
    println!("   Trust registry: {} keys, proof depth: {}", leaves.len(), merkle_proof.len());

    // 6. Assemble GuestInput
    let guest_input = GuestInput {
        image_bytes: image_bytes.clone(),
        signature,
        pubkey,
        merkle_proof,
        merkle_root,
        transform: transform.clone(),
        disclosure,
    };

    // 7. Run RISC Zero prover
    println!("\n4. Running ZK prover...");
    let env = ExecutorEnv::builder()
        .write(&guest_input)
        .context("writing guest input")?
        .build()
        .context("building executor env")?;

    let receipt = default_prover()
        .prove(env, PROOFFRAME_GUEST_ELF)
        .context("proving failed")?
        .receipt;

    // 8. Decode ProofOutput from journal
    let output: ProofOutput = receipt.journal.decode().context("decoding journal")?;

    // 9. Print results
    println!("\n5. Proof generated successfully!");
    println!("   ┌─────────────────────────────────────────────");
    println!("   │ pixel_hash:  {}", hex::encode(output.pixel_hash));
    println!("   │ file_hash:   {}", hex::encode(output.file_hash));
    println!("   │ merkle_root: {}", hex::encode(output.merkle_root));
    println!("   │ transforms:  {}", output.transform_desc);
    println!("   │ image_size:  {}x{}", output.image_width, output.image_height);
    if let Some(ref d) = output.disclosed_date {
        println!("   │ date:        {}", d);
    }
    if let Some(ref l) = output.disclosed_location {
        println!("   │ location:    {}", l);
    }
    if let Some(ref m) = output.disclosed_camera_make {
        println!("   │ camera:      {}", m);
    }
    println!("   └─────────────────────────────────────────────");

    // 10. Save outputs
    std::fs::create_dir_all(&args.output)?;

    // Save clean PNG (pixels only, zero metadata)
    let clean_path = args.output.join("clean.png");
    let img = image::load_from_memory(&image_bytes).context("decoding image for clean output")?;
    let transformed = apply_transform_host(img, &transform);
    transformed
        .to_rgb8()
        .save(&clean_path)
        .context("saving clean PNG")?;
    println!("\n   Clean PNG:  {}", clean_path.display());

    // Save receipt (seal + journal) as JSON for relay
    let receipt_path = args.output.join("receipt.json");
    // Encode IMAGE_ID ([u32; 8]) as hex bytes
    let image_id_bytes: Vec<u8> = proofframe_methods::PROOFFRAME_GUEST_ID
        .iter()
        .flat_map(|w| w.to_le_bytes())
        .collect();
    let receipt_bytes = bincode::serialize(&receipt).context("serializing receipt")?;
    let journal_digest = hex::encode(Sha256::digest(&receipt.journal.bytes));
    let receipt_json = serde_json::json!({
        "receipt": hex::encode(&receipt_bytes),
        "journal": hex::encode(&receipt.journal.bytes),
        "journal_digest": journal_digest,
        "pixel_hash": hex::encode(output.pixel_hash),
        "file_hash": hex::encode(output.file_hash),
        "image_id": hex::encode(&image_id_bytes),
        "merkle_root": hex::encode(output.merkle_root),
        "transform_desc": output.transform_desc,
        "disclosed_date": output.disclosed_date.unwrap_or_default(),
        "disclosed_location": output.disclosed_location.unwrap_or_default(),
        "disclosed_camera_make": output.disclosed_camera_make.unwrap_or_default(),
        "image_width": output.image_width,
        "image_height": output.image_height,
    });
    std::fs::write(&receipt_path, serde_json::to_string_pretty(&receipt_json)?)
        .context("saving receipt")?;
    println!("   Receipt:    {}", receipt_path.display());

    println!("\nDone!");
    Ok(())
}
