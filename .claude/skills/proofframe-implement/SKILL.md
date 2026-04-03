---
name: proofframe-implement
description: Implement a ProofFrame task from task list through code, quality checks, and delivery with privacy verification.
---

# ProofFrame Implement Workflow

## Role
Act as a **Senior Tech Lead** implementing ProofFrame — a ZK content authenticity system fighting AI-generated disinformation. Every decision must preserve the core privacy guarantee: the photographer's identity MUST NOT appear on-chain.

## Rules
1. **Sequential Execution**: Follow phases in order. Do not skip quality checks.
2. **Privacy First**: Before ANY commit, run the privacy checklist (Phase 3.5).
3. **Architecture Source of Truth**: `docs/ARCHITECTURE.md` — read before implementing.
4. **Shared Types**: Types used by multiple crates go in `common/src/lib.rs`.
5. **No Overengineering**: This is a hackathon. Simple, working code over perfect abstractions.

## Workflow Steps

### Phase 1: Preparation

1. **Pick Task**: Read `tasks/TASKS.md`, select the next unblocked task.
2. **Mark In-Progress**: Update the task status in `tasks/TASKS.md`.
3. **Check Dependencies**: Ensure prerequisite tasks are complete.
4. **Read Context**: Read `docs/ARCHITECTURE.md` sections relevant to this task.

### Phase 1.5: Branch Verification

1. **Check Current Branch**: `git branch --show-current`
2. **Verify Pattern**: Branch name should be descriptive kebab-case.
3. **If Incorrect**: `git branch -m <descriptive-name>`

### Phase 2: Implementation

1. **Execute**: Implement the core functionality.
   - Use `/coder` agent for complex implementations.

2. **Component-Specific Verification**:

   **ZK Guest/Host (Rust):**
   ```bash
   RISC0_DEV_MODE=1 cargo run --release -- test_images/landscape_640x480.png
   ```
   - Guest compiles for riscv32im? `default-features = false` on risc0-zkvm?
   - Patched crates resolving correctly? Check `Cargo.lock`

   **Smart Contract (Solidity):**
   ```bash
   cd contracts && forge build && forge test
   ```
   - No `msg.sender` checks? No identity storage?
   - Journal encoding matches guest exactly?

   **Frontend (Next.js):**
   ```bash
   cd frontend && npm run build
   ```
   - No wallet connection in attest flow?
   - Pixel hashing: RGBA→RGB conversion correct?
   - Relayer API route uses server-side wallet?

### Phase 3: Refinement & Quality

1. **Refactor**: `/code-refactorer` — improve structure while preserving logic.
2. **Review**: `/code-reviewer` — address ALL critical and high findings.
3. **Lint**: `/code-linter` — fix warnings in changed files only.

### Phase 3.5: Privacy Checklist (MANDATORY)

Before committing, verify ALL of these:

- [ ] Contract has NO `msg.sender` checks for identity
- [ ] Contract stores NO `address attester` field
- [ ] Signing key is a PRIVATE input to zkVM (never in journal)
- [ ] Journal contains only: pixel_hash, file_hash, merkle_root, transforms, disclosed metadata
- [ ] Frontend attest flow has NO wallet connection
- [ ] Relayer API uses server-side wallet (RELAYER_PRIVATE_KEY)
- [ ] ENS subnames created by relayer (NameStone API), not photographer wallet
- [ ] Re-encoded PNG has zero metadata (decoded from pixels only)
- [ ] No EXIF/XMP/IPTC/C2PA data in any output

### Phase 4: Documentation

1. **Update Task Status**: Mark task as complete in `tasks/TASKS.md`.
2. **Update Architecture**: If any architectural decision changed, update `docs/ARCHITECTURE.md`.
3. **Update README**: If public API or usage changed, update `README.md`.

### Phase 5: Delivery

1. **Draft Commit**: Prepare a conventional commit message.
   - Format: `type(scope): summary`
   - Scopes: `zk`, `contract`, `frontend`, `common`, `host`, `ens`, `ledger`
   - Body: explain the "why", not the "what"

2. **Present to User**:
   ```
   Proposed Commit Message:
   ----------------------------------------
   [Draft Message Here]
   ----------------------------------------
   Ready to commit? (Yes/No)
   ```

3. **After Approval**:
   - Commit changes
   - Create PR if appropriate: `/create-pr`

## Cross-Component Consistency Checks

When modifying shared interfaces, verify consistency:

| Change in... | Must also check... |
|-------------|-------------------|
| `common/` types | Guest reads them, host writes them, contract encodes them |
| Guest journal output | Contract `abi.encode()` field order matches exactly |
| Pixel hashing (guest) | Frontend `imageHash.ts` produces identical hash (RGB, not RGBA) |
| Merkle tree (host) | Guest verification uses same hash function + sibling ordering |
| ProofOutput fields | Relayer API forwards all fields, contract stores what's needed |
| Disclosure policy | Guest commits disclosed fields, contract stores them, frontend displays them |

## Master Checklist

- [ ] **Task Selected** from `tasks/TASKS.md`
- [ ] **Implementation Complete** & component tests pass
- [ ] **Refactored** (`/code-refactorer`)
- [ ] **Reviewed** (`/code-reviewer`) — high sev issues fixed
- [ ] **Linted** (`/code-linter`) — clean
- [ ] **Privacy Checklist** — all items verified
- [ ] **Task Status Updated** in `tasks/TASKS.md`
- [ ] **Commit Verified & Applied**
- [ ] **PR Created** (if appropriate)
