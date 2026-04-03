# ProofFrame Architecture Diagrams

## 1. High-Level System Architecture

```mermaid
graph TB
    subgraph PHOTOGRAPHER["👤 Photographer's Device (PRIVATE)"]
        PHOTO[📷 Take Photo<br/>PNG with EXIF metadata]
        CONFIG[⚙️ Configure<br/>Disclosure + Transforms]
        WORLDID[🌍 World ID Scan<br/>signal = pixelHash]
    end

    subgraph PROVER["🔒 RISC Zero Proof Generation"]
        GUEST[ZK Guest Program<br/>Verify sig • Decode PNG<br/>Transform • Hash pixels<br/>Selective disclosure]
    end

    subgraph RELAY["📡 Relayer API (Anonymous)"]
        RELAYER[Next.js /api/relay<br/>msg.sender = relayer wallet<br/>NOT photographer]
    end

    subgraph CHAIN["⛓️ Ethereum Sepolia"]
        CONTRACT[ImageAttestor.sol<br/>Verify ZK proof<br/>Verify World ID<br/>Store attestation]
        ENS[ENS Text Records<br/>+ NameStone Subnames<br/>photo-001.proofframe.eth]
    end

    subgraph OUTPUT["📤 Published Outputs"]
        CLEAN[Clean PNG<br/>Zero metadata]
        ATTEST[On-chain Attestation<br/>pixelHash → metadata]
        BADGE[✅ Verification Badge]
    end

    PHOTO --> CONFIG
    CONFIG --> GUEST
    WORLDID -.->|conditional| RELAY
    GUEST -->|seal + journal| RELAY
    RELAY -->|attestImage tx| CONTRACT
    RELAY -->|NameStone API| ENS
    CONTRACT --> ATTEST
    GUEST -->|re-encode pixels| CLEAN
    ATTEST --> BADGE

    style PHOTOGRAPHER fill:#f3e8ff,stroke:#7c3aed,color:#1a1a1a
    style PROVER fill:#ede9fe,stroke:#6d28d9,color:#1a1a1a
    style RELAY fill:#fef3c7,stroke:#d97706,color:#1a1a1a
    style CHAIN fill:#dbeafe,stroke:#2563eb,color:#1a1a1a
    style OUTPUT fill:#d1fae5,stroke:#059669,color:#1a1a1a
```

---

## 2. ZK Guest Program — Internal Data Flow

```mermaid
graph LR
    subgraph PRIVATE_IN["Private Inputs (never revealed)"]
        FILE[image_bytes<br/>Full file + metadata]
        SIG[signer_signature<br/>Raw ECDSA]
        KEY[signer_pubkey<br/>33 bytes compressed]
        MERKLE[merkle_proof<br/>+ merkle_root]
        EXIF[exif_fields<br/>Parsed metadata]
        TRANS[transform<br/>Crop/Gray/Bright]
        DISC[disclosure_policy<br/>What to reveal]
    end

    subgraph OPERATIONS["Operations Inside VM"]
        HASH_FILE["SHA-256(file_bytes)<br/>⚡ 68 cyc/block"]
        VERIFY_SIG["ECDSA verify<br/>⚡ k256 precompile"]
        VERIFY_MERKLE["Merkle inclusion<br/>⚡ ~700 cycles"]
        DECODE["PNG decode → RGB pixels<br/>🛡️ Metadata firewall"]
        APPLY["Apply transforms<br/>crop → grayscale → brighten"]
        HASH_PIX["SHA-256(pixels)<br/>⚡ accelerated"]
        SELECT["Selective disclosure<br/>Conditional commit"]
    end

    subgraph PUBLIC_OUT["Public Outputs (journal)"]
        PH[pixel_hash]
        FH[file_hash]
        MR[merkle_root]
        TD[transform_desc]
        DD[disclosed_date?]
        DL[disclosed_location?]
        DC[disclosed_camera?]
    end

    FILE --> HASH_FILE
    FILE --> DECODE
    SIG --> VERIFY_SIG
    KEY --> VERIFY_SIG
    KEY --> VERIFY_MERKLE
    MERKLE --> VERIFY_MERKLE
    HASH_FILE --> VERIFY_SIG
    DECODE --> APPLY
    TRANS --> APPLY
    APPLY --> HASH_PIX
    EXIF --> SELECT
    DISC --> SELECT

    HASH_PIX --> PH
    HASH_FILE --> FH
    VERIFY_MERKLE --> MR
    APPLY --> TD
    SELECT --> DD
    SELECT --> DL
    SELECT --> DC

    style PRIVATE_IN fill:#fee2e2,stroke:#dc2626,color:#1a1a1a
    style OPERATIONS fill:#ede9fe,stroke:#7c3aed,color:#1a1a1a
    style PUBLIC_OUT fill:#d1fae5,stroke:#059669,color:#1a1a1a
```

---

## 3. Privacy Model — Two Verification Paths

```mermaid
graph TB
    subgraph PATH_A["Path A: Inside ZK Guest (Private)"]
        direction TB
        A1[Mock camera key<br/>secp256k1 raw ECDSA]
        A2["SHA-256(file_bytes)<br/>⚡ accelerated precompile"]
        A3["k256::verify(hash, sig, pk)<br/>⚡ bigint precompile"]
        A4["Merkle inclusion proof<br/>⚡ ~700 cycles"]
        A5["Groth16 proof output<br/>~192 bytes, constant size"]
        A1 --> A2 --> A3 --> A4 --> A5
    end

    subgraph PATH_B["Path B: On-Chain (Public, EVM Native)"]
        direction TB
        B1["Ledger hardware device<br/>Signs tx, Clear Signing UX"]
        B2["ecrecover<br/>Native EVM, ~3K gas"]
        B3["World ID verifyProof<br/>signal = pixelHash, ~250K gas"]
        B4["msg.sender = relayer<br/>NOT photographer"]
        B1 --> B2 --> B3 --> B4
    end

    subgraph MERGE["ImageAttestor.attestImage()"]
        C1["Verify Groth16 seal ✓<br/>~300K gas"]
        C2["Store attestation<br/>NO identity stored"]
    end

    A5 --> C1
    B4 --> C1
    C1 --> C2

    style PATH_A fill:#f3e8ff,stroke:#7c3aed,color:#1a1a1a
    style PATH_B fill:#dbeafe,stroke:#2563eb,color:#1a1a1a
    style MERGE fill:#fef3c7,stroke:#d97706,color:#1a1a1a
```

> **Key insight:** These paths NEVER cross. The ZK guest uses SHA-256 (accelerated).
> The EVM uses Keccak-256 (native). Each verification happens in its optimal environment.

---

## 4. Metadata Stripping — The Firewall

```mermaid
graph LR
    subgraph ORIGINAL["Original File (DANGEROUS)"]
        O1["📷 Pixel data"]
        O2["📍 EXIF: GPS 43.5528°N 7.0174°E"]
        O3["🔢 Serial: LM11P-004729"]
        O4["👤 Creator: John Smith"]
        O5["📅 Date: 2026-04-04 14:30"]
        O6["📝 XMP: Edit history"]
        O7["🔐 C2PA: X.509 cert chain"]
        O8["🖼️ Thumbnail: uncropped face"]
        O9["🎨 ICC: device profile"]
    end

    DECODE["image::load_from_memory()<br/>→ to_rgb8()<br/><br/>🛡️ ONLY pixel buffer output<br/>ALL metadata discarded<br/>by construction"]

    subgraph CLEAN["Published File (SAFE)"]
        C1["📷 Pixel data only"]
        C2["❌ No EXIF"]
        C3["❌ No serial"]
        C4["❌ No creator"]
        C5["❌ No XMP"]
        C6["❌ No C2PA"]
        C7["❌ No thumbnail"]
        C8["❌ No ICC"]
    end

    O1 --> DECODE
    O2 --> DECODE
    O3 --> DECODE
    O4 --> DECODE
    O5 --> DECODE
    O6 --> DECODE
    O7 --> DECODE
    O8 --> DECODE
    O9 --> DECODE

    DECODE --> C1

    style ORIGINAL fill:#fee2e2,stroke:#dc2626,color:#1a1a1a
    style DECODE fill:#ede9fe,stroke:#7c3aed,color:#1a1a1a
    style CLEAN fill:#d1fae5,stroke:#059669,color:#1a1a1a
```

---

## 5. Selective Disclosure Scenarios

```mermaid
graph TB
    subgraph PHOTOGRAPHER["Photographer chooses per image"]
        WAR["🪖 War Correspondent"]
        INS["🏠 Insurance Claim"]
        WHIST["🕵️ Whistleblower"]
        NEWS["📰 News Agency"]
    end

    subgraph DISCLOSURE["What gets disclosed"]
        D_WAR["✅ Date<br/>✅ Location: City only<br/>❌ Camera make<br/>✅ Dimensions"]
        D_INS["✅ Date<br/>✅ Location: Exact GPS<br/>✅ Camera make<br/>✅ Dimensions"]
        D_WHIST["❌ Date<br/>❌ Location<br/>❌ Camera make<br/>❌ Dimensions<br/>Only pixel hash"]
        D_NEWS["✅ Date<br/>✅ Location: Exact GPS<br/>✅ Camera make<br/>✅ Dimensions"]
    end

    WAR --> D_WAR
    INS --> D_INS
    WHIST --> D_WHIST
    NEWS --> D_NEWS

    style PHOTOGRAPHER fill:#f3e8ff,stroke:#7c3aed,color:#1a1a1a
    style DISCLOSURE fill:#dbeafe,stroke:#2563eb,color:#1a1a1a
```

---

## 6. Trust Levels — Honest Assessment

```mermaid
graph LR
    subgraph L1["Level 1: Hackathon"]
        L1S["Mock software key<br/>signs file hash"]
        L1P["Proves: registered signer<br/>committed to this image"]
        L1T["Trust: REPUTATION<br/>Revoke key if signer attests fakes"]
    end

    subgraph L2["Level 2: Production"]
        L2S["Ledger hardware key<br/>in secure element"]
        L2P["Proves: hardware device<br/>approved this content"]
        L2T["Trust: KEY THEFT RESISTANCE<br/>Can't extract key remotely"]
    end

    subgraph L3["Level 3: Full C2PA"]
        L3S["Camera factory key<br/>Leica/Sony/Nikon"]
        L3P["Proves: authorized camera<br/>CAPTURED this image"]
        L3T["Trust: CAPTURE PROOF<br/>Photographer never touches key"]
    end

    L1 -->|"upgrade path"| L2
    L2 -->|"upgrade path"| L3

    style L1 fill:#fef3c7,stroke:#d97706,color:#1a1a1a
    style L2 fill:#dbeafe,stroke:#2563eb,color:#1a1a1a
    style L3 fill:#d1fae5,stroke:#059669,color:#1a1a1a
```

> **Same ZK pipeline at all 3 levels.** Only the signing key changes.
> ProofFrame's contribution is the privacy layer that works at every trust level.

---

## 7. Relayer Pattern — Why msg.sender is Irrelevant

```mermaid
sequenceDiagram
    participant J as 👤 Photographer
    participant F as 🌐 Frontend
    participant R as 📡 Relayer API
    participant C as ⛓️ Contract
    participant N as 📛 NameStone

    J->>F: Upload photo + config
    F->>F: Generate ZK proof locally
    Note over F: Proof generation happens<br/>on photographer's device or<br/>ProofFrame server

    opt World ID enabled
        J->>F: World ID scan (QR)
        F->>F: Receive WID proof
    end

    F->>R: POST {seal, journal, worldIdProof}
    Note over F,R: HTTPS only — photographer's<br/>wallet NEVER involved

    R->>C: attestImage(pixelHash, seal, ...)
    Note over R,C: msg.sender = 0xRelayer<br/>shared across ALL users

    C->>C: verifier.verify(seal, imageId, journalDigest)
    Note over C: Only checks: is the<br/>ZK proof valid?

    opt World ID
        C->>C: worldId.verifyProof(root, signal, nullifier, proof)
    end

    C->>C: Store attestation (NO identity)

    R->>N: Create subname via API
    Note over R,N: Project-level API key<br/>No photographer wallet

    R->>F: {txHash, ensName}
    F->>J: Show result + clean PNG download
```

---

## 8. Sponsor Integration Map

```mermaid
graph TB
    subgraph CORE["ProofFrame Core"]
        ZK["RISC Zero zkVM<br/>ZK proof generation"]
        CONTRACT["ImageAttestor.sol<br/>Permissionless verifier"]
    end

    subgraph LEDGER["🔐 Ledger ($10K pool)"]
        LED_CS["Clear Signing JSON<br/>ERC-7730 descriptor<br/>→ $4K track"]
        LED_AI["Content authenticator<br/>narrative<br/>→ $6K AI Agents track"]
    end

    subgraph ENS_S["📛 ENS ($10K pool)"]
        ENS_TR["Text records<br/>io.proofframe.proof<br/>io.proofframe.date"]
        ENS_SUB["Gasless subnames<br/>photo-001.proofframe.eth<br/>via NameStone + CCIP-Read"]
        ENS_NOTE["'Most Creative' track<br/>literally asks for<br/>'ZK proofs in text records'"]
    end

    subgraph CL["🔗 Chainlink ($7K pool)"]
        CRE["CRE Workflow<br/>Confidential HTTP<br/>Trust registry fetch"]
    end

    subgraph WID["🌍 World ID ($20K pool)"]
        WID_P["signal = pixelHash<br/>Anti-Sybil per image<br/>CONDITIONAL on Mateo"]
    end

    ZK --> CONTRACT
    CONTRACT --> LED_CS
    CONTRACT --> ENS_TR
    CONTRACT --> ENS_SUB
    ZK --> CRE
    CONTRACT --> WID_P

    style CORE fill:#ede9fe,stroke:#7c3aed,color:#1a1a1a
    style LEDGER fill:#dbeafe,stroke:#2563eb,color:#1a1a1a
    style ENS_S fill:#d1fae5,stroke:#059669,color:#1a1a1a
    style CL fill:#f3f4f6,stroke:#6b7280,color:#1a1a1a
    style WID fill:#fef3c7,stroke:#d97706,color:#1a1a1a
```

---

## 9. Verification Flow (Anyone Can Verify)

```mermaid
sequenceDiagram
    participant U as 🔍 Verifier
    participant B as 🌐 Browser
    participant C as ⛓️ Contract
    participant E as 📛 ENS

    U->>B: Upload image OR enter ENS name

    alt Upload image
        B->>B: Decode PNG → RGB pixels
        B->>B: SHA-256(pixels) → pixelHash
        B->>C: isVerified(pixelHash)
    else Enter ENS name
        B->>E: Resolve photo-001.proofframe.eth
        E->>B: Text record: io.proofframe.proof = pixelHash
        B->>C: isVerified(pixelHash)
    end

    alt Verified ✅
        C->>B: {exists: true, timestamp, transformDesc}
        B->>C: getAttestation(pixelHash)
        C->>B: {disclosedDate, disclosedLocation, disclosedCameraMake}
        B->>U: ✅ VERIFIED<br/>Date: 2026-04-04<br/>Location: Cannes, France<br/>Transforms: crop+grayscale
    else Not Found ❌
        C->>B: {exists: false}
        B->>U: ❌ NO ATTESTATION FOUND
    end
```

---

## 10. Performance Budget

```mermaid
pie title Cycle Distribution (640×480 PNG, crop+grayscale)
    "PNG decode" : 55
    "ECDSA verify" : 15
    "SHA-256 (file)" : 5
    "SHA-256 (pixels)" : 3
    "Crop transform" : 5
    "Grayscale" : 10
    "Merkle verify" : 1
    "Page-in overhead" : 6
```

| Component | Cycles | Time (GPU) |
|-----------|--------|------------|
| Total (~30M cycles) | ~15-55M | ~30-90s on RTX 4090 |
| Dev mode | N/A | ~2s (fake proof) |
| On-chain verify | ~300K gas | ~$0.40 at 30 gwei |

---

## 11. Repository Structure

```mermaid
graph TB
    subgraph ROOT["proofframe/"]
        CLAUDE[".claude/CLAUDE.md<br/>Agent instructions"]
        TASKS["TASKS.md<br/>Implementation checklist"]
        README["README.md"]
    end

    subgraph RUST["Rust Workspace"]
        COMMON["common/src/lib.rs<br/>Shared types"]
        GUEST["methods/guest/src/main.rs<br/>⭐ THE ZK GUEST"]
        HOST["host/src/main.rs<br/>Proof generation"]
        METHODS["methods/<br/>build.rs + lib.rs"]
    end

    subgraph SOL["Contracts"]
        ATTEST["contracts/src/<br/>ImageAttestor.sol"]
        CLEAR["contracts/<br/>calldata-ImageAttestor.json<br/>ERC-7730 Clear Signing"]
    end

    subgraph FRONT["Frontend"]
        RELAY_API["app/api/relay/route.ts<br/>🔑 Privacy-critical relayer"]
        LIB["lib/<br/>contracts.ts<br/>imageHash.ts"]
        PAGES["app/<br/>attest/ + verify/"]
    end

    subgraph DOCS["Documentation"]
        ARCH["docs/FULL_ARCHITECTURE.md<br/>📖 Single source of truth"]
        PRIV["docs/PRIVACY.md"]
    end

    ROOT --> RUST
    ROOT --> SOL
    ROOT --> FRONT
    ROOT --> DOCS

    COMMON --> GUEST
    COMMON --> HOST
    METHODS --> GUEST

    style ROOT fill:#f3f4f6,stroke:#6b7280,color:#1a1a1a
    style RUST fill:#ede9fe,stroke:#7c3aed,color:#1a1a1a
    style SOL fill:#dbeafe,stroke:#2563eb,color:#1a1a1a
    style FRONT fill:#fef3c7,stroke:#d97706,color:#1a1a1a
    style DOCS fill:#d1fae5,stroke:#059669,color:#1a1a1a
```

---

## 12. Build Timeline (36 Hours)

```mermaid
gantt
    title ProofFrame Hackathon Build Plan
    dateFormat HH:mm
    axisFormat %H:%M

    section Phase 1: ZK Core
    Setup + compilation test    :crit, p1a, 00:00, 2h
    Guest program              :crit, p1b, after p1a, 4h
    Host program + e2e test    :p1c, after p1b, 2h

    section Phase 2: Chain
    Deploy contracts           :p2a, after p1c, 2h
    World ID decision          :milestone, m1, after p1c, 0h
    Ledger + World ID          :p2b, after p2a, 4h

    section Phase 3: Frontend
    ENS integration            :p3a, after p2b, 2h
    Upload + verify UI         :p3b, after p3a, 4h

    section Phase 4: Polish
    Chainlink CRE              :p4a, after p3b, 2h
    Clear Signing JSON         :p4b, after p4a, 1h
    Pre-compute proofs         :crit, p4c, after p4b, 3h

    section Phase 5: Demo
    Sleep                      :done, sleep, after p4c, 4h
    Record demo video          :p5a, after sleep, 2h
    README + submit            :p5b, after p5a, 2h
    Sponsor booths             :crit, p5c, after p5b, 4h
```

---

## 13. Contingency Decision Tree

```mermaid
graph TB
    START["Hours behind<br/>schedule?"]

    START -->|"2h behind<br/>at Phase 2"| CUT1["Cut: EXIF in VM<br/>→ Parse on host only"]
    START -->|"3h behind<br/>at Phase 3"| CUT2["Cut: NameStone subnames<br/>→ Plain text records"]
    START -->|"5h behind<br/>at Phase 3"| CUT3["Cut: Chainlink CRE<br/>Lose: $2K bounty"]
    START -->|"6h behind<br/>at Phase 3"| CUT4["Cut: World ID<br/>Lose: $8K bounty"]
    START -->|"8h+ behind<br/>at Phase 4"| CUT5["Cut: Real proofs<br/>→ Dev-mode only"]
    START -->|"Nuclear"| CUT6["Cut: Transforms<br/>→ Hash-only verification"]

    CUT1 --> SAFE["✅ Project still works"]
    CUT2 --> SAFE
    CUT3 --> SAFE
    CUT4 --> SAFE
    CUT5 --> SAFE
    CUT6 --> SAFE

    NEVER["🚫 NEVER CUT:<br/>• RISC Zero core proof<br/>• Permissionless relayer<br/>• ENS text records<br/>• Demo video"]

    style START fill:#fef3c7,stroke:#d97706,color:#1a1a1a
    style SAFE fill:#d1fae5,stroke:#059669,color:#1a1a1a
    style NEVER fill:#fee2e2,stroke:#dc2626,color:#1a1a1a
```
