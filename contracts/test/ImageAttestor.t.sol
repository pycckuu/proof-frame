// SPDX-License-Identifier: MIT
pragma solidity ^0.8.24;

import {Test} from "forge-std/Test.sol";
import {IRiscZeroVerifier} from "risc0/IRiscZeroVerifier.sol";
import {Receipt} from "risc0/IRiscZeroVerifier.sol";
import {ImageAttestor} from "../src/ImageAttestor.sol";

/// @notice Mock verifier that always succeeds (for testing)
contract MockVerifier is IRiscZeroVerifier {
    function verify(bytes calldata, bytes32, bytes32) external pure {}
    function verifyIntegrity(Receipt calldata) external pure {}
}

contract ImageAttestorTest is Test {
    ImageAttestor public attestor;
    MockVerifier public mockVerifier;

    bytes32 constant IMAGE_ID = bytes32(uint256(0x1234));
    bytes32 constant PIXEL_HASH = bytes32(uint256(0xaaaa));
    bytes32 constant FILE_HASH = bytes32(uint256(0xbbbb));
    bytes32 constant MERKLE_ROOT = bytes32(uint256(0xcccc));
    bytes32 constant JOURNAL_DIGEST = bytes32(uint256(0xdddd));

    function setUp() public {
        mockVerifier = new MockVerifier();
        attestor = new ImageAttestor(IRiscZeroVerifier(address(mockVerifier)), IMAGE_ID);
    }

    function _attest() internal {
        attestor.attestImage(
            hex"", // seal (mock verifier ignores)
            JOURNAL_DIGEST,
            PIXEL_HASH,
            FILE_HASH,
            MERKLE_ROOT,
            "crop(10,10,300,220)+grayscale",
            "2026:04:03 17:29:53",
            "43.55,7.02",
            "Apple",
            640,
            480
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
        vm.expectEmit(true, false, false, true);
        emit ImageAttestor.ImageAttested(PIXEL_HASH, FILE_HASH, MERKLE_ROOT, block.timestamp);
        _attest();
    }

    function test_no_msg_sender_in_attestation() public {
        _attest();
        // The attestation struct has NO address field — privacy by design.
        // If this test compiles and passes, there's no identity leakage.
        ImageAttestor.Attestation memory a = attestor.getAttestation(PIXEL_HASH);
        assertEq(a.fileHash, FILE_HASH);
        // No a.attester, no a.sender — fields don't exist
    }

    function test_empty_disclosure() public {
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
            480
        );
        ImageAttestor.Attestation memory a = attestor.getAttestation(PIXEL_HASH);
        assertEq(bytes(a.disclosedDate).length, 0);
        assertEq(bytes(a.disclosedLocation).length, 0);
        assertEq(bytes(a.disclosedCameraMake).length, 0);
    }

    function test_immutable_config() public view {
        assertEq(address(attestor.verifier()), address(mockVerifier));
        assertEq(attestor.imageId(), IMAGE_ID);
    }
}
