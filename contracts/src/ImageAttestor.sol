// SPDX-License-Identifier: MIT
pragma solidity ^0.8.24;

import {IRiscZeroVerifier} from "risc0/IRiscZeroVerifier.sol";

/// @title ImageAttestor — Permissionless ZK image attestation
/// @notice Verifies RISC Zero proofs that an image is authentic and stores attestations.
///         NO msg.sender checks. NO identity storage. The photographer is NEVER revealed.
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
    }

    /// @notice The RISC Zero verifier contract (router on Sepolia)
    IRiscZeroVerifier public immutable verifier;
    /// @notice The image ID of the ProofFrame guest program
    bytes32 public immutable imageId;

    /// @notice Attestations keyed by pixel hash
    mapping(bytes32 => Attestation) private _attestations;

    event ImageAttested(
        bytes32 indexed pixelHash,
        bytes32 fileHash,
        bytes32 merkleRoot,
        uint256 timestamp
    );

    error AlreadyAttested(bytes32 pixelHash);

    constructor(IRiscZeroVerifier _verifier, bytes32 _imageId) {
        verifier = _verifier;
        imageId = _imageId;
    }

    /// @notice Attest an image by verifying its ZK proof and storing the attestation.
    /// @dev Anyone can call this — permissionless by design. msg.sender is the relayer,
    ///      NOT the photographer. The photographer's identity is hidden inside the ZK proof.
    /// @param seal The RISC Zero proof seal (SNARK)
    /// @param journalDigest SHA-256 digest of the journal bytes
    /// @param pixelHash SHA-256 of the final RGB pixel bytes
    /// @param fileHash SHA-256 of the original signed file
    /// @param merkleRoot Root of the trust registry Merkle tree
    /// @param transformDesc Human-readable transform description
    /// @param disclosedDate Disclosed date (empty string if hidden)
    /// @param disclosedLocation Disclosed location (empty string if hidden)
    /// @param disclosedCameraMake Disclosed camera make (empty string if hidden)
    /// @param imageWidth Image width in pixels
    /// @param imageHeight Image height in pixels
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
        uint32 imageHeight
    ) external {
        // 1. Verify the ZK proof — reverts if invalid
        verifier.verify(seal, imageId, journalDigest);

        // 2. Check this pixel hash hasn't been attested before
        if (_attestations[pixelHash].timestamp != 0) {
            revert AlreadyAttested(pixelHash);
        }

        // 3. Store the attestation
        _attestations[pixelHash] = Attestation({
            fileHash: fileHash,
            merkleRoot: merkleRoot,
            transformDesc: transformDesc,
            timestamp: block.timestamp,
            disclosedDate: disclosedDate,
            disclosedLocation: disclosedLocation,
            disclosedCameraMake: disclosedCameraMake,
            imageWidth: imageWidth,
            imageHeight: imageHeight
        });

        // 4. Emit event
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
}
