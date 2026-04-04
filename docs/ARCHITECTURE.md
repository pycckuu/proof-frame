# ProofFrame: Complete Architecture Reference

> **This is the SINGLE source of truth for the entire project.**
> Any agent working on ProofFrame should read this FIRST before making any decisions.
> Last updated: April 2, 2026 (night before ETHGlobal Cannes hackathon)

---

## 1. WHAT IS PROOFFRAME

ProofFrame proves photos are authentic without revealing who took them.

A photographer takes a photo → the system generates a zero-knowledge proof that:
- An authorized signing key committed to this file
- The image decodes to specific pixels (all metadata stripped by construction)
- Specific transforms (crop, grayscale, brightness) were applied correctly
- The photographer chose which metadata to disclose (date, location, camera make)

The proof hides: the signing key, the photographer's identity, GPS coordinates,
camera serial number, and any metadata the photographer chose not to reveal.

**Elevator pitch for judges:** "AI-generated images are flooding the internet and nobody
can tell real from fake. C2PA camera signatures prove authenticity but leak the photographer's
identity. ProofFrame uses zero-knowledge proofs to verify images are real and untampered —
without revealing who took them. It's the missing trust layer for fighting visual disinformation,
arriving just in time for the EU AI Act's August 2026 deadline."

---

## 2. PRIVACY MODEL — THE MOST CRITICAL DESIGN CONSTRAINT

**Rule: The photographer's identity MUST NOT appear anywhere on-chain. Period.**

This is not a nice-to-have. It is the core value proposition. Every architectural
decision flows from this constraint. If the photographer's wallet, public key, or
any identifying information appears on-chain, the project fails at its premise.

### How privacy is achieved at each layer:

| Layer | Privacy mechanism |
|-------|-------------------|
| **Blockchain tx** | Permissionless relayer submits tx. `msg.sender` = shared relayer wallet, NOT photographer. Contract has NO `msg.sender` checks. |
| **ZK proof** | Signing key is a PRIVATE input to the RISC Zero guest. Proof outputs only "some key in this Merkle tree signed this" — not WHICH key. |
| **World ID** | Nullifier hash is scoped to `(app_id, action_id)`. Different per image = unlinkable. Proof reveals nothing about which human. |
| **Image file** | Published PNG is re-encoded from decoded pixels. Zero EXIF/XMP/IPTC/C2PA metadata survives. |
| **ENS subnames** | Created by relayer via NameStone API (project-level auth). No photographer wallet referenced. |
| **Network** | Photographer communicates only with relayer API. Can use Tor/VPN for IP privacy. |

### What the contract MUST NOT do:
```solidity
// ❌ WRONG — reveals photographer identity
attestations[pixelHash].attester = msg.sender;

// ✅ CORRECT — no identity stored
attestations[pixelHash].exists = true;
// msg.sender is the relayer, not the photographer
```

### What the contract MUST do:
```solidity
// Only check: is the ZK proof mathematically valid?
verifier.verify(seal, GUEST_IMAGE_ID, sha256(journal));
// That's it. No access control. No msg.sender checks.
// Anyone can submit a valid proof. Permissionless by design.
```

---

## 3. SYSTEM ARCHITECTURE — COMPLETE DATA FLOW

```
┌─────────────────────────────────────────────────────────────┐
│                  JOURNALIST'S DEVICE (private)               │
│                                                             │
│  1. Take photo → file.png (with EXIF: GPS, date, camera)   │
│  2. Open ProofFrame web app                                 │
│  3. Choose disclosure: ☑ date ☑ city-location ☐ camera      │
│  4. Choose transforms: crop(10,10,300,220) + grayscale      │
│  5. [Optional] World ID scan → proof with signal=pixelHash  │
│  6. App sends image to proof generation service              │
└──────────────────┬──────────────────────────────────────────┘
                   │ HTTPS (image bytes + config)
                   ▼
┌─────────────────────────────────────────────────────────────┐
│              PROOF GENERATION (host program)                  │
│                                                             │
│  7. Host parses EXIF metadata (Option A: host-side)         │
│  8. Host has mock signing key (or receives Ledger sig)      │
│  9. Host signs SHA-256(file_bytes) with raw ECDSA           │
│  10. Host builds Merkle proof for signing key               │
│  11. Host assembles GuestInput struct                       │
│  12. Host runs RISC Zero prover → receipt                   │
└──────────────────┬──────────────────────────────────────────┘
                   │ receipt (seal + journal)
                   ▼
┌─────────────────────────────────────────────────────────────┐
│            RISC ZERO zkVM GUEST (inside the VM)              │
│            ALL INPUTS ARE PRIVATE. ONLY JOURNAL IS PUBLIC.   │
│                                                             │
│  PRIVATE INPUTS (env::read):                                │
│  ├── image_bytes: Vec<u8>         full file with metadata   │
│  ├── signer_signature: Vec<u8>    raw ECDSA sig             │
│  ├── signer_pubkey: Vec<u8>       compressed secp256k1 key  │
│  ├── merkle_proof: Vec<...>       path to root              │
│  ├── merkle_root: [u8; 32]        authorized signers root   │
│  ├── transform: Transform         crop/grayscale/brighten   │
│  ├── disclosure: DisclosurePolicy what to reveal            │
│  └── exif: ExifFields             parsed metadata           │
│                                                             │
│  OPERATIONS (proven correct by the ZK proof):               │
│  ├── SHA-256(image_bytes) → file_hash                       │
│  ├── ECDSA verify(file_hash, signature, pubkey) → OK        │
│  ├── Merkle verify(pubkey_hash, proof, root) → OK           │
│  ├── image::load_from_memory → raw RGB pixels               │
│  │   (ALL metadata discarded by the image crate)            │
│  ├── apply transforms (crop, grayscale, brighten)           │
│  ├── SHA-256(final_pixels) → pixel_hash                     │
│  └── conditional disclosure of EXIF fields                  │
│                                                             │
│  PUBLIC OUTPUTS (env::commit → journal):                    │
│  ├── pixel_hash: [u8; 32]         binds to published image  │
│  ├── file_hash: [u8; 32]          binds to signed file      │
│  ├── merkle_root: [u8; 32]        which trust set           │
│  ├── transform_desc: String        "crop(...)+grayscale"    │
│  ├── disclosed_date: Option<String>                         │
│  ├── disclosed_location: Option<String>                     │
│  └── disclosed_camera_make: Option<String>                  │
└──────────────────┬──────────────────────────────────────────┘
                   │ {seal, journal, world_id_proof}
                   ▼
┌─────────────────────────────────────────────────────────────┐
│                RELAYER API (Next.js /api/relay)               │
│                                                             │
│  13. Receives proof data from user's browser          │
│  14. Submits attestImage() tx from RELAYER_PRIVATE_KEY      │
│  15. msg.sender = relayer wallet (shared across all users)  │
│  16. Calls NameStone API to create ENS subname              │
│  17. Returns tx hash + ENS name to user               │
└──────────────────┬──────────────────────────────────────────┘
                   │ attestImage(pixelHash, seal, ...)
                   ▼
┌─────────────────────────────────────────────────────────────┐
│           SMART CONTRACT: ImageAttestor.sol (Sepolia)        │
│                                                             │
│  18. verifier.verify(seal, IMAGE_ID, sha256(journal))       │
│      → reverts if proof invalid                             │
│  19. [Optional] worldId.verifyProof(root, signal=pixelHash) │
│      → reverts if human verification invalid                │
│  20. Store attestation keyed by pixelHash                   │
│      → NO identity stored. NO msg.sender reference.         │
│  21. emit ImageAttested(pixelHash, fileHash, timestamp)     │
└──────────────────┬──────────────────────────────────────────┘
                   │
                   ▼
┌─────────────────────────────────────────────────────────────┐
│                    PUBLISHED OUTPUTS                          │
│                                                             │
│  • Clean PNG file (re-encoded from pixels, zero metadata)   │
│  • Clean PNG pinned on IPFS (via Infura, ipfs://Qm...)      │
│  • On-chain attestation (pixelHash → timestamp + metadata)  │
│  • ENS subname: {ipfs-cid}.proof-frame.eth → proof data      │
│  •   Text records: pixelHash, txHash, date, IPFS CID        │
│  • Disclosed metadata: date, city, camera make              │
│                                                             │
│  NEVER PUBLISHED:                                           │
│  • Signing key, photographer wallet, GPS coordinates,         │
│    camera serial number, photographer name, thumbnail,      │
│    editing history, or any undisclosed EXIF field            │
└─────────────────────────────────────────────────────────────┘
```

### Verification flow (anyone can verify):
```
Option A: Direct upload
1. Upload clean.png to ProofFrame verify page
2. Browser decodes to RGB pixels (canvas → getImageData)
3. Computes SHA-256 of pixel bytes (Web Crypto API)
4. Queries contract: isVerified(pixelHash)
5. If true → show disclosed metadata + verification badge

Option B: Via ENS
1. Resolve {ipfs-cid}.proof-frame.eth
2. Read text record "io.proofframe.image" → ipfs://Qm...
3. Download image from IPFS gateway
4. Compute pixel hash → verify on-chain (same as Option A steps 2-5)
```

---

## 4. WHY EACH TECHNICAL DECISION WAS MADE

### 4.1 Raw ECDSA over SHA-256 (NOT Ethereum personal_sign)

**Problem:** Ethereum `personal_sign` prepends `"\x19Ethereum Signed Message:\n32"` then
hashes with **Keccak-256**. RISC Zero accelerates SHA-256 (68 cycles/block) but Keccak-256
is NOT accelerated — it would cost millions of extra cycles inside the zkVM.

**Decision:** The guest verifies `k256::verify(SHA256(file_bytes), signature, pubkey)` —
pure raw ECDSA, no prefix. This matches what C2PA cameras actually do (ECDSA-P256 over
SHA-256 hash of the signed payload).

**Consequence:** We CANNOT use Ledger's `personal_sign` or `signTypedData` inside the ZK
proof because those use Keccak internally. Ledger's role is signing the on-chain
TRANSACTION (verified by EVM's native ecrecover), not the content signature inside the ZK.

**Note:** RISC Zero v3.0+ has a Keccak precompile (patched `tiny-keccak` crate), but it
requires the `"unstable"` feature flag. For hackathon safety, stick with SHA-256 (stable).
Upgrading to Keccak for full Ledger signature verification inside ZK is a stretch goal.

### 4.2 Image decode INSIDE the VM (not on host)

**Problem:** If the host decodes the image and passes raw pixels, the proof cannot
attest that those pixels came from the signed file. The host could substitute any pixels.

**Decision:** The `image` crate (v0.25, `png` feature only) decodes PNG→RGB inside the
RISC Zero guest. The guest receives the full file bytes as private input, verifies the
signature over the full file, THEN decodes. This maintains the proof chain:
`signed file → decode → pixels → transform → hash`.

**Confirmed working:** RISC Zero's Where's Waldo example uses the `image` crate inside
the guest for crop/mask operations via `image::GenericImageView`.

**Key insight:** The `image` crate's decode produces ONLY a pixel buffer. It does NOT
read, preserve, or write ANY metadata (EXIF, XMP, IPTC, C2PA, ICC). This is the
"metadata firewall" — metadata stripping happens by construction, not by explicit code.

**Risk:** The `image` crate might fail to compile for `riscv32im-risc0-zkvm-elf`. Test
this BEFORE the hackathon. Fallback: pass raw pixel bytes from host (weaker proof).

### 4.3 PNG only (no JPEG)

**Problem:** JPEG decoding requires DCT (Discrete Cosine Transform) which uses
floating-point math. The `riscv32im` instruction set has NO FPU — each float operation
costs 60-140 cycles (software-emulated). PNG uses zlib inflate (integer-only), which
is 3-10x cheaper.

**Decision:** Accept only PNG input at the hackathon. Tell judges: "We use lossless PNG
for pixel-level determinism. JPEG lossy encoding changes pixels on re-save, which breaks
hash verification. JPEG support is Phase 2."

### 4.4 Permissionless proof submission (relayer pattern)

**Problem:** If the photographer submits the tx directly, `msg.sender` = photographer's wallet.
Every photo links to one wallet. Privacy destroyed.

**Decision:** The contract has NO access control. It ONLY checks ZK proof validity.
`msg.sender` is irrelevant — it's whoever paid gas (the relayer). A Next.js API route
acts as the relayer, submitting txs from a server-side wallet.

**Why not ERC-2771:** Trusted forwarders explicitly preserve the signer's identity via
`_msgSender()`. The point of ERC-2771 is to know WHO authorized the action. We want the
opposite — to NOT know who.

**Why not ERC-4337:** Account abstraction's `UserOperation` still contains a `sender` field.
The user's smart contract wallet address is public. Same identity leak problem.

**Front-running:** Irrelevant. If an MEV bot front-runs the submission, the content hash
still gets attested — the desired outcome. The front-runner gains nothing because the proof
doesn't reference any submitter identity.

### 4.5 World ID is modular (optional)

**Problem:** World ID adds anti-Sybil (one human can't create 1000 fake identities), but
the World team may require Mini Apps (MiniKit) instead of standalone IDKit for the bounty.

**Decision:** World ID sections in the contract are commented out. Uncomment in 30 minutes
if confirmed. The guest program and host don't change — World ID is purely a contract +
frontend addition.

**Signal binding:** `signal = keccak256(pixelHash)` — binds human verification to specific
image content. A World ID proof for image A can't be reused for image B.

**Relayer compatibility:** World ID's `verifyProof` does NOT check `msg.sender`. It verifies
pure cryptographic parameters. A relayer can submit on behalf of the photographer.

### 4.6 ENS via NameStone (gasless, no photographer wallet)

**Decision:** The relayer backend calls NameStone API to create subnames like
`photo-001.proofframe.eth` with text records containing the pixel hash and disclosed metadata.
NameStone uses project-level API key authentication — no photographer wallet ever involved.
Subnames resolve via CCIP-Read (ERC-3668). Zero on-chain gas, zero identity leakage.

### 4.8 Local-First Trust Registry (MVP)

**Problem:** The original design used Chainlink CRE to fetch camera manufacturer keys from an
external trust registry via Confidential HTTP (TEE). This adds complexity and an external
dependency that isn't needed for the hackathon MVP.

**Decision:** MVP uses a hardcoded list of 3-5 mock secp256k1 public keys compiled into the
host program. The host builds a Merkle tree from these keys at proof generation time.

**Why this works:** The guest program is completely agnostic to how the Merkle tree was built.
It receives `(merkle_root, merkle_proof, pubkey)` as private inputs and verifies:
1. `sha256(pubkey)` is in the tree at `merkle_root` via `merkle_proof`
2. The ECDSA signature was made by `pubkey`

The guest doesn't know or care whether the keys came from a hardcoded list, a database,
or a Chainlink CRE workflow. This makes CRE a pure bolt-on enhancement:

**Upgrade path to CRE:**
- Replace hardcoded keys in host with CRE-fetched keys
- Same Merkle tree construction, same interface, same guest program
- Same contract — it only sees the `merkle_root` in the journal
- Zero changes to guest, contract, or frontend

**For judges:** "The trust registry is modular. For the hackathon we use a curated key list.
In production, Chainlink CRE fetches manufacturer keys via Confidential HTTP — same Merkle
tree, same ZK proof, same contract. The privacy guarantees are identical at every trust level."

### 4.7 Ledger role: Clear Signing on transactions + narrative

**Status: IMPLEMENTED**

**Decision:** Ledger's primary hackathon value is:
1. **ERC-7730 Clear Signing JSON** for the `attestImage()` function → targets $4K bounty
2. **Narrative:** "Ledger as content authenticator device" → targets $6K AI Agents bounty
3. **Demo impact:** Physical button press on Ledger during live demo

**Implementation:**
- ERC-7730 descriptor: `contracts/calldata-ImageAttestor.json` with all 14 params (11 displayed, 3 excluded)
- Frontend: wagmi v2 + ConnectKit for optional wallet connection on attest page
- Flow: After ZK proof + World ID, user optionally connects wallet (Ledger/MetaMask) → clicks "Submit Attestation" → wallet displays attestation fields via EIP-712 typed data signing → signature captured → relay submits tx from its own wallet
- **Privacy preserved**: The EIP-712 signature is for Ledger UX only. It is NOT stored on-chain. `msg.sender` remains the relayer wallet.
- Ledger connection is optional — attestation works without it via anonymous relay

The content signing key inside the ZK proof is a separate mock key. In production, this
key would live on the Ledger's secure element, but verifying Ledger's Ethereum-formatted
signatures inside the zkVM requires Keccak (stretch goal).

**Honest framing for judges:** "The Ledger displays attestation details via Clear Signing
before the relayer submits. The ZK proof verifies content origin with a separate signing key.
In production, these merge — the Ledger's key enters the ZK proof directly."

---

## 5. PERFORMANCE BUDGET

### Cycle counts (640×480 PNG, crop + grayscale)

| Operation | Cycles | Notes |
|-----------|--------|-------|
| Page-in file bytes (~300KB) | ~400K | ~1.35 cycles/byte sequential |
| SHA-256 of file (~300KB) | ~350K | 68 cycles/block, accelerated |
| ECDSA verify (k256 precompile) | ~500K-2M | With bigint precompile |
| Merkle verify (depth 10) | ~10K | 10 × SHA-256(64 bytes) |
| PNG decode | ~10-50M | zlib inflate + row filtering |
| Crop to 320×240 | ~700K | Pixel copying |
| Grayscale conversion | ~1.5M | Integer weighted sum per pixel |
| SHA-256 of output pixels (~230KB) | ~250K | Accelerated |
| **Total** | **~15-55M** | |

### Proving time estimates

| Prover | 30M cycles | Notes |
|--------|------------|-------|
| Dev mode | ~2s | Fake proof, for development only |
| CPU (Ryzen 9) | ~5-15 min | Needs ~77GB RAM for 8M cycles |
| GPU (RTX 4090, CUDA) | ~30-90s | Best local option |
| Mac M2 (Metal) | ~3-5 min | Metal acceleration since v1.0 |
| Boundless (cloud) | ~30-120s | Decentralized proving marketplace |
| RunPod Serverless | ~30-90s | On-demand GPU, ~$0.03-0.09/proof |

### On-chain costs

| Operation | Gas | Cost at 30 gwei |
|-----------|-----|-----------------|
| RISC Zero verify | ~300K | ~$0.40 |
| World ID verify | ~250K | ~$0.35 |
| Storage write | ~70K | ~$0.10 |
| Event emit | ~20K | ~$0.03 |
| **Total** | **~400-640K** | **~$0.55-0.88** |
| On Sepolia | Free | Free |

---

## 6. SMART CONTRACT DESIGN

### ImageAttestor.sol — key design principles

1. **Permissionless:** No `onlyOwner`, no access control, no `msg.sender` checks
2. **Idempotent:** Each pixelHash can only be attested once (`AlreadyAttested` error)
3. **World ID toggle:** Commented sections, uncomment with 30 min work
4. **No identity storage:** The `Attestation` struct has NO `address attester` field
5. **Verifier delegation:** Uses `IRiscZeroVerifier` interface to the deployed router
6. **Two-phase deployment:** Phase 1 uses MockVerifier (accepts any proof, for demo flow). Phase 2 uses real Verifier Router with Groth16 proofs via RunPod GPU.

### Contract addresses (Sepolia)

```
RISC Zero Verifier Router: 0x925d8331ddc0a1F0d96E68CF073DFE1d92b69187
World ID Router:           0x469449f251692e0779667583026b5a1e99512157
ENS Public Resolver:       0xE99638b40E4Fff0129D56f03b55b6bbC4BBE49b5
ENS Registry:              0x00000000000C2E074eC69A0dFb2997BA6C7d2e1e
```

### Journal encoding (must match between guest and contract)

The guest commits a `ProofOutput` struct via serde serialization. The contract
reconstructs the journal hash as:
```solidity
bytes memory journal = abi.encode(pixelHash, fileHash, merkleRoot, transformDesc);
verifier.verify(seal, GUEST_IMAGE_ID, sha256(journal));
```

**CRITICAL:** The journal encoding in the contract MUST match exactly what the guest
commits. If they differ, verification will always fail. Use the same field order and types.

---

## 7. PATCHED CRATE VERSIONS (RISC ZERO PRECOMPILES)

These exact versions are mandatory. Mismatches cause subtle compilation failures.

### Guest Cargo.toml patches:
```toml
[dependencies]
risc0-zkvm = { version = "3.0", default-features = false }
image = { version = "0.25", default-features = false, features = ["png"] }
k256 = { version = "=0.13.3", default-features = false, features = ["ecdsa"] }
sha2 = "=0.10.8"
serde = { version = "1.0", default-features = false, features = ["derive", "alloc"] }

[patch.crates-io]
sha2 = { git = "https://github.com/risc0/RustCrypto-hashes", tag = "sha2-v0.10.8-risczero.0" }
k256 = { git = "https://github.com/risc0/RustCrypto-elliptic-curves", tag = "k256/v0.13.3-risczero.1" }
crypto-bigint = { git = "https://github.com/risc0/RustCrypto-crypto-bigint", tag = "v0.5.5-risczero.0" }
```

### Why these specific versions:
- `sha2 =0.10.8` → matches the RISC Zero fork tag exactly
- `k256 =0.13.3` → matches the fork; uses bigint precompile for EC operations
- `crypto-bigint v0.5.5` → required by k256 fork for 256-bit modular multiplication
- `image 0.25` with `default-features = false` → disables threading (`rayon`), which breaks in zkVM
- `features = ["png"]` only → avoids JPEG DCT (float-heavy) and other unnecessary codecs

### Guest-specific rules:
- `risc0-zkvm` MUST have `default-features = false` — the default `client` feature pulls in prover code that doesn't compile for RISC-V
- Pin versions with `=` to prevent Cargo from resolving to incompatible versions
- Check `Cargo.lock` after build to verify patched crates are actually being used

---

## 8. METADATA THREAT MODEL

### What image files contain (why ProofFrame exists):

**JPEG EXIF (APP1 marker 0xFFE1):**
- GPS: sub-meter coordinates (enough to pinpoint a home)
- BodySerialNumber (0xA431): globally unique device identifier
- LensSerialNumber (0xA435): another unique identifier
- DateTimeOriginal + SubSecTime + OffsetTime: precise timeline
- MakerNote (0x927C): proprietary blob — Canon stores shutter count, Apple stores face detection data
- Thumbnail in IFD1: 160×120 JPEG of ORIGINAL uncropped image (often contains unblurred faces/plates)

**XMP (also APP1, identifier "http://ns.adobe.com/xap/1.0/"):**
- xmpMM:History: complete editing timeline with software names and file paths
- xmpMM:DocumentID: persistent tracking identifier across edits
- dc:creator: photographer's real name

**IPTC/IIM (APP13 marker 0xFFED):**
- Creator name (dataset 2:80), contact info, address, phone, email

**C2PA manifests (APP11 marker 0xFFEB):**
- COSE_Sign1 signature with full X.509 certificate chain → identifies photographer/org
- c2pa.actions: every editing operation with timestamps
- Ingredient manifests: chain back to original camera capture

**ICC color profiles (APP2 marker 0xFFE2):**
- Custom profiles contain manufacturer/model at bytes 56-63 of 128-byte header

**PNG metadata:**
- tEXt/iTXt/zTXt chunks (including XMP under keyword "XML:com.adobe.xmp")
- eXIf chunk: raw TIFF-encoded EXIF
- iCCP: ICC color profile
- AI-generated images: full generation parameters (prompt, model, seed) in tEXt

### How ProofFrame strips ALL of this:

The `image` crate's `load_from_memory()` → `to_rgb8()` pipeline produces ONLY a
width×height×3 byte buffer. No metadata reader. No metadata writer. The decode-to-pixels
operation is a structural metadata firewall — it cannot be bypassed because the crate
simply doesn't have the code to preserve metadata.

The host then re-encodes the transformed pixels as a clean PNG via `image::save_buffer()`.
The PNG encoder writes only essential chunks: IHDR, IDAT, IEND. Zero ancillary chunks.
Zero metadata survives.

---

## 9. SELECTIVE DISCLOSURE

The photographer chooses per-image what to reveal:

| Scenario | Date | Location | Camera Make | Dimensions |
|----------|------|----------|-------------|------------|
| War correspondent | ✅ | City only | ❌ | ✅ |
| Insurance claim | ✅ | Exact GPS | ✅ | ✅ |
| Whistleblower | ❌ | ❌ | ❌ | ❌ |
| News agency | ✅ | Exact GPS | ✅ | ✅ |

### Location precision reduction:
- **Exact:** Full GPS coordinates (6 decimal places)
- **City:** Rounded to 1 decimal (~11km precision)
- **Country:** Bounding box lookup → country name string
- **Hidden:** Not committed to journal at all

### Trust model for disclosed fields:
The camera signature covers the FULL file including EXIF bytes. The guest verifies
this signature before extracting any fields. Therefore:
- Disclosed fields are GUARANTEED authentic (from the signed file)
- Forging a disclosed field requires breaking the ECDSA signature
- The disclosure policy itself is committed to the journal (verifiers see what was hidden)

---

## 10. IMAGE TRANSFORMS

Supported at hackathon:

| Transform | Implementation | Cycle cost (640×480) |
|-----------|---------------|---------------------|
| **Crop** | `img.crop_imm(x, y, w, h)` | ~700K |
| **Grayscale** | `DynamicImage::ImageLuma8(img.to_luma8())` | ~1.5M |
| **Brighten** | `img.brighten(value)` — clamped add | ~3-5M |
| **Chain** | Sequential application | Sum of individual |

NOT supported (too expensive):
- **Resize** — interpolation is float-heavy (~25M cycles)
- **Blur** — gaussian kernel, neighbor access (~30M cycles)

### Determinism guarantee:
Because riscv32im uses soft-float (no FPU), there are zero platform-specific
floating-point differences. Same input = bit-identical output on every run.
This means the browser-side verification hash will ALWAYS match the guest-side hash
for the same image + same transforms.

### JPEG re-encoding caveat:
If someone saves the verified PNG as JPEG, pixels change (lossy compression).
The pixel hash won't match. Only lossless formats preserve the hash binding.
For the hackathon, require PNG end-to-end.

---

## 11. SPONSOR INTEGRATIONS

### Ledger ($10K pool — 2 tracks)

**Track 1: AI Agents x Ledger ($6K)**
- Pitch: "Ledger as content authenticator — hardware trust for content attestation"
- Integration: Ledger signs the attestation transaction with Clear Signing
- Demo: Physical button press on Ledger during live demo

**Track 2: Clear Signing ($4K)**
- Deliverable: ERC-7730 JSON file (`calldata-ImageAttestor.json`)
- Shows: "Attest authentic photo" + pixel hash + transforms on Ledger screen
- Validate: `erc7730 lint calldata-ImageAttestor.json`
- Submit to: github.com/LedgerHQ/clear-signing-erc7730-registry (PR)

### ENS ($10K pool — "Most Creative" track)

**Bounty description literally says:** "Store verifiable credentials or zk proofs in text records."
This is near-perfect alignment.

**Integration:**
- Text records: `io.proofframe.proof` → pixel hash, `io.proofframe.date` → disclosed date
- Gasless subnames: `photo-001.proofframe.eth` via NameStone API + CCIP-Read
- NameStone SDK: `@namestone/namestone-sdk` — REST API with project-level API key

**Requirement:** "Present at the ENS booth in person on Sunday morning." MANDATORY.

### Chainlink ($7K pool — Privacy Standard track) — OPTIONAL, NOT IN MVP

**Status:** Not required for MVP. The trust registry uses hardcoded mock keys (see 4.8).
CRE is a bolt-on enhancement that replaces hardcoded keys with TEE-fetched keys.

**Integration (if time permits):** CRE workflow with Confidential HTTP
- Fetches camera manufacturer trust registry via private API call
- API credentials stay inside TEE — never exposed
- Returns Merkle root of authorized keys on-chain
- `cre workflow simulate` output is sufficient for the bounty
- Per bounty: "Our team will deploy it to live CRE for you"

**Upgrade path:** Replace hardcoded keys in host → CRE-fetched keys. Same Merkle tree,
same guest, same contract. Zero architectural changes needed.

### World ID ($20K pool — IMPLEMENTED)

**Status:** Integrated. Optional anti-Sybil verification for attestations.

**How it works:**
- IDKit widget on attest page (after ZK proof, before submission)
- `signal = hashToField(pixelHash)` — binds human proof to this specific image
- `action = "attest"` — one nullifier per human per action type
- Nullifier tracking prevents duplicate attestations per World ID proof
- World ID proof submitted BY THE RELAYER, not the photographer
- Required: every attestation must include World ID proof

**On-chain:** Contract calls `IWorldIDGroups.verifyProof()` with Sepolia Router `0x469449f251692e0779667583026b5a1e99512157`

**Privacy:** World ID nullifiers are scoped to `(appId, action)` — unlinkable across attestations. No photographer identity revealed.

---

## 12. TRUST LEVELS — BE HONEST WITH JUDGES

| Trust Level | What signs | What it proves | When available |
|-------------|-----------|----------------|----------------|
| **Level 1** (hackathon) | Mock software key | "A registered signer committed to this image" — reputation model | Now |
| **Level 2** (production) | Ledger hardware key | "A hardware device approved this" — key theft resistance | With Keccak precompile in ZK |
| **Level 3** (production) | C2PA camera key | "An authorized camera CAPTURED this" — true provenance | When Leica/Sony/Nikon keys integrated |

**The honest line for judges:**
"With software signing, this is a reputation system — if a signer attests fakes, their key
gets revoked. The same ZK pipeline works with C2PA camera signatures. When we plug in
Leica or Sony factory keys, the proof upgrades from reputation to capture-level trust.
Our contribution is the privacy layer that works at every trust level."

---

## 13. DEMO SCRIPT (3 minutes)

**0:00-0:15 — Hook:** Two photos side by side. "Which is real? AI detectors can't tell."

**0:15-0:40 — Problem:** "AI-generated fakes are eroding trust in all visual media. C2PA camera
signatures prove authenticity but leak the photographer's identity. The EU AI Act mandates
content provenance by August 2026 — we need proof without surveillance."

**0:40-2:00 — Live demo:**
1. Upload test photo
2. Show disclosure selector: check Date + City Location, uncheck rest
3. Choose Crop + Grayscale transforms
4. Show proof generation (use pre-computed proof)
5. Relayer submits tx → attestation confirmed
6. Show ENS: `demo.proofframe.eth` → proof data
7. Verify tab: upload clean PNG → hash matches → ✅ VERIFIED
8. Upload deepfake → ❌ NO ATTESTATION

**2:00-2:30 — Three disclosure levels:** Full / Partial / Maximum privacy (pre-verified)

**2:30-2:50 — Integrations:** Ledger Clear Signing, ENS subnames, Chainlink CRE simulation

**2:50-3:00 — Close:** "ProofFrame: fight disinformation with proof, not surveillance."

**Demo prep:**
- Pre-compute 4 proofs (3 disclosure levels + 1 matching live demo)
- Start one "live" proof 5 min before demo
- Verification is INSTANT — spend most demo time there
- Have pre-verified images loaded as fallback

---

## 14. FILE STRUCTURE REFERENCE

```
proofframe/
├── .claude/CLAUDE.md                   # Agent instructions (summary)
├── .env.example                        # All env vars documented
├── .gitignore
├── Cargo.toml                          # Workspace: [common, methods, host]
├── README.md                           # Project overview
├── TASKS.md                            # Ordered implementation checklist
│
├── common/
│   ├── Cargo.toml                      # serde only — no zkvm dependency
│   └── src/lib.rs                      # Transform, DisclosurePolicy, ExifFields,
│                                       # GuestInput, ProofOutput, RelayRequest
│
├── methods/
│   ├── Cargo.toml                      # risc0-build dependency
│   ├── build.rs                        # embed_methods() → compiles guest to ELF
│   ├── src/lib.rs                      # Exports PROOFFRAME_GUEST_ELF + _ID
│   └── guest/
│       ├── Cargo.toml                  # image, k256, sha2 with patches
│       └── src/main.rs                 # THE ZK GUEST PROGRAM
│
├── host/
│   ├── Cargo.toml
│   └── src/main.rs                     # Mock signing, EXIF parse, proof gen
│
├── contracts/
│   ├── foundry.toml
│   ├── src/ImageAttestor.sol           # Permissionless verifier
│   └── calldata-ImageAttestor.json     # ERC-7730 Clear Signing
│
├── frontend/
│   ├── package.json                    # next, wagmi, viem, idkit, namestone
│   ├── app/
│   │   ├── page.tsx                    # TODO: Landing page
│   │   ├── attest/page.tsx             # TODO: Upload → configure → attest
│   │   ├── verify/page.tsx             # TODO: Upload → hash → verify
│   │   └── api/relay/route.ts          # Relayer: submit tx anonymously
│   └── lib/
│       ├── contracts.ts                # ABI + addresses
│       └── imageHash.ts                # Client-side pixel hashing
│
├── scripts/
│   └── generate-test-images.py         # Creates test PNGs
│
└── docs/
    ├── ARCHITECTURE.md                 # Decision records (summary)
    └── PRIVACY.md                      # Privacy analysis
```

---

## 15. CONTINGENCY PLANS

| Hours behind | What to cut | What you lose | What remains |
|-------------|-------------|---------------|--------------|
| 2h at Phase 2 | EXIF in VM → parse on host only (Option A) | Slightly weaker proof chain | Everything else |
| 3h at Phase 3 | NameStone subnames → plain text records | Per-image ENS names | ENS text records still work |
| 5h at Phase 3 | Chainlink CRE entirely | $2K bounty | Ledger + ENS + core ZK |
| 6h at Phase 3 | World ID entirely | $8K bounty | Already conditional |
| 8h+ at Phase 4 | Dev-mode proofs only | "Real" proof demo | Explain "real proofs take N min" |
| Nuclear | Skip transforms, hash-only | Weaker demo | Still valid ZK content auth |

**NEVER cut:** RISC Zero core proof, permissionless relayer, ENS text records, demo video.

---

## 16. DEPLOYMENT

### Fly.io (Primary — Next.js + Rust Prover)

**URL:** `https://proofframe.fly.dev`

3-stage Docker build (`Dockerfile.fly`):
1. **rust:1.88-bookworm** — compiles `proofframe-host` binary + guest ELF via RISC Zero toolchain
2. **node:20-bookworm** — builds Next.js frontend with `bun`
3. **node:20-slim** — slim runtime with binary at `/usr/local/bin/proofframe-host`

**Config (`fly.toml`):** 2 shared CPUs, 1GB RAM, Paris region (cdg), auto-stop/start.

**Why Fly.io:** The `/api/prove` route spawns the Rust binary via `execFile()` — requires a persistent server, not serverless. Fly.io supports Docker with long-running processes. Vercel serverless can't spawn arbitrary binaries.

**Deploy:** `fly deploy` from project root.

---

## 17. ENVIRONMENT VARIABLES

```bash
# Blockchain
SEPOLIA_RPC_URL=https://eth-sepolia.g.alchemy.com/v2/YOUR_KEY
DEPLOYER_PRIVATE_KEY=0x...    # For contract deployment
RELAYER_PRIVATE_KEY=0x...     # For anonymous tx submission

# World ID (implemented — optional anti-Sybil)
WORLD_APP_ID=app_staging_xxxxx
NEXT_PUBLIC_WORLD_APP_ID=app_staging_xxxxx  # Client-side for IDKit
WORLD_ACTION_ID=attest_image

# ENS / NameStone
NAMESTONE_API_KEY=your_key
ENS_DOMAIN=proof-frame.eth

# IPFS / Infura (optional — for pinning clean images)
# INFURA_IPFS_PROJECT_ID=your_id
# INFURA_IPFS_PROJECT_SECRET=your_secret

# RISC Zero
RISC0_DEV_MODE=1              # Set for dev, unset for real proofs
RISC0_INFO=1                  # Show cycle counts

# RunPod Serverless (GPU proving)
# RUNPOD_API_KEY=rp_xxxxxxxxxxxx
# RUNPOD_ENDPOINT_ID=your-endpoint-id

# Boundless (remote proving, alternative to RunPod)
# BONSAI_API_KEY=your_key
# BONSAI_API_URL=https://api.bonsai.xyz
```

---

## 17. COMMON PITFALLS & GOTCHAS

1. **First guest compilation is SLOW** — compiles Rust std for RISC-V. Allow 10-15 min. Cache by running once before hackathon.

2. **`default-features = false`** on `risc0-zkvm` in guest is MANDATORY. Default features pull in prover code that won't compile for RISC-V.

3. **Journal encoding mismatch** — if the guest commits fields in order A,B,C but the contract encodes A,C,B, verification ALWAYS fails. Use identical field ordering.

4. **Groth16 requires x86 + GPU** — Apple Silicon cannot generate Groth16 locally. Use RunPod Serverless (RTX 4090, ~$0.03-0.09/proof) or dev-mode with MockVerifier for the demo. See `docs/TASKS.md` Phase 10.

5. **PNG orientation** — the `image` crate does NOT apply EXIF Orientation tag. Photos from phones may appear rotated after decode. Accept this for hackathon.

6. **Browser pixel hashing** — `canvas.getImageData()` returns RGBA (4 bytes/pixel). The guest outputs RGB (3 bytes/pixel). The client-side hash function MUST extract only RGB, skipping alpha. See `frontend/lib/imageHash.ts`.

7. **Merkle proof encoding** — the `(sibling, is_left_sibling)` tuple must use consistent ordering between host and guest. The host builds the proof; the guest verifies it. Test with a known tree first.

8. **RISC Zero v3.0 security** — v3.0.3 patched a critical vulnerability (malicious host writing to arbitrary guest memory). Always use v3.0.5+.

9. **Relayer funding** — the relayer wallet needs Sepolia ETH. Fund it from a faucet (faucets.chain.link/sepolia) before deploying.

10. **NameStone requires SIWE** — initial domain setup requires a Sign-In With Ethereum signature from the domain owner wallet. Do this before the hackathon.
