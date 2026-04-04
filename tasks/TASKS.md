# ProofFrame — Implementation Tasks

> Status: `[ ]` = TODO, `[~]` = In Progress, `[x]` = Done

## Dependency Graph

```
T1 (Common Types) ─────┬──→ T2 (ZK Guest) ──┐
                        ├──→ T3 (Host)  ──────┤
                        ├──→ T4 (Contract) ───┼──→ T5 (Integration)
                        └──→ T6 (Frontend) ───┤
                                              └──→ T7 (ENS + Ledger)
T8 (Test Images) ────────────────────────────────→ T5
```

## Parallelism Strategy

| Agent | Tasks | Notes |
|-------|-------|-------|
| Agent A (ZK) | T1 → T2 → T3 → T5 | Does T1 first (unblocks others) |
| Agent B (Contracts) | waits for T1 → T4 | |
| Agent C (Frontend) | waits for T1 → T6 → T7 | |
| Agent D (Testing) | T8 immediately → assists T5 | |

---

## T1: Common Types (BLOCKING)

**Priority: Do first — all other tasks depend on this.**

- [ ] Create `common/src/lib.rs` with shared types:
  - `Transform` enum: `None`, `Crop { x, y, width, height }`, `Grayscale`, `Brighten { value: i32 }`, `Chain(Vec<Transform>)`
  - `DisclosurePolicy` struct: `reveal_date: bool`, `reveal_location: bool`, `reveal_camera_make: bool`, `location_precision: LocationPrecision`
  - `LocationPrecision` enum: `Exact`, `City`, `Country`, `Hidden`
  - `ExifFields` struct: `date: Option<String>`, `gps_lat: Option<f64>`, `gps_lon: Option<f64>`, `camera_make: Option<String>`, `camera_model: Option<String>`, `image_width: u32`, `image_height: u32`
  - `GuestInput` struct: `image_bytes`, `signature`, `pubkey`, `merkle_proof`, `merkle_root`, `transform`, `disclosure`, `exif`
  - `ProofOutput` struct: `pixel_hash`, `file_hash`, `merkle_root`, `transform_desc`, `disclosed_date`, `disclosed_location`, `disclosed_camera_make`, `image_width`, `image_height`
  - `RelayRequest` struct: `seal`, `journal`, `pixel_hash`, `world_id_proof` (optional)
- [ ] All types derive `serde::Serialize, serde::Deserialize`
- [ ] No `risc0-zkvm` dependency — `common` must compile for both native and riscv32im

**Files:** `common/src/lib.rs`, `common/Cargo.toml`

---

## T2: ZK Guest Program

**Depends on: T1**

- [ ] Implement `methods/guest/src/main.rs`:
  1. `env::read::<GuestInput>()` — read all private inputs
  2. SHA-256 hash of `image_bytes` → `file_hash`
  3. ECDSA verify: `k256::ecdsa::VerifyingKey::verify(file_hash, signature, pubkey)`
  4. Merkle proof verify: `verify_merkle(sha256(pubkey), proof, root)`
  5. `image::load_from_memory(&image_bytes)` → decode PNG to RGB pixels
  6. Apply transforms (crop, grayscale, brighten)
  7. SHA-256 hash of final pixel bytes → `pixel_hash`
  8. Selective disclosure based on `DisclosurePolicy`
  9. `env::commit(&ProofOutput { ... })` — commit public outputs
- [ ] Implement `verify_merkle()` helper function
- [ ] Test: `RISC0_DEV_MODE=1 cargo run --release`

**Files:** `methods/guest/src/main.rs`, `methods/guest/Cargo.toml`

---

## T3: Host Program

**Depends on: T1**

- [ ] Implement `host/src/main.rs`:
  1. CLI: accept image path, transform config, disclosure config
  2. Read PNG file bytes
  3. Parse EXIF metadata (use `kamadak-exif` or `rexif` crate)
  4. Mock signing: generate secp256k1 keypair, sign SHA-256(file_bytes)
  5. Build Merkle tree from list of authorized pubkeys (hardcoded mock keys for MVP)
  6. Generate Merkle proof for the signing key
  7. Assemble `GuestInput` struct
  8. Run RISC Zero prover → get receipt (seal + journal)
  9. Decode `ProofOutput` from journal
  10. Print results + save clean PNG (re-encoded from decoded pixels)
- [ ] Hardcode 3-5 mock secp256k1 pubkeys for the trust registry
- [ ] Support `RISC0_DEV_MODE=1` for fast iteration

**Files:** `host/src/main.rs`, `host/Cargo.toml`

---

## T4: Smart Contract

**Depends on: T1 (for ProofOutput struct → journal encoding)**

- [ ] Implement `contracts/src/ImageAttestor.sol`:
  - `attestImage(bytes32 pixelHash, bytes32 fileHash, bytes32 merkleRoot, string transforms, bytes seal, bytes journal)`
  - Verify RISC Zero proof: `verifier.verify(seal, IMAGE_ID, sha256(journal))`
  - Store attestation: `attestations[pixelHash] = Attestation(fileHash, merkleRoot, transforms, timestamp, disclosedMetadata)`
  - NO `msg.sender` checks. NO identity storage. Permissionless.
  - `AlreadyAttested` error for duplicate pixelHash
  - `isVerified(bytes32 pixelHash)` view function
  - Events: `ImageAttested(pixelHash, fileHash, merkleRoot, timestamp)`
- [ ] Implement `contracts/script/Deploy.s.sol`
- [ ] Implement `contracts/test/ImageAttestor.t.sol`
- [ ] Create `contracts/calldata-ImageAttestor.json` (ERC-7730 Clear Signing for Ledger)
- [ ] Journal encoding MUST match guest `env::commit()` field order exactly

**Files:** `contracts/src/ImageAttestor.sol`, `contracts/script/Deploy.s.sol`, `contracts/test/ImageAttestor.t.sol`, `contracts/calldata-ImageAttestor.json`, `contracts/foundry.toml`

---

## T5: Integration Testing

**Depends on: T2, T3, T4**

- [ ] End-to-end test: generate proof in dev mode → decode journal → verify fields
- [ ] Cross-check: pixel hash from host matches manual hash of output PNG
- [ ] Contract test: submit proof → verify attestation stored correctly
- [ ] Verify: journal encoding from guest matches contract's expectation

**Files:** Integration test scripts, possibly `tests/` directory

---

## T6: Frontend

**Depends on: T1 (for types), T4 (for contract ABI)**

- [ ] `frontend/app/page.tsx` — Landing page with project description
- [ ] `frontend/app/attest/page.tsx` — Attest flow:
  - Image upload (drag-and-drop)
  - Transform controls (crop, grayscale, brightness sliders)
  - Disclosure policy selector (checkboxes for date, location, camera)
  - Submit to proof generation API
  - Show proof status → relay to chain → display result
- [ ] `frontend/app/verify/page.tsx` — Verify flow:
  - Upload image
  - Decode to pixels via canvas → hash RGB bytes (NOT RGBA!)
  - Query contract `isVerified(pixelHash)`
  - Display: verified badge + disclosed metadata OR "NOT VERIFIED"
- [ ] `frontend/app/api/relay/route.ts` — Relayer API:
  - Receive seal + journal from client
  - Submit `attestImage()` tx from `RELAYER_PRIVATE_KEY`
  - Contract creates ENS subname on-chain via NameWrapper
  - Return tx hash + ENS name
- [ ] `frontend/lib/imageHash.ts` — Client-side pixel hashing:
  - Load image into canvas
  - `getImageData()` returns RGBA — extract RGB only (skip every 4th byte)
  - SHA-256 via Web Crypto API
- [ ] `frontend/lib/contracts.ts` — ABI + contract addresses
- [ ] NO wallet connection in attest flow (privacy!)

**Files:** `frontend/` directory

---

## T7: ENS + Ledger Bounties

**Depends on: T4, T6**

- [x] ENS: On-chain NameWrapper integration in attestImage()
  - Create subname: `{label}.proof-frame.eth` on-chain via NameWrapper
  - Set text records: `io.proofframe.pixelHash`, `io.proofframe.fileHash`, etc.
- [ ] Ledger: ERC-7730 Clear Signing JSON (`calldata-ImageAttestor.json`)
  - Human-readable display of attestImage() parameters on Ledger screen
  - Validate: `erc7730 lint calldata-ImageAttestor.json`

**Files:** `frontend/app/api/relay/route.ts`, `contracts/calldata-ImageAttestor.json`

---

## T8: Test Images + Scripts

**Independent — can start immediately**

- [ ] `scripts/generate-test-images.py`:
  - Generate test PNGs with synthetic EXIF data (GPS, date, camera info)
  - Multiple sizes: 320x240, 640x480, 1280x960
  - Include edge cases: no EXIF, partial EXIF, rotated
- [ ] Create `test_images/` directory with generated images
- [ ] Document test image contents in a README

**Files:** `scripts/generate-test-images.py`, `test_images/`

---

## Completed

- [x] **World ID**: Contract integration (IWorldIDGroups, per-image nullifier tracking), IDKit widget in frontend, relay route updated, ERC-7730 updated
- [x] **ENS**: On-chain subdomains via NameWrapper + text records via Public Resolver
