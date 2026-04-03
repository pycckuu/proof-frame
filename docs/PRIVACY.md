# ProofFrame Privacy Analysis

## What leaks at each layer (NOTHING should)

| Layer | Without ProofFrame | With ProofFrame |
|-------|-------------------|-----------------|
| Image file | EXIF: GPS, serial, name, thumbnail | Clean PNG: zero metadata |
| Blockchain tx | msg.sender = journalist wallet | msg.sender = shared relayer |
| ZK proof | N/A | "Some authorized key signed this" |
| World ID | N/A | Unlinkable nullifier per image |
| ENS subname | Set by journalist wallet | Set by relayer API key |

## Privacy guarantees

1. **On-chain:** `msg.sender` is the relayer address, shared across ALL users
2. **ZK proof:** Signing key is a private input — proof reveals only Merkle root
3. **World ID:** Nullifier is scoped to `(app_id, action_id)` — different per image, unlinkable
4. **ENS:** Subnames created by NameStone API (project key, not journalist wallet)
5. **Image file:** Re-encoded from decoded pixels — zero metadata survives

## Trust model for disclosed metadata

Disclosed EXIF fields (date, location, camera make) are VERIFIED by the ZK proof:
- The guest verifies the signer's ECDSA signature over the FULL file
- EXIF bytes are part of the signed file → integrity guaranteed
- You cannot forge disclosed fields without breaking the ECDSA signature
- You CAN choose to hide any field — maximum photographer control

## What each system prevents

| System | Prevents | Does NOT prevent |
|--------|----------|-----------------|
| ZK Proof | Revealing signer identity | Signing fake images |
| Merkle tree | Unauthorized signers | Authorized signer lying |
| World ID | Sybil (1000 fake identities) | One human signing one fake |
| Ledger | Key theft (secure element) | Owner signing fake content |
| Camera (production) | ALL of the above | Physical camera theft |

## Honest limitations (tell judges)

"With Ledger/software signing, this is a **reputation system** — if a journalist signs fakes,
their key gets revoked. The same ZK pipeline works with C2PA camera signatures, which upgrade
the trust from reputation to capture-level proof. Our contribution is the privacy layer."
