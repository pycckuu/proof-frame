// SPDX-License-Identifier: MIT
pragma solidity ^0.8.24;

import {Script, console} from "forge-std/Script.sol";
import {IRiscZeroVerifier} from "risc0/IRiscZeroVerifier.sol";
import {Receipt} from "risc0/IRiscZeroVerifier.sol";
import {ImageAttestor} from "../src/ImageAttestor.sol";

/// @notice Mock verifier for dev mode / hackathon demos
contract MockVerifier is IRiscZeroVerifier {
    function verify(bytes calldata, bytes32, bytes32) external pure {}
    function verifyIntegrity(Receipt calldata) external pure {}
}

contract Deploy is Script {
    // RISC Zero Verifier Router on Sepolia
    address constant VERIFIER_ROUTER = 0x925d8331ddc0a1F0d96E68CF073DFE1d92b69187;

    function run() external {
        bytes32 imageId = vm.envBytes32("IMAGE_ID");
        uint256 deployerKey = vm.envUint("DEPLOYER_PRIVATE_KEY");

        // Use mock verifier for dev mode, real router for production
        bool useMock = vm.envOr("USE_MOCK_VERIFIER", false);

        vm.startBroadcast(deployerKey);

        address verifierAddr;
        if (useMock) {
            MockVerifier mock = new MockVerifier();
            verifierAddr = address(mock);
            console.log("Deployed MockVerifier at:", verifierAddr);
        } else {
            verifierAddr = VERIFIER_ROUTER;
        }

        ImageAttestor attestor = new ImageAttestor(
            IRiscZeroVerifier(verifierAddr),
            imageId
        );

        vm.stopBroadcast();

        console.log("ImageAttestor deployed to:", address(attestor));
        console.log("Verifier:", verifierAddr);
        console.log("Image ID:", vm.toString(imageId));
        if (useMock) {
            console.log("WARNING: Using mock verifier - dev mode only, not secure!");
        }
    }
}
