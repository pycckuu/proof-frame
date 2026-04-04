import { createPublicClient, http } from "viem";
import { sepolia } from "viem/chains";

export const SEPOLIA_CHAIN_ID = 11155111;

// Deployed on Sepolia: MockVerifier (ZK) + MockWorldID (both dev mode)
export const IMAGE_ATTESTOR_ADDRESS =
  "0x3186a0b644DE94274178a28d1BE3ebD0352eDbE6" as const;

export const IMAGE_ATTESTOR_ABI = [
  {
    type: "function",
    name: "attestImage",
    inputs: [
      { name: "seal", type: "bytes" },
      { name: "journalDigest", type: "bytes32" },
      { name: "pixelHash", type: "bytes32" },
      { name: "fileHash", type: "bytes32" },
      { name: "merkleRoot", type: "bytes32" },
      { name: "transformDesc", type: "string" },
      { name: "disclosedDate", type: "string" },
      { name: "disclosedLocation", type: "string" },
      { name: "disclosedCameraMake", type: "string" },
      { name: "imageWidth", type: "uint32" },
      { name: "imageHeight", type: "uint32" },
      { name: "worldIdRoot", type: "uint256" },
      { name: "worldIdNullifier", type: "uint256" },
      { name: "worldIdProof", type: "uint256[8]" },
    ],
    outputs: [],
    stateMutability: "nonpayable",
  },
  {
    type: "function",
    name: "isVerified",
    inputs: [{ name: "pixelHash", type: "bytes32" }],
    outputs: [{ name: "", type: "bool" }],
    stateMutability: "view",
  },
  {
    type: "function",
    name: "getAttestation",
    inputs: [{ name: "pixelHash", type: "bytes32" }],
    outputs: [
      {
        name: "",
        type: "tuple",
        components: [
          { name: "fileHash", type: "bytes32" },
          { name: "merkleRoot", type: "bytes32" },
          { name: "transformDesc", type: "string" },
          { name: "timestamp", type: "uint256" },
          { name: "disclosedDate", type: "string" },
          { name: "disclosedLocation", type: "string" },
          { name: "disclosedCameraMake", type: "string" },
          { name: "imageWidth", type: "uint32" },
          { name: "imageHeight", type: "uint32" },
        ],
      },
    ],
    stateMutability: "view",
  },
] as const;

const RPC_URL =
  process.env.NEXT_PUBLIC_SEPOLIA_RPC_URL || "https://rpc.sepolia.org";

export const publicClient = createPublicClient({
  chain: sepolia,
  transport: http(RPC_URL),
});
