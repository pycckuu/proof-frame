// SPDX-License-Identifier: MIT
pragma solidity ^0.8.24;

import {IRiscZeroVerifier} from "risc0/IRiscZeroVerifier.sol";
import {IWorldIDGroups} from "world-id/interfaces/IWorldIDGroups.sol";

/// @notice Minimal NameWrapper interface for creating subnames
interface INameWrapper {
    function setSubnodeRecord(
        bytes32 parentNode,
        string calldata label,
        address owner,
        address resolver,
        uint64 ttl,
        uint32 fuses,
        uint64 expiry
    ) external returns (bytes32);
}

/// @notice Minimal Public Resolver interface for setting text records + contenthash
interface IPublicResolver {
    function setText(bytes32 node, string calldata key, string calldata value) external;
    function setContenthash(bytes32 node, bytes calldata hash) external;
}

/// @title ImageAttestor — Permissionless ZK image attestation with on-chain ENS subdomains
/// @notice Verifies RISC Zero proofs that an image is authentic, stores attestations,
///         and creates ENS subnames under the parent domain.
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

    /// @notice The World ID router contract
    IWorldIDGroups public immutable worldId;
    /// @notice Pre-computed app ID hash for World ID external nullifier
    uint256 internal immutable appIdHash;
    /// @notice World ID group ID (1 = Orb-verified)
    uint256 internal immutable groupId = 1;

    /// @notice ENS NameWrapper for creating subdomains
    INameWrapper public immutable nameWrapper;
    /// @notice ENS Public Resolver for setting text records
    IPublicResolver public immutable publicResolver;
    /// @notice Namehash of parent domain (e.g. proof-frame.eth)
    bytes32 public immutable parentNode;

    /// @notice Tracks used World ID nullifiers to prevent double-signaling
    mapping(uint256 => bool) internal nullifierUsed;

    /// @notice Attestations keyed by pixel hash
    mapping(bytes32 => Attestation) private _attestations;

    event ImageAttested(
        bytes32 indexed pixelHash,
        bytes32 fileHash,
        bytes32 merkleRoot,
        uint256 timestamp,
        string ensSubname
    );

    error AlreadyAttested(bytes32 pixelHash);
    error DuplicateNullifier(uint256 nullifierHash);

    constructor(
        IRiscZeroVerifier _verifier,
        bytes32 _imageId,
        IWorldIDGroups _worldId,
        string memory _appId,
        INameWrapper _nameWrapper,
        IPublicResolver _publicResolver,
        bytes32 _parentNode
    ) {
        verifier = _verifier;
        imageId = _imageId;
        worldId = _worldId;
        appIdHash = hashToField(abi.encodePacked(_appId));
        nameWrapper = _nameWrapper;
        publicResolver = _publicResolver;
        parentNode = _parentNode;
    }

    /// @notice Attest an image by verifying its ZK proof, storing the attestation,
    ///         and creating an ENS subdomain with attestation metadata.
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
        bytes calldata ipfsContenthash,
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

        // 5. Create ENS subdomain + set text records (if NameWrapper is configured)
        string memory ensLabel = _buildLabel(ipfsCid, pixelHash);
        if (address(nameWrapper) != address(0)) {
            // Create subname: {label}.proof-frame.eth owned by this contract
            nameWrapper.setSubnodeRecord(
                parentNode,
                ensLabel,
                address(this),
                address(publicResolver),
                0, // ttl
                0, // fuses
                type(uint64).max // no expiry
            );

            // Compute subnode hash for text record calls
            bytes32 subnode = keccak256(abi.encodePacked(parentNode, keccak256(bytes(ensLabel))));

            // Set ENS text records (Public Resolver checks NameWrapper.ownerOf for auth)
            publicResolver.setText(subnode, "io.proofframe.pixelHash", _bytes32ToHex(pixelHash));
            publicResolver.setText(subnode, "io.proofframe.fileHash", _bytes32ToHex(fileHash));
            publicResolver.setText(subnode, "io.proofframe.merkleRoot", _bytes32ToHex(merkleRoot));
            publicResolver.setText(subnode, "io.proofframe.transforms", transformDesc);
            publicResolver.setText(subnode, "io.proofframe.dimensions", string(abi.encodePacked(_uint32ToString(imageWidth), "x", _uint32ToString(imageHeight))));
            if (bytes(ipfsCid).length > 0) {
                publicResolver.setText(subnode, "io.proofframe.ipfsCid", ipfsCid);
                publicResolver.setText(subnode, "url", string(abi.encodePacked("https://ipfs.io/ipfs/", ipfsCid)));
                publicResolver.setText(subnode, "avatar", string(abi.encodePacked("ipfs://", ipfsCid, "/image.png")));
                if (ipfsContenthash.length > 0) {
                    publicResolver.setContenthash(subnode, ipfsContenthash);
                }
            }
            if (bytes(disclosedDate).length > 0) {
                publicResolver.setText(subnode, "io.proofframe.date", disclosedDate);
            }
            if (bytes(disclosedLocation).length > 0) {
                publicResolver.setText(subnode, "io.proofframe.location", disclosedLocation);
            }
            if (bytes(disclosedCameraMake).length > 0) {
                publicResolver.setText(subnode, "io.proofframe.camera", disclosedCameraMake);
            }
        }

        // 6. Emit event
        emit ImageAttested(pixelHash, fileHash, merkleRoot, block.timestamp, ensLabel);
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

    /// @dev Build ENS label from IPFS CID (first 16 chars) or pixel hash prefix
    ///      Always lowercased — ENS normalizes labels to lowercase (UTS-46)
    function _buildLabel(string calldata ipfsCid, bytes32 pixelHash) internal pure returns (string memory) {
        if (bytes(ipfsCid).length >= 16) {
            bytes memory label = new bytes(16);
            for (uint i = 0; i < 16; i++) {
                label[i] = _toLower(bytes(ipfsCid)[i]);
            }
            return string(label);
        }
        // Fallback: first 16 hex chars of pixel hash (already lowercase)
        return _bytes32ToHex16(pixelHash);
    }

    /// @dev Convert ASCII uppercase to lowercase
    function _toLower(bytes1 b) internal pure returns (bytes1) {
        if (b >= 0x41 && b <= 0x5A) return bytes1(uint8(b) + 32);
        return b;
    }

    /// @dev Convert bytes32 to full hex string (without 0x prefix)
    function _bytes32ToHex(bytes32 data) internal pure returns (string memory) {
        bytes memory hexChars = "0123456789abcdef";
        bytes memory result = new bytes(66); // "0x" + 64 hex chars
        result[0] = "0";
        result[1] = "x";
        for (uint i = 0; i < 32; i++) {
            result[2 + i * 2] = hexChars[uint8(data[i]) >> 4];
            result[3 + i * 2] = hexChars[uint8(data[i]) & 0x0f];
        }
        return string(result);
    }

    /// @dev Convert first 8 bytes of bytes32 to 16-char hex string
    function _bytes32ToHex16(bytes32 data) internal pure returns (string memory) {
        bytes memory hexChars = "0123456789abcdef";
        bytes memory result = new bytes(16);
        for (uint i = 0; i < 8; i++) {
            result[i * 2] = hexChars[uint8(data[i]) >> 4];
            result[i * 2 + 1] = hexChars[uint8(data[i]) & 0x0f];
        }
        return string(result);
    }

    /// @dev Convert uint32 to decimal string
    function _uint32ToString(uint32 value) internal pure returns (string memory) {
        if (value == 0) return "0";
        uint32 temp = value;
        uint256 digits;
        while (temp != 0) { digits++; temp /= 10; }
        bytes memory buffer = new bytes(digits);
        while (value != 0) {
            digits--;
            buffer[digits] = bytes1(uint8(48 + value % 10));
            value /= 10;
        }
        return string(buffer);
    }

    /// @dev ERC-1155 receiver (required by NameWrapper)
    function onERC1155Received(address, address, uint256, uint256, bytes calldata) external pure returns (bytes4) {
        return this.onERC1155Received.selector;
    }

    function onERC1155BatchReceived(address, address, uint256[] calldata, uint256[] calldata, bytes calldata) external pure returns (bytes4) {
        return this.onERC1155BatchReceived.selector;
    }

    function supportsInterface(bytes4 interfaceId) external pure returns (bool) {
        return interfaceId == 0x01ffc9a7 || // ERC-165
               interfaceId == 0x4e2312e0;   // ERC-1155 Receiver
    }
}
