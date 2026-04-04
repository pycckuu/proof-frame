// SPDX-License-Identifier: MIT
pragma solidity ^0.8.24;

import {IRiscZeroVerifier} from "risc0/IRiscZeroVerifier.sol";
import {IWorldIDGroups} from "world-id/interfaces/IWorldIDGroups.sol";

/// @title ImageAttestor — Permissionless ZK image attestation
/// @notice Verifies RISC Zero proofs that an image is authentic and stores attestations.
///         NO msg.sender checks. NO identity storage. The photographer is NEVER revealed.
///         World ID verification is REQUIRED — every attestation needs proof of unique human.
contract ImageAttestor {
    struct Attestation {
        bytes32 fileHash;
        bytes32 merkleRoot;
        string transformDesc;
        uint256 timestamp;
        string disclosedDate;
        string disclosedLocation;
        string disclosedCameraMake;
        uint32 imageWidth;
        uint32 imageHeight;
        string ipfsCid;
    }

    /// @notice The RISC Zero verifier contract (router on Sepolia)
    IRiscZeroVerifier public immutable verifier;
    /// @notice The image ID of the ProofFrame guest program
    bytes32 public immutable imageId;

    /// @notice The World ID router contract (optional — address(0) disables)
    IWorldIDGroups public immutable worldId;
    /// @notice Pre-computed app ID hash for World ID external nullifier
    uint256 internal immutable appIdHash;
    /// @notice World ID group ID (1 = Orb-verified)
    uint256 internal immutable groupId = 1;

    /// @notice Tracks used World ID nullifiers to prevent double-signaling
    mapping(uint256 => bool) internal nullifierUsed;

    /// @notice Attestations keyed by pixel hash
    mapping(bytes32 => Attestation) private _attestations;

    event ImageAttested(
        bytes32 indexed pixelHash,
        bytes32 fileHash,
        bytes32 merkleRoot,
        uint256 timestamp
    );

    error AlreadyAttested(bytes32 pixelHash);
    error DuplicateNullifier(uint256 nullifierHash);

    constructor(
        IRiscZeroVerifier _verifier,
        bytes32 _imageId,
        IWorldIDGroups _worldId,
        string memory _appId
    ) {
        verifier = _verifier;
        imageId = _imageId;
        worldId = _worldId;
        appIdHash = hashToField(abi.encodePacked(_appId));
    }

    /// @notice Attest an image by verifying its ZK proof and storing the attestation.
    /// @dev Anyone can call this — permissionless by design. msg.sender is the relayer,
    ///      NOT the photographer. The photographer's identity is hidden inside the ZK proof.
    ///      World ID verification is required: every attestation proves unique human.
    function attestImage(
        bytes calldata seal,
        bytes32 journalDigest,
        bytes32 pixelHash,
        bytes32 fileHash,
        bytes32 merkleRoot,
        string calldata transformDesc,
        string calldata disclosedDate,
        string calldata disclosedLocation,
        string calldata disclosedCameraMake,
        uint32 imageWidth,
        uint32 imageHeight,
        string calldata ipfsCid,
        // World ID params (required — anti-Sybil proof of personhood)
        uint256 worldIdRoot,
        uint256 worldIdNullifier,
        uint256[8] calldata worldIdProof
    ) external {
        // 1. Verify the ZK proof — reverts if invalid
        verifier.verify(seal, imageId, journalDigest);

        // 2. Verify World ID — every attestation requires proof of unique human
        //    Nullifier is scoped per-image: same human can attest different images,
        //    but cannot attest the same image twice.
        //    externalNullifier = hash(appIdHash, "attest_" + pixelHash)
        if (nullifierUsed[worldIdNullifier]) {
            revert DuplicateNullifier(worldIdNullifier);
        }
        uint256 perImageNullifier = hashToField(
            abi.encodePacked(appIdHash, "attest_", pixelHash)
        );
        worldId.verifyProof(
            worldIdRoot,
            groupId,
            hashToField(abi.encodePacked(pixelHash)),
            worldIdNullifier,
            perImageNullifier,
            worldIdProof
        );
        nullifierUsed[worldIdNullifier] = true;

        // 3. Check this pixel hash hasn't been attested before
        if (_attestations[pixelHash].timestamp != 0) {
            revert AlreadyAttested(pixelHash);
        }

        // 4. Store the attestation
        _attestations[pixelHash] = Attestation({
            fileHash: fileHash,
            merkleRoot: merkleRoot,
            transformDesc: transformDesc,
            timestamp: block.timestamp,
            disclosedDate: disclosedDate,
            disclosedLocation: disclosedLocation,
            disclosedCameraMake: disclosedCameraMake,
            imageWidth: imageWidth,
            imageHeight: imageHeight,
            ipfsCid: ipfsCid
        });

        // 5. Emit event
        emit ImageAttested(pixelHash, fileHash, merkleRoot, block.timestamp);
    }

    /// @notice Check if an image (by pixel hash) has been verified
    function isVerified(bytes32 pixelHash) external view returns (bool) {
        return _attestations[pixelHash].timestamp != 0;
    }

    /// @notice Get the full attestation for a verified image
    function getAttestation(bytes32 pixelHash) external view returns (Attestation memory) {
        return _attestations[pixelHash];
    }

    /// @notice Hash bytes to a field element (mod SNARK_SCALAR_FIELD)
    /// @dev Matches World ID's hashToField: keccak256(value) >> 8
    function hashToField(bytes memory value) internal pure returns (uint256) {
        return uint256(keccak256(value)) >> 8;
    }
}
