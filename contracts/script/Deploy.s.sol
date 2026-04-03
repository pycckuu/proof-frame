// SPDX-License-Identifier: MIT
pragma solidity ^0.8.24;

import {Script, console} from "forge-std/Script.sol";
import {IRiscZeroVerifier} from "risc0/IRiscZeroVerifier.sol";
import {ImageAttestor} from "../src/ImageAttestor.sol";

contract Deploy is Script {
    // RISC Zero Verifier Router on Sepolia
    address constant VERIFIER_ROUTER = 0x925d8331ddc0a1F0d96E68CF073DFE1d92b69187;

    function run() external {
        bytes32 imageId = vm.envBytes32("IMAGE_ID");
        uint256 deployerKey = vm.envUint("DEPLOYER_PRIVATE_KEY");

        vm.startBroadcast(deployerKey);

        ImageAttestor attestor = new ImageAttestor(
            IRiscZeroVerifier(VERIFIER_ROUTER),
            imageId
        );

        vm.stopBroadcast();

        console.log("ImageAttestor deployed to:", address(attestor));
        console.log("Verifier router:", VERIFIER_ROUTER);
        console.log("Image ID:", vm.toString(imageId));
    }
}
