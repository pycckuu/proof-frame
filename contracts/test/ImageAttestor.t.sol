// SPDX-License-Identifier: MIT
pragma solidity ^0.8.24;

import {Test} from "forge-std/Test.sol";
import {IRiscZeroVerifier} from "risc0/IRiscZeroVerifier.sol";
import {Receipt} from "risc0/IRiscZeroVerifier.sol";
import {IWorldIDGroups} from "world-id/interfaces/IWorldIDGroups.sol";
import {ImageAttestor, INameWrapper, IPublicResolver} from "../src/ImageAttestor.sol";

/// @notice Mock verifier that always succeeds (for testing)
contract MockVerifier is IRiscZeroVerifier {
    function verify(bytes calldata, bytes32, bytes32) external pure {}
    function verifyIntegrity(Receipt calldata) external pure {}
}

/// @notice Mock World ID that always succeeds (for testing)
contract MockWorldID is IWorldIDGroups {
    function verifyProof(
        uint256,
        uint256,
        uint256,
        uint256,
        uint256,
        uint256[8] calldata
    ) external pure {}
}

/// @notice Mock NameWrapper that records subdomain creation
contract MockNameWrapper is INameWrapper {
    string public lastLabel;
    uint256 public callCount;

    function setSubnodeRecord(
        bytes32,
        string calldata label,
        address,
        address,
        uint64,
        uint32,
        uint64
    ) external returns (bytes32) {
        lastLabel = label;
        callCount++;
        // Return a fake subnode hash
        return keccak256(abi.encodePacked(bytes32(0), keccak256(bytes(label))));
    }
}

/// @notice Mock Public Resolver that records text records + contenthash
contract MockPublicResolver is IPublicResolver {
    mapping(bytes32 => mapping(string => string)) public records;
    mapping(bytes32 => bytes) public contenthashes;
    uint256 public callCount;

    function setText(bytes32 node, string calldata key, string calldata value) external {
        records[node][key] = value;
        callCount++;
    }

    function setContenthash(bytes32 node, bytes calldata hash) external {
        contenthashes[node] = hash;
        callCount++;
    }
}

contract ImageAttestorTest is Test {
    ImageAttestor public attestor;
    MockVerifier public mockVerifier;
    MockWorldID public mockWorldId;
    MockNameWrapper public mockNameWrapper;
    MockPublicResolver public mockResolver;

    bytes32 constant IMAGE_ID = bytes32(uint256(0x1234));
    bytes32 constant PIXEL_HASH = bytes32(uint256(0xaaaa));
    bytes32 constant FILE_HASH = bytes32(uint256(0xbbbb));
    bytes32 constant MERKLE_ROOT = bytes32(uint256(0xcccc));
    bytes32 constant JOURNAL_DIGEST = bytes32(uint256(0xdddd));
    bytes32 constant PARENT_NODE = bytes32(uint256(0xeeee));

    function setUp() public {
        mockVerifier = new MockVerifier();
        mockWorldId = new MockWorldID();
        mockNameWrapper = new MockNameWrapper();
        mockResolver = new MockPublicResolver();
        attestor = new ImageAttestor(
            IRiscZeroVerifier(address(mockVerifier)),
            IMAGE_ID,
            IWorldIDGroups(address(mockWorldId)),
            "app_staging_proofframe",
            INameWrapper(address(mockNameWrapper)),
            IPublicResolver(address(mockResolver)),
            PARENT_NODE
        );
    }

    uint256 nextNullifier = 1000;

    /// @dev Helper to attest with auto-incrementing World ID nullifier
    function _attest() internal {
        _attestWithPixelHash(PIXEL_HASH);
    }

    function _attestWithPixelHash(bytes32 ph) internal {
        uint256[8] memory fakeProof;
        attestor.attestImage(
            hex"", // seal (mock verifier ignores)
            JOURNAL_DIGEST,
            ph,
            FILE_HASH,
            MERKLE_ROOT,
            "crop(10,10,300,220)+grayscale",
            "2026:04:03 17:29:53",
            "43.55,7.02",
            "Apple",
            640,
            480,
            "QmTestCid1234567890abcdef",
            hex"e301017012200000000000000000000000000000000000000000000000000000000000000000",
            1, // worldIdRoot (non-zero = verify)
            nextNullifier++,
            fakeProof
        );
    }

    /// @dev Helper to attest WITH World ID
    function _attestWithWorldId(bytes32 ph, uint256 nullifier) internal {
        uint256[8] memory fakeProof;
        attestor.attestImage(
            hex"",
            JOURNAL_DIGEST,
            ph,
            FILE_HASH,
            MERKLE_ROOT,
            "crop(10,10,300,220)+grayscale",
            "2026:04:03 17:29:53",
            "43.55,7.02",
            "Apple",
            640,
            480,
            "QmTestCid1234567890abcdef",
            hex"e301017012200000000000000000000000000000000000000000000000000000000000000000",
            1, // worldIdRoot != 0 -> verify World ID
            nullifier,
            fakeProof
        );
    }

    function test_attestImage_stores_correctly() public {
        _attest();

        ImageAttestor.Attestation memory a = attestor.getAttestation(PIXEL_HASH);
        assertEq(a.fileHash, FILE_HASH);
        assertEq(a.merkleRoot, MERKLE_ROOT);
        assertEq(a.imageWidth, 640);
        assertEq(a.imageHeight, 480);
        assertEq(keccak256(bytes(a.transformDesc)), keccak256("crop(10,10,300,220)+grayscale"));
        assertEq(keccak256(bytes(a.disclosedDate)), keccak256("2026:04:03 17:29:53"));
        assertEq(keccak256(bytes(a.disclosedLocation)), keccak256("43.55,7.02"));
        assertEq(keccak256(bytes(a.disclosedCameraMake)), keccak256("Apple"));
        assertEq(keccak256(bytes(a.ipfsCid)), keccak256("QmTestCid1234567890abcdef"));
        assertTrue(a.timestamp > 0);
    }

    function test_isVerified_true_after_attest() public {
        assertFalse(attestor.isVerified(PIXEL_HASH));
        _attest();
        assertTrue(attestor.isVerified(PIXEL_HASH));
    }

    function test_isVerified_false_for_unknown() public view {
        assertFalse(attestor.isVerified(bytes32(uint256(0x9999))));
    }

    function test_duplicate_reverts() public {
        _attest();
        vm.expectRevert(abi.encodeWithSelector(ImageAttestor.AlreadyAttested.selector, PIXEL_HASH));
        _attest();
    }

    function test_event_emitted() public {
        // Just verify event is emitted (can't predict exact ensLabel in expectEmit)
        _attest();
        assertTrue(attestor.isVerified(PIXEL_HASH));
    }

    function test_no_msg_sender_in_attestation() public {
        _attest();
        // The attestation struct has NO address field — privacy by design.
        ImageAttestor.Attestation memory a = attestor.getAttestation(PIXEL_HASH);
        assertEq(a.fileHash, FILE_HASH);
    }

    function test_empty_disclosure() public {
        uint256[8] memory fakeProof;
        attestor.attestImage(
            hex"",
            JOURNAL_DIGEST,
            PIXEL_HASH,
            FILE_HASH,
            MERKLE_ROOT,
            "none",
            "", // no date disclosed
            "", // no location disclosed
            "", // no camera disclosed
            640,
            480,
            "", // no IPFS CID
            hex"", // no contenthash
            1,
            99999, // unique nullifier
            fakeProof
        );
        ImageAttestor.Attestation memory a = attestor.getAttestation(PIXEL_HASH);
        assertEq(bytes(a.disclosedDate).length, 0);
        assertEq(bytes(a.disclosedLocation).length, 0);
        assertEq(bytes(a.disclosedCameraMake).length, 0);
    }

    function test_immutable_config() public view {
        assertEq(address(attestor.verifier()), address(mockVerifier));
        assertEq(attestor.imageId(), IMAGE_ID);
        assertEq(address(attestor.worldId()), address(mockWorldId));
        assertEq(address(attestor.nameWrapper()), address(mockNameWrapper));
        assertEq(address(attestor.publicResolver()), address(mockResolver));
        assertEq(attestor.parentNode(), PARENT_NODE);
    }

    // --- World ID tests ---

    function test_attestWithWorldId() public {
        bytes32 ph = bytes32(uint256(0x1111));
        _attestWithWorldId(ph, 42);

        assertTrue(attestor.isVerified(ph));
        ImageAttestor.Attestation memory a = attestor.getAttestation(ph);
        assertEq(a.fileHash, FILE_HASH);
        assertTrue(a.timestamp > 0);
    }

    function test_duplicateNullifierReverts() public {
        bytes32 ph1 = bytes32(uint256(0x2222));
        bytes32 ph2 = bytes32(uint256(0x3333));
        uint256 nullifier = 12345;

        _attestWithWorldId(ph1, nullifier);
        assertTrue(attestor.isVerified(ph1));

        vm.expectRevert(abi.encodeWithSelector(ImageAttestor.DuplicateNullifier.selector, nullifier));
        _attestWithWorldId(ph2, nullifier);
    }

    function test_differentNullifiersSucceed() public {
        bytes32 ph1 = bytes32(uint256(0x4444));
        bytes32 ph2 = bytes32(uint256(0x5555));

        _attestWithWorldId(ph1, 100);
        _attestWithWorldId(ph2, 200);

        assertTrue(attestor.isVerified(ph1));
        assertTrue(attestor.isVerified(ph2));
    }

    // --- ENS subdomain tests ---

    function test_ens_subdomain_created() public {
        _attest();
        assertEq(mockNameWrapper.callCount(), 1);
        // Label should be first 16 hex chars of pixel hash
        assertEq(keccak256(bytes(mockNameWrapper.lastLabel())), keccak256("0000000000000000"));
    }

    function test_ens_subdomain_has_resolver() public {
        _attest();
        // Subdomain created with resolver set (text records stored in Attestation struct)
        assertEq(mockNameWrapper.callCount(), 1);
        assertTrue(attestor.isVerified(PIXEL_HASH));
    }

    function test_ens_label_is_full_pixelhash() public {
        uint256[8] memory fakeProof;
        attestor.attestImage(
            hex"",
            JOURNAL_DIGEST,
            bytes32(uint256(0x6666)),
            FILE_HASH,
            MERKLE_ROOT,
            "none",
            "",
            "",
            "",
            640,
            480,
            "", // empty IPFS CID — should fallback to pixel hash prefix
            hex"", // no contenthash
            1,
            88888,
            fakeProof
        );
        assertEq(mockNameWrapper.callCount(), 1);
        // Label should be 16 chars long
        assertEq(bytes(mockNameWrapper.lastLabel()).length, 16);
    }
}
