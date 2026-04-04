import { createWalletClient, http, decodeAbiParameters } from "viem";
import { privateKeyToAccount } from "viem/accounts";
import { sepolia } from "viem/chains";
import { IMAGE_ATTESTOR_ABI, IMAGE_ATTESTOR_ADDRESS } from "@/lib/contracts";
import { corsHeaders, handleCors } from "@/lib/cors";

type Proof8 = readonly [bigint, bigint, bigint, bigint, bigint, bigint, bigint, bigint];
const EMPTY_PROOF: Proof8 = [BigInt(0), BigInt(0), BigInt(0), BigInt(0), BigInt(0), BigInt(0), BigInt(0), BigInt(0)];

const BASE58_ALPHABET = "123456789ABCDEFGHJKLMNPQRSTUVWXYZabcdefghijkmnopqrstuvwxyz";
function base58Decode(str: string): Uint8Array {
  const bytes: number[] = [0];
  for (const char of str) {
    const idx = BASE58_ALPHABET.indexOf(char);
    if (idx < 0) throw new Error(`Invalid base58 char: ${char}`);
    let carry = idx;
    for (let j = 0; j < bytes.length; j++) {
      carry += bytes[j] * 58;
      bytes[j] = carry & 0xff;
      carry >>= 8;
    }
    while (carry > 0) { bytes.push(carry & 0xff); carry >>= 8; }
  }
  // Add leading zeros
  for (const char of str) { if (char === "1") bytes.push(0); else break; }
  return new Uint8Array(bytes.reverse());
}

/** Decode World ID proof from hex string to uint256[8] array */
function decodeWorldIdProof(proof: string | undefined): Proof8 {
  if (!proof) return EMPTY_PROOF;
  try {
    const hexProof = proof.startsWith("0x") ? proof : `0x${proof}`;
    const decoded = decodeAbiParameters(
      [{ type: "uint256[8]" }],
      hexProof as `0x${string}`
    );
    return decoded[0] as unknown as Proof8;
  } catch {
    return EMPTY_PROOF;
  }
}

export async function OPTIONS(req: Request) {
  return handleCors(req) ?? new Response(null, { status: 204, headers: corsHeaders() });
}

function buildDescription(body: Record<string, unknown>, ipfsCid: string | null): string {
  const w = body.imageWidth ?? 0;
  const h = body.imageHeight ?? 0;
  const transforms = body.transformDesc && body.transformDesc !== "none"
    ? `, transforms: ${body.transformDesc}`
    : "";
  const ipfs = ipfsCid ? " IPFS-pinned." : "";
  return `ProofFrame ZK-attested image (${w}x${h}${transforms}).${ipfs} Verified on Sepolia.`;
}

export async function POST(req: Request) {
  try {
    const body = await req.json();

    const privateKey = process.env.RELAYER_PRIVATE_KEY;
    if (!privateKey) {
      return Response.json(
        { error: "Relayer not configured" },
        { status: 500, headers: corsHeaders() }
      );
    }

    const account = privateKeyToAccount(privateKey as `0x${string}`);
    const client = createWalletClient({
      account,
      chain: sepolia,
      transport: http(process.env.SEPOLIA_RPC_URL || "https://rpc.sepolia.org"),
    });

    // IPFS CID is provided by the client (uploaded via /api/upload before signing)
    const ipfsCid: string | null = body.ipfsCid || null;

    // Encode IPFS CID as ENS contenthash (0xe3010170 + base58-decoded multihash)
    let ipfsContenthash: `0x${string}` = "0x";
    if (ipfsCid) {
      try {
        const decoded = base58Decode(ipfsCid);
        // ENS contenthash for IPFS: codec=0xe3 (ipfs), version=0x01, multicodec=0x70 (dag-pb)
        ipfsContenthash = `0xe3010170${Buffer.from(decoded).toString("hex")}` as `0x${string}`;
      } catch {
        // Skip contenthash if encoding fails
      }
    }

    // 1. Submit attestation on-chain (with IPFS CID stored in contract)
    const hash = await client.writeContract({
      address: IMAGE_ATTESTOR_ADDRESS,
      abi: IMAGE_ATTESTOR_ABI,
      functionName: "attestImage",
      args: [
        body.seal as `0x${string}`,
        body.journalDigest as `0x${string}`,
        body.pixelHash as `0x${string}`,
        body.fileHash as `0x${string}`,
        body.merkleRoot as `0x${string}`,
        body.transformDesc ?? "",
        body.disclosedDate ?? "",
        body.disclosedLocation ?? "",
        body.disclosedCameraMake ?? "",
        body.imageWidth ?? 0,
        body.imageHeight ?? 0,
        ipfsCid ?? "",
        ipfsContenthash,
        // World ID params — randomize nullifier when using mock to avoid DuplicateNullifier
        BigInt(body.worldIdRoot || 0),
        process.env.USE_MOCK_WORLD_ID === "true"
          ? BigInt(`0x${Array.from(crypto.getRandomValues(new Uint8Array(32))).map(b => b.toString(16).padStart(2, "0")).join("")}`)
          : BigInt(body.worldIdNullifier || 0),
        decodeWorldIdProof(body.worldIdProof),
      ],
    });

    // 3. ENS subdomain is now created on-chain by the contract (via NameWrapper)
    //    Label = first 16 hex chars of pixel hash (matches contract _buildLabel)
    const domain = process.env.ENS_DOMAIN || "proof-frame.eth";
    const ensLabel = (body.pixelHash ?? "").replace(/^0x/, "").toLowerCase().slice(0, 16);
    const ensName = `${ensLabel}.${domain}`;

    return Response.json({ txHash: hash, ensName, ipfsCid }, { headers: corsHeaders() });
  } catch (err) {
    const message = err instanceof Error ? err.message : "Unknown error";
    return Response.json({ error: message }, { status: 500, headers: corsHeaders() });
  }
}
