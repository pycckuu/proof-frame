# ProofFrame — Agent Instructions

## FIRST: Read the full architecture document

**Before doing ANYTHING, read `docs/ARCHITECTURE.md`.** It is the single source of truth for every technical decision, privacy constraint, data flow, crate version, and pitfall.

## Core Architecture

```
Photographer's device (PRIVATE):
  1. Take photo → file.png (with EXIF: GPS, date, camera)
  2. Content signing key signs SHA-256(file_bytes) — raw ECDSA, no Ethereum prefix
  3. Optional: World ID scan → proof with signal=pixelHash
  4. RISC Zero generates ZK proof (signature + key = private inputs)
  5. Sends {seal, journal, worldIdProof} to relayer API

Relayer (PUBLIC, anonymous):
  6. Backend submits attestImage() tx from relayer wallet
  7. msg.sender = relayer address (shared, NOT photographer)
  8. Calls NameStone API for gasless ENS subname

On-chain (Sepolia):
  9. Verify RISC Zero Groth16 proof (~300K gas)
  10. Optional: Verify World ID proof (~250K gas)
  11. Store attestation keyed by pixelHash
  12. NO reference to photographer's identity anywhere
```

## CRITICAL PRIVACY RULE

**The photographer's identity MUST NOT appear anywhere on-chain. Period.**

This is essential for fighting disinformation: people will only use a content authenticity
system if it doesn't expose them. Privacy enables adoption, adoption fights fakes.

- The contract MUST NOT check or store `msg.sender` as an identity
- `msg.sender` is the RELAYER, not the photographer
- The signing key is INSIDE the ZK proof (private input)
- World ID nullifier is unlinkable across attestations
- ENS subnames are set by the relayer, not the photographer
- No wallet connection in the attest flow

## Key Technical Decisions

1. **ZK Framework:** RISC Zero zkVM v3.0 — pure Rust, SHA-256/ECDSA precompiles
2. **Signature in ZK guest:** Raw ECDSA over SHA-256(file_bytes) — NO Ethereum prefix
   - Reason: Ethereum `personal_sign` uses Keccak-256 which is NOT accelerated in zkVM
3. **Image processing:** `image` crate v0.25 with `png` feature only (no JPEG)
   - PNG uses integer-only zlib inflate; JPEG DCT needs float (no FPU in riscv32im)
4. **Chain:** Ethereum Sepolia
5. **Submission:** Permissionless relayer — contract only checks proof validity
6. **ENS:** NameStone gasless subnames via CCIP-Read
7. **Trust Registry:** Local-first. MVP uses hardcoded mock keys; Chainlink CRE is optional bolt-on

## What's Optional (Not in MVP)

| Feature | Status | Notes |
|---------|--------|-------|
| **Chainlink CRE** | Optional | Trust registry uses hardcoded keys for MVP. CRE fetches keys from external registries — same interface, bolt-on later |
| **World ID** | Optional | Anti-Sybil. Contract sections commented out. Uncomment in 30 min if confirmed |
| **JPEG support** | Not planned | DCT is float-heavy. PNG only at hackathon |

## Patched Crate Versions (MANDATORY)

These exact versions are required for RISC Zero precompile acceleration:

```toml
# Guest Cargo.toml
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

**Rules:**
- `risc0-zkvm` in guest MUST have `default-features = false` (default pulls in prover code that won't compile for RISC-V)
- Pin versions with `=` to prevent Cargo resolution to incompatible versions
- `image` with `features = ["png"]` only — avoids JPEG codec

## File Structure

```
proofframe/
├── .claude/CLAUDE.md               # These instructions
├── Cargo.toml                      # Workspace: [common, methods, host]
├── common/src/lib.rs               # Transform, DisclosurePolicy, ExifFields, GuestInput, ProofOutput
├── methods/
│   ├── build.rs                    # embed_methods!() → compiles guest to ELF
│   ├── src/lib.rs                  # Exports PROOFFRAME_GUEST_ELF + _ID
│   └── guest/
│       ├── Cargo.toml              # Patched crypto crates
│       └── src/main.rs             # THE ZK GUEST PROGRAM
├── host/src/main.rs                # Mock signing, EXIF parse, Merkle tree, proof gen
├── contracts/
│   ├── foundry.toml
│   ├── src/ImageAttestor.sol       # Permissionless verifier (NO msg.sender checks)
│   ├── script/Deploy.s.sol
│   ├── test/ImageAttestor.t.sol
│   └── calldata-ImageAttestor.json # ERC-7730 Clear Signing (Ledger)
├── frontend/
│   ├── package.json                # next, wagmi, viem, namestone
│   ├── app/
│   │   ├── page.tsx                # Landing page
│   │   ├── attest/page.tsx         # Upload → configure → attest
│   │   ├── verify/page.tsx         # Upload → hash → verify
│   │   └── api/relay/route.ts      # Relayer: submit tx anonymously
│   └── lib/
│       ├── contracts.ts            # ABI + addresses
│       └── imageHash.ts            # Client-side pixel hashing (RGBA→RGB!)
├── scripts/generate-test-images.py
├── docs/TASKS.md                   # Implementation task breakdown
├── .env.example
└── docs/
    ├── ARCHITECTURE.md             # Full technical reference
    ├── DIAGRAMS.md                 # Mermaid diagrams
    └── PRIVACY.md                  # Privacy analysis
```

## Tooling

- **Frontend package manager:** Always use `bun` (not `npm` or `yarn`). Commands: `bun install`, `bun run build`, `bun run dev`, `bun add <pkg>`.

## Common Gotchas

1. **Journal encoding mismatch** — guest commits fields in order A,B,C; contract MUST encode A,B,C identically. If they differ, verification always fails.
2. **Browser pixel hashing** — `canvas.getImageData()` returns RGBA (4 bytes/pixel). Guest outputs RGB (3 bytes/pixel). Client-side hash MUST extract only RGB, skipping alpha.
3. **`risc0-zkvm`** in guest uses `default-features = false, features = ["std"]` — std is needed because `image`/`k256` deps pull in std-dependent crates.
4. **Groth16 requires x86 + Docker** — Apple Silicon cannot generate Groth16 locally. Use dev mode or Boundless.
5. **PNG orientation** — `image` crate does NOT apply EXIF Orientation tag. Phone photos may appear rotated.
6. **RISC Zero v3.0.5+** — earlier versions have a critical memory vulnerability. Always use 3.0.5+.

## Implementation Phases

### Phase 1: ZK Core (T1-T3)
Common types → Guest program → Host program → Test in dev mode

### Phase 2: Contracts + Relayer (T4)
ImageAttestor.sol → Deploy to Sepolia → Relayer API

### Phase 3: Frontend + ENS (T6-T7)
Upload UI → Transform controls → Disclosure selector → Verify flow → ENS subnames

### Phase 4: Integration + Polish (T5, T7-T8)
E2E testing → Ledger Clear Signing → Pre-compute proofs → Demo prep

## Sponsor Targets

| Sponsor | Track | Value | Integration |
|---------|-------|-------|-------------|
| Ledger | Clear Signing | $4K | ERC-7730 JSON for attestImage() |
| Ledger | AI Agents | $6K | "Ledger as content authenticator" |
| ENS | Most Creative | $5K | ZK proofs in text records + subnames |
| Chainlink | Privacy Standard | $2K | CRE workflow (OPTIONAL, bolt-on) |
| World | World ID 4.0 | $8K | CONDITIONAL — signal=pixelHash |

## Contract Addresses (Sepolia)

- RISC Zero Verifier Router: `0x925d8331ddc0a1F0d96E68CF073DFE1d92b69187`
- World ID Router: `0x469449f251692e0779667583026b5a1e99512157`
- ENS Public Resolver: `0xE99638b40E4Fff0129D56f03b55b6bbC4BBE49b5`
