---
name: proofframe-plan
description: Plan a ProofFrame task using multi-perspective analysis with privacy, ZK safety, and cross-component integration lenses.
---

# ProofFrame Plan Workflow

## PART 1: ANALYSIS

### Phase 0: Context Gathering

Before analyzing, gather ProofFrame-specific context:

1. **Read the source of truth**: `docs/ARCHITECTURE.md` — covers every decision, constraint, and pitfall
2. **Critical privacy rule**: The photographer's identity MUST NOT appear anywhere on-chain
3. **Project structure**: `tree -L 3 -I 'target|node_modules|out|cache'`
4. **Workspace layout**: `cat Cargo.toml` (members: common, methods, host)
5. **Recent commits**: `git log --oneline -20`
6. **Search for patterns**: `rg "relevant_keyword" --type rust` or `--type ts`
7. **Check shared types**: `cat common/src/lib.rs` — Transform, DisclosurePolicy, GuestInput, ProofOutput
8. **Task status**: `cat docs/TASKS.md` — what's done, what's in progress

### Phase 1: Repository Comprehension

Map the ProofFrame module boundaries:

| Crate/Module | Purpose | Compiles for |
|-------------|---------|-------------|
| `common/` | Shared types + testable logic (parsing, disclosure, Merkle) | Both native + riscv32im |
| `methods/guest/` | ZK guest program (runs inside zkVM) | riscv32im-risc0-zkvm-elf |
| `methods/` | Build script, exports ELF + IMAGE_ID | Native only |
| `host/` | Proof generation, mock signing, EXIF parsing | Native only |
| `contracts/` | Solidity (Foundry) | EVM |
| `frontend/` | Next.js (TypeScript) | Browser + Node |

**Data flow trace:**
```
Photographer device → [image_bytes + config]
  → Host (sign, build Merkle tree, parse EXIF)
    → Guest (verify sig, Merkle, decode PNG, transform, hash, disclose)
      → Journal (pixel_hash, file_hash, merkle_root, transforms, disclosed metadata)
        → Relayer API → Contract (verify proof, store attestation)
          → Verifier (upload image, hash pixels, check contract)
```

**Key conventions:**
- Raw ECDSA over SHA-256 (not Ethereum personal_sign)
- PNG only (no JPEG — DCT needs float, no FPU in riscv32im)
- Permissionless relayer (no msg.sender checks in contract)
- Patched crates for RISC Zero precompiles (sha2, k256, crypto-bigint)
- Local trust registry for MVP (hardcoded mock keys, not Chainlink CRE)

### Phase 2: Multi-Perspective Analysis

#### Architect Lens
- Which crate/module owns this functionality?
- Does it cross the guest/host boundary? (If so, shared types go in `common/`)
- Does the contract need to know about this? (Journal encoding must match)
- Are there existing patterns in the codebase to follow?

#### Privacy Lens
- Does this expose the photographer's identity at ANY layer?
- Does it leak metadata (EXIF, GPS, camera serial, etc.)?
- Does it add `msg.sender` checks or identity storage to the contract?
- Could the relayer pattern be compromised by this change?
- Does the frontend connect a wallet in the attest flow?

#### ZK Safety Lens
- What's the cycle budget impact? (Budget: ~15-55M total for 640x480)
- Does the code compile for `riscv32im`? (No threads, no FPU, no filesystem)
- Are crypto operations using accelerated precompiles? (patched sha2, k256)
- `risc0-zkvm` in guest uses `default-features = false, features = ["std"]`
- Does the `image` crate stay at `features = ["png"]` only?

#### Integration Lens
- Does journal encoding match between guest `env::commit()` and contract `abi.encode()`?
- Does pixel hashing match between guest (RGB) and frontend (RGBA → must extract RGB)?
- Do shared types in `common/` cover this use case?
- Is the Merkle proof format consistent between host (builder) and guest (verifier)?

### Phase 3: Solution Exploration

Generate 2-3 approaches with:

| Approach | Core Idea | Pros | Cons | Cycle Cost | Privacy Risk |
|----------|-----------|------|------|------------|-------------|
| | | | | | |

Include for each:
- New types/traits introduced (add to `common/` if shared)
- Crates to add (check riscv32im compatibility if guest-side)
- Files touched
- **Tests needed**: what functions go in `common/` for native testing, what test cases to cover
- ProofFrame-specific risks (precompile availability, metadata leakage, journal mismatch)

### Phase 4: Recommendation

Output a single actionable plan:

1. **Chosen Approach**: One-paragraph justification
2. **Implementation Steps**: Ordered, with specific file paths
3. **Type Signatures**: Key new `struct`, `enum`, `fn` signatures (put shared types in `common/`)
4. **Testing Plan**:
   - What logic moves to `common/` for native testing
   - Specific test cases to write (happy path, edge cases, error cases)
   - Run: `cargo test -p proofframe-common`
5. **Acceptance Criteria**:
   - ZK: `cargo build -p proofframe-methods` + `cargo test -p proofframe-common`
   - Contracts: `forge build && forge test`
   - Frontend: `bun run build`
   - Privacy: no identity leaks at any layer
6. **Risks & Mitigations**
