// SPDX-License-Identifier: MIT
pragma solidity ^0.8.24;

import {Script, console} from "forge-std/Script.sol";
import {IRiscZeroVerifier} from "risc0/IRiscZeroVerifier.sol";
import {Receipt} from "risc0/IRiscZeroVerifier.sol";
import {IWorldIDGroups} from "world-id/interfaces/IWorldIDGroups.sol";
import {ImageAttestor} from "../src/ImageAttestor.sol";

/// @notice Mock verifier for dev mode / hackathon demos
contract MockVerifier is IRiscZeroVerifier {
    function verify(bytes calldata, bytes32, bytes32) external pure {}
    function verifyIntegrity(Receipt calldata) external pure {}
}

/// @notice Mock World ID for dev mode / hackathon demos
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

contract Deploy is Script {
    // RISC Zero Verifier Router on Sepolia
    address constant VERIFIER_ROUTER = 0x925d8331ddc0a1F0d96E68CF073DFE1d92b69187;
    // World ID Router on Sepolia
    address constant WORLD_ID_ROUTER = 0x469449f251692E0779667583026b5A1E99512157;

    function run() external {
        bytes32 imageId = vm.envBytes32("IMAGE_ID");
        uint256 deployerKey = vm.envUint("DEPLOYER_PRIVATE_KEY");

        // Separate mock flags for RISC Zero and World ID
        bool mockZk = vm.envOr("USE_MOCK_VERIFIER", false);
        bool mockWorldId = vm.envOr("USE_MOCK_WORLD_ID", false);

        // World ID configuration
        string memory worldAppId = vm.envOr("WORLD_APP_ID", string("app_staging_proofframe"));
        string memory worldActionId = vm.envOr("WORLD_ACTION_ID", string("attest"));

        vm.startBroadcast(deployerKey);

        address verifierAddr;
        if (mockZk) {
            MockVerifier mock = new MockVerifier();
            verifierAddr = address(mock);
            console.log("Deployed MockVerifier at:", verifierAddr);
        } else {
            verifierAddr = VERIFIER_ROUTER;
        }

        address worldIdAddr;
        if (mockWorldId) {
            MockWorldID mockWid = new MockWorldID();
            worldIdAddr = address(mockWid);
            console.log("Deployed MockWorldID at:", worldIdAddr);
        } else {
            worldIdAddr = WORLD_ID_ROUTER;
        }

        ImageAttestor attestor = new ImageAttestor(
            IRiscZeroVerifier(verifierAddr),
            imageId,
            IWorldIDGroups(worldIdAddr),
            worldAppId,
            worldActionId
        );

        vm.stopBroadcast();

        console.log("ImageAttestor deployed to:", address(attestor));
        console.log("Verifier:", verifierAddr);
        console.log("World ID:", worldIdAddr);
        console.log("Image ID:", vm.toString(imageId));
        if (mockZk) {
            console.log("WARNING: Using mock ZK verifier - dev mode only!");
        }
        if (mockWorldId) {
            console.log("WARNING: Using mock World ID - dev mode only!");
        }
    }
}
