# ProofFrame — Implementation Tasks (Sequential)

> Status: `[ ]` = TODO, `[~]` = In Progress, `[x]` = Done

## Test Image & Signing Key

- **Source image:** ETHGlobal Cannes venue photo (JPEG -> convert to PNG)
- **Signing key:** Generate fresh secp256k1 keypair at runtime (mock signing for hackathon)
- The generated pubkey is the primary key in the Merkle trust registry; 2-4 additional mock keys fill the tree

## Dependency Graph

```
T1 (Common Types) ─────┬──→ T2 (ZK Guest) ──┐
                        ├──→ T3 (Host)  ──────┤
                        ├──→ T4 (Contract) ───┼──→ T5 (Integration)
                        └──→ T6 (Frontend) ───┤
                                              └──→ T7 (ENS + Ledger)
T8 (Test Images) ────────────────────────────────→ T5
```

---

## Phase 1: Foundation

### T1.1 — Common Types `[x]`

**Files:** `common/src/lib.rs`, `common/Cargo.toml`

- [ ] Define `Transform` enum: `None`, `Crop { x, y, width, height }`, `Grayscale`, `Brighten { value: i32 }`, `Chain(Vec<Transform>)`
- [ ] Define `LocationPrecision` enum: `Exact`, `City`, `Country`, `Hidden`
- [ ] Define `DisclosurePolicy` struct: `reveal_date`, `reveal_location`, `reveal_camera_make`, `location_precision`
- [ ] Define `ExifFields` struct: `date`, `gps_lat`, `gps_lon`, `camera_make`, `camera_model`, `image_width`, `image_height`
- [ ] Define `GuestInput` struct: `image_bytes`, `signature`, `pubkey`, `merkle_proof`, `merkle_root`, `transform`, `disclosure`, `exif`
- [ ] Define `ProofOutput` struct: `pixel_hash`, `file_hash`, `merkle_root`, `transform_desc`, `disclosed_date`, `disclosed_location`, `disclosed_camera_make`, `image_width`, `image_height`
- [ ] Define `RelayRequest` struct: `seal`, `journal`, `pixel_hash`, `world_id_proof` (optional)
- [ ] All types derive `serde::Serialize, serde::Deserialize, Clone, Debug`
- [ ] No `risc0-zkvm` dependency — must compile for both native and riscv32im

**Verify:** `cargo check -p proofframe-common`

---

### T1.2 — Test Image + Mock C2PA Signing `[x]`

**Files:** `scripts/generate-test-images.py`, `test_images/`

- [x] Convert venue JPEG to PNG -> `test_images/ethglobal_cannes.png`
- [x] Embed EXIF in PNG (eXIf chunk) — simulates camera embedding metadata at capture
- [x] Generate secp256k1 keypair + sign PNG with raw ECDSA (mocks C2PA camera signature)
- [x] Signature covers entire file including EXIF — prevents metadata forgery
- [x] Create demo metadata JSON showing all 32+ fields that get stripped by ZK proof
- [x] Remove `exif` from `GuestInput` — guest extracts EXIF from `image_bytes` directly

**Verify:** `python3 scripts/generate-test-images.py && ls test_images/`

---

## Phase 2: ZK Core

### T2.1 — Guest: Crypto Verification + EXIF Extraction `[x]`

**Files:** `methods/guest/src/main.rs`

- [ ] Add `#![no_main]` and `risc0_zkvm::guest::env` imports
- [ ] `env::read::<GuestInput>()` — read all private inputs
- [ ] SHA-256 hash of `image_bytes` -> `file_hash` (using `sha2::Sha256`)
- [ ] ECDSA verify: `k256::ecdsa::VerifyingKey` verifies `file_hash` against `signature` + `pubkey`
- [ ] Implement `verify_merkle(leaf, proof, root)` — SHA-256 pair-and-hash
- [ ] Merkle proof verify: `verify_merkle(sha256(pubkey), &merkle_proof, merkle_root)`
- [ ] Parse PNG chunks from `image_bytes`, extract eXIf chunk data
- [ ] Parse TIFF-encoded EXIF from eXIf bytes -> populate `ExifFields`
- [ ] Panic on any verification failure (guest panic = invalid proof)

**Key rules:**
- Raw ECDSA over SHA-256 — NO Ethereum `personal_sign` prefix
- EXIF extracted from signed file bytes (not a separate input) — prevents metadata forgery

---

### T2.2 — Guest: Image Processing `[x]`

**Files:** `methods/guest/src/main.rs`

- [ ] `image::load_from_memory(&image_bytes)` -> decode PNG to `DynamicImage`
- [ ] Extract dimensions -> `image_width`, `image_height`
- [ ] Apply transforms based on `Transform` enum:
  - `None` -> no-op
  - `Crop { x, y, w, h }` -> `img.crop(x, y, w, h)`
  - `Grayscale` -> `img.grayscale()`
  - `Brighten { value }` -> `img.brighten(value)`
  - `Chain(vec)` -> apply sequentially
- [ ] Build `transform_desc` string (e.g. `"crop(10,10,300,220)+grayscale"`)
- [ ] Extract raw RGB bytes: `.to_rgb8().into_raw()`
- [ ] SHA-256 of RGB bytes -> `pixel_hash`

**Key rule:** Pixel hash is over RGB (3 bytes/pixel), NOT RGBA

---

### T2.3 — Guest: Disclosure + Commit `[x]`

**Files:** `methods/guest/src/main.rs`

- [ ] Apply `DisclosurePolicy` to `ExifFields`:
  - `disclosed_date = if reveal_date { exif.date } else { None }`
  - `disclosed_location = if reveal_location { format by precision } else { None }`
  - `disclosed_camera_make = if reveal_camera_make { exif.camera_make } else { None }`
- [ ] Location precision: `Exact` -> full coords, `City` -> ~0.01 degree, `Country` -> very truncated, `Hidden` -> None
- [ ] Assemble `ProofOutput` with all computed fields
- [ ] `env::commit(&proof_output)` — commits to journal (public)

**Verify:** `cargo build -p proofframe-methods` (triggers guest ELF compilation)

---

### T3.1 — Host: CLI + File Reading `[x]`

**Files:** `host/src/main.rs`, `host/Cargo.toml`

- [ ] Clap derive CLI: `--image <path>`, `--transform <json>`, `--disclosure <json>`, `--exif <json>`, `--output <path>`
- [ ] Read PNG file bytes with `std::fs::read`
- [ ] Parse EXIF from companion JSON sidecar (`<image>.exif.json`) or `--exif` flag
- [ ] Populate `ExifFields` struct
- [ ] Default disclosure: reveal nothing

**Verify:** `cargo build -p proofframe-host && cargo run -p proofframe-host -- --help`

---

### T3.2 — Host: Signing + Merkle Tree `[x]`

**Files:** `host/src/main.rs`

- [ ] Generate fresh secp256k1 `SigningKey` using `k256::ecdsa::SigningKey::random()`
- [ ] Sign `SHA-256(file_bytes)` with raw ECDSA (no prefix) -> `signature`
- [ ] Extract compressed public key bytes (33 bytes)
- [ ] Hardcode 2-4 additional mock secp256k1 public keys
- [ ] Build Merkle tree: sort leaf hashes, pair-and-hash upward (depth ~3)
- [ ] Generate Merkle proof for the signing key's leaf

**Key rule:** Merkle verification in host must match guest's `verify_merkle()` exactly

---

### T3.3 — Host: Prover + Output `[x]`

**Files:** `host/src/main.rs`

- [ ] Assemble `GuestInput` from all prepared data
- [ ] Create `ExecutorEnv::builder().write(&guest_input).build()`
- [ ] Import `PROOFFRAME_GUEST_ELF` from `proofframe_methods`
- [ ] Run prover: `default_prover().prove(env, PROOFFRAME_GUEST_ELF)`
- [ ] Decode `ProofOutput` from receipt journal
- [ ] Print results: pixel_hash (hex), file_hash (hex), disclosed metadata
- [ ] Save clean PNG: decode original, apply transforms, re-encode (zero metadata)
- [ ] Serialize receipt (seal + journal) to JSON for relay

**Verify:** `RISC0_DEV_MODE=1 cargo run -p proofframe-host --release -- --image test_images/ethglobal_cannes.png`

---

## Phase 3: ZK Smoke Test

### T5.1 — End-to-End ZK Test `[x]`

- [x] Run full pipeline with test image in dev mode
- [x] Verify: pixel_hash is 32 bytes hex, deterministic (same input = same hash)
- [x] Verify: file_hash differs from pixel_hash
- [x] Verify: disclosed fields respect disclosure policy
- [x] Verify: Merkle root is consistent
- [x] Pixel hash matches between host output and Python script (8eedb92f...)

**Verify:** `RISC0_DEV_MODE=1 cargo run -p proofframe-host --release -- --image test_images/ethglobal_cannes.png`

---

## Phase 4: Smart Contracts

### T4.1 — ImageAttestor.sol `[x]`

**Files:** `contracts/src/ImageAttestor.sol`

- [ ] Install RISC Zero Solidity SDK: `forge install risc0/risc0-ethereum`
- [ ] Import `IRiscZeroVerifier` interface
- [ ] Define `Attestation` struct: `fileHash`, `merkleRoot`, `transformDesc`, `timestamp`, `disclosedDate`, `disclosedLocation`, `disclosedCameraMake`, `imageWidth`, `imageHeight`
- [ ] State: `mapping(bytes32 => Attestation)`, `IRiscZeroVerifier immutable verifier`, `bytes32 immutable imageId`
- [ ] Constructor: takes `verifier` address + `imageId`
- [ ] `attestImage(bytes calldata seal, bytes calldata journal)`:
  - Decode journal (field order MUST match `ProofOutput`)
  - `verifier.verify(seal, imageId, sha256(journal))`
  - Revert `AlreadyAttested` if duplicate pixelHash
  - Store attestation
  - Emit `ImageAttested(pixelHash, fileHash, merkleRoot, timestamp)`
- [ ] `isVerified(bytes32 pixelHash) view returns (bool)`
- [ ] `getAttestation(bytes32 pixelHash) view returns (Attestation memory)`
- [ ] **NO `msg.sender` checks. NO identity storage. Permissionless.**

**Verify:** `cd contracts && forge build`

---

### T4.2 — Deploy Script `[x]`

**Files:** `contracts/script/Deploy.s.sol`

- [ ] Standard Foundry `Script` pattern
- [ ] Read `DEPLOYER_PRIVATE_KEY` from env
- [ ] Deploy `ImageAttestor` to Sepolia with verifier router `0x925d8331ddc0a1F0d96E68CF073DFE1d92b69187` + guest image ID
- [ ] Log deployed Sepolia address

**Verify:** `forge script script/Deploy.s.sol --rpc-url sepolia --broadcast`

---

### T4.3 — Contract Tests `[x]`

**Files:** `contracts/test/ImageAttestor.t.sol`

- [ ] Mock `IRiscZeroVerifier` (always returns success)
- [ ] Test: `attestImage` stores attestation correctly
- [ ] Test: `isVerified` returns true after attestation, false before
- [ ] Test: duplicate pixelHash reverts with `AlreadyAttested`
- [ ] Test: `getAttestation` returns correct fields
- [ ] Test: `ImageAttested` event emitted with correct params

**Verify:** `cd contracts && forge test`

---

### T4.4 — ERC-7730 Clear Signing JSON `[x]`

**Files:** `contracts/calldata-ImageAttestor.json`

- [ ] ERC-7730 descriptor for `attestImage()` function
- [ ] Map parameters to human-readable Ledger display labels
- [ ] Include contract metadata (name, Sepolia chain ID 11155111, deployed address)

**Verify:** Valid JSON, passes `erc7730 lint` if available

---

## Phase 5: Contract Integration

### T5.3 — Deploy with Mock Verifier + Submit Receipt `[x]`

- [x] Deploy ImageAttestor with MockVerifier on Sepolia (USE_MOCK_VERIFIER=true)
- [x] MockVerifier: `0x9FF9531c4cb14C6CFa6eBeCeb3BFf01bab704f2c`
- [x] ImageAttestor: `0x31B1f11EBDCB75c7D73674a80b7a52f6f1a61E80`
- [x] Update contract address in `frontend/lib/contracts.ts` and `calldata-ImageAttestor.json`
- [x] Submit dev-mode receipt via `cast` — tx `0x82fb0913...`
- [x] Verify: `isVerified(pixelHash)` returns true

**Note:** Mock verifier accepts any proof. Real Groth16 via RunPod is Phase 10.

---

## Phase 6: Frontend

### T6.1 — Project Setup + Landing Page `[x]`

**Files:** `frontend/app/layout.tsx`, `frontend/app/page.tsx`, config files

- [ ] `npm install` in frontend directory
- [ ] Create Next.js App Router layout with Tailwind CSS
- [ ] Create `tailwind.config.js`, `postcss.config.js`, `tsconfig.json`
- [ ] Landing page: project name, description, "Attest" and "Verify" nav buttons

**Verify:** `cd frontend && npm run dev`

---

### T6.2 — imageHash.ts `[x]`

**Files:** `frontend/lib/imageHash.ts`

- [ ] `computePixelHash(file: File): Promise<string>`
- [ ] Load image into canvas, draw, call `getImageData()`
- [ ] Extract RGB only — skip every 4th byte (alpha channel)
- [ ] SHA-256 via `crypto.subtle.digest('SHA-256', rgbBytes)`
- [ ] Return hex string

**Key rule:** Must produce identical hash as guest's pixel_hash for the same PNG

---

### T6.3 — contracts.ts `[x]`

**Files:** `frontend/lib/contracts.ts`

- [ ] Export ImageAttestor ABI (from Foundry output)
- [ ] Export Sepolia contract address (placeholder until deployed)
- [ ] Export Sepolia chain config
- [ ] Typed viem helpers

---

### T6.4 — Verify Page `[x]`

**Files:** `frontend/app/verify/page.tsx`

- [ ] Image upload (drag-and-drop or file picker)
- [ ] On upload: compute pixel hash via `imageHash.ts`
- [ ] Query Sepolia contract `isVerified(pixelHash)` + `getAttestation(pixelHash)` via viem public client
- [ ] Display: green badge + metadata if verified, red "NOT VERIFIED" if not
- [ ] Read-only — no wallet connection needed

---

### T6.5 — Attest Page `[x]`

**Files:** `frontend/app/attest/page.tsx`

- [ ] Image upload with preview
- [ ] Transform controls: crop inputs (x, y, w, h), grayscale toggle, brightness slider
- [ ] Disclosure policy: checkboxes for date/location/camera, location precision dropdown
- [ ] "Generate Proof" button -> calls host backend (or mock flow for hackathon)
- [ ] "Submit to Chain" button -> calls `/api/relay`
- [ ] Status display: generating -> submitting -> confirmed -> tx hash + ENS name
- [ ] **NO wallet connection anywhere on this page**

---

### T6.6 — Relay API Route `[x]`

**Files:** `frontend/app/api/relay/route.ts`

- [ ] POST endpoint accepting `{ seal, journal, pixelHash }`
- [ ] Load `RELAYER_PRIVATE_KEY` from env (server-side only)
- [ ] Create viem wallet client with relayer account
- [ ] Call `attestImage(seal, journal)` on Sepolia contract
- [ ] Wait for tx receipt
- [ ] Return `{ txHash, blockNumber }`

---

## Phase 7: Cross-Boundary Verification

### T5.2 — Pixel Hash Consistency `[x]`

- [x] Take clean PNG output from T5.1 (`test_images/ethglobal_cannes.clean.png`)
- [x] Compute pixel hash using browser method (canvas RGBA -> extract RGB -> SHA-256)
- [x] Compare with pixel_hash from ZK proof journal
- [x] Result: MATCH — `8eedb92fe2cd904248747b5631b9fbd29bcebd14509a905835c903957add9fc2`
- [x] Verification script: `bun run frontend/scripts/verify-pixel-hash.ts`

---

## Phase 8: Bounty Integrations

### T7.1 — ENS NameStone `[ ]`

**Files:** `frontend/app/api/relay/route.ts`

- [ ] After successful attestation tx, call NameStone API
- [ ] Create subname: `photo-{counter}.proofframe.eth`
- [ ] Set text records: `io.proofframe.pixelHash`, `io.proofframe.txHash`, `io.proofframe.date`
- [ ] Return ENS name alongside tx hash in API response

---

### T7.2 — Ledger Demo Flow `[x]`

**Files:** `contracts/calldata-ImageAttestor.json`

- [x] ERC-7730 JSON updated with function selector `0x203f9663`, `$id`, proper format
- [x] Ledger Stax shows text-only during signing (no image display — ERC-7730 limitation)
- [x] Fields displayed: Pixel Hash, File Hash, Trust Registry, Transforms, Date, Location, Camera, Size
- [x] Note: `erc7730` Python linter requires Python 3.12 (not 3.14) — validate at hackathon

---

## Phase 9: Design System

### T9.1 — Apply Stitch "CipherGrain" Design System `[x]`

**Files:** `frontend/tailwind.config.js`, `frontend/app/globals.css`, `frontend/app/layout.tsx`, `frontend/app/page.tsx`, `frontend/app/attest/page.tsx`, `frontend/app/verify/page.tsx`, `frontend/app/components/Navigation.tsx` (new), `frontend/app/components/Footer.tsx` (new)

- [x] Tailwind config: M3 color tokens, custom border radii, font families, @tailwindcss/forms
- [x] Global CSS: glass-panel, hero-gradient utilities, Material Symbols, updated scrollbar
- [x] Layout: Inter + Space Grotesk fonts, Material Symbols, dark class, shared Nav + Footer
- [x] Navigation: sticky nav with ProofFrame logo, active link state via usePathname
- [x] Footer: "Powered by RISC Zero zkVM · Ethereum Sepolia" + links
- [x] Landing: hero section with flow diagram, bento grid features, CTA buttons
- [x] Attest: 2-column layout, styled drop zone, transform controls, disclosure cards, receipt upload
- [x] Verify: verified state (glassmorphic shield + attestation details), not-verified state (blurred image + error overlay)
- [x] All business logic preserved (image hashing, receipt upload, contract verification, relay API)

**Verify:** `cd frontend && npm run build` (all pages compile successfully)

---

## Phase 10: Real Groth16 Proofs (RunPod Serverless)

### T10.1 — Docker Image for GPU Proving `[ ]`

**Files:** `Dockerfile`, `handler.py`

- [ ] Multi-stage Docker build: compile host binary with CUDA support, package with Python RunPod handler
- [ ] Pre-compile guest ELF at build time (not runtime)
- [ ] Python handler: decode base64 image, call Rust binary, return receipt JSON
- [ ] Test locally with `RISC0_DEV_MODE=1`, then on RunPod with real GPU
- [ ] Push to GHCR: `ghcr.io/pycckuu/proofframe-prover:latest`

### T10.2 — RunPod Serverless Endpoint `[ ]`

- [ ] Create RunPod serverless endpoint (RTX 4090, idle timeout 5 min, max workers 2)
- [ ] Test via curl: submit image, poll status, get Groth16 receipt
- [ ] Verify receipt is valid (real Groth16, not dev mode)

### T10.3 — Frontend Prove API + UI `[ ]`

**Files:** `frontend/app/api/prove/route.ts`, `frontend/app/api/prove/status/route.ts`, `frontend/app/attest/page.tsx`

- [ ] `/api/prove` POST: submit image + config to RunPod, return jobId
- [ ] `/api/prove/status` GET: poll RunPod status, return receipt when done
- [ ] Attest page: "Generate Proof (GPU)" button with progress indicator
- [ ] Keep manual receipt upload as fallback
- [ ] Add env vars: `RUNPOD_API_KEY`, `RUNPOD_ENDPOINT_ID`

### T10.4 — Redeploy with Real Verifier `[ ]`

- [ ] Redeploy ImageAttestor pointing to RISC Zero Verifier Router (`0x925d8331...`)
- [ ] Submit Groth16 receipt — verified by real on-chain verifier
- [ ] Full E2E: frontend → RunPod GPU → Groth16 receipt → relay → Sepolia → verified

**Cost:** ~$0.03-0.09 per proof on RTX 4090 (pay per second)

---

## Key Risks

1. **`image` crate riscv32im compilation** — highest risk. Fallback: pass raw pixels from host (weaker proof).
2. **Browser vs Rust pixel mismatch** — canvas vs `image` crate may differ. T5.2 catches this.
3. **Journal encoding** — guest serde vs contract ABI. Solution: contract accepts opaque journal bytes + verifies sha256.

## Verification Commands

| Phase | Command |
|-------|---------|
| Foundation | `cargo check -p proofframe-common` |
| ZK Core | `RISC0_DEV_MODE=1 cargo run -p proofframe-host --release -- --image test_images/ethglobal_cannes.png` |
| Contracts | `cd contracts && forge build && forge test` |
| Frontend | `cd frontend && bun run build` |
| Privacy | `grep -r "msg.sender" contracts/src/` (should be zero identity checks) |
