import { createWalletClient, http, decodeAbiParameters } from "viem";
import { privateKeyToAccount } from "viem/accounts";
import { sepolia } from "viem/chains";
import { IMAGE_ATTESTOR_ABI, IMAGE_ATTESTOR_ADDRESS } from "@/lib/contracts";
import { corsHeaders, handleCors } from "@/lib/cors";

type Proof8 = readonly [bigint, bigint, bigint, bigint, bigint, bigint, bigint, bigint];
const EMPTY_PROOF: Proof8 = [BigInt(0), BigInt(0), BigInt(0), BigInt(0), BigInt(0), BigInt(0), BigInt(0), BigInt(0)];

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

    // 1. Upload proof package (image + metadata) to IPFS FIRST (so CID is available for on-chain tx)
    let ipfsCid: string | null = null;
    if (body.image_base64 && process.env.INFURA_IPFS_PROJECT_ID) {
      try {
        const auth = Buffer.from(
          `${process.env.INFURA_IPFS_PROJECT_ID}:${process.env.INFURA_IPFS_PROJECT_SECRET}`
        ).toString("base64");

        const metadata = {
          version: 1,
          pixelHash: body.pixelHash ?? "",
          originalPixelHash: body.originalPixelHash ?? "",
          fileHash: body.fileHash ?? "",
          merkleRoot: body.merkleRoot ?? "",
          chain: "sepolia",
          contract: IMAGE_ATTESTOR_ADDRESS,
          transforms: body.transformDesc || "none",
          dimensions: { width: body.imageWidth ?? 0, height: body.imageHeight ?? 0 },
          attestedAt: new Date().toISOString(),
          disclosed: {
            ...(body.disclosedDate ? { date: body.disclosedDate } : {}),
            ...(body.disclosedLocation ? { location: body.disclosedLocation } : {}),
            ...(body.disclosedCameraMake ? { cameraMake: body.disclosedCameraMake } : {}),
          },
        };

        // Upload as directory: image.png + metadata.json
        const formData = new FormData();
        const imageBuffer = Buffer.from(body.image_base64, "base64");
        formData.append("file", new Blob([imageBuffer], { type: "image/png" }), "image.png");
        formData.append("file", new Blob([JSON.stringify(metadata, null, 2)], { type: "application/json" }), "metadata.json");

        const ipfsRes = await fetch("https://ipfs.infura.io:5001/api/v0/add?wrap-with-directory=true", {
          method: "POST",
          headers: { Authorization: `Basic ${auth}` },
          body: formData,
        });

        // Infura returns one JSON line per file + directory; last line is the root
        const lines = (await ipfsRes.text()).trim().split("\n");
        const entries = lines.map((l) => JSON.parse(l));
        const root = entries.find((e) => e.Name === "");
        ipfsCid = root?.Hash ?? entries[entries.length - 1].Hash;
      } catch (ipfsErr) {
        console.error("IPFS upload failed (non-fatal):", ipfsErr);
      }
    }

    // 2. Submit attestation on-chain (with IPFS CID stored in contract)
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
        // World ID params — randomize nullifier when using mock to avoid DuplicateNullifier
        BigInt(body.worldIdRoot || 0),
        process.env.USE_MOCK_WORLD_ID === "true"
          ? BigInt(`0x${Array.from(crypto.getRandomValues(new Uint8Array(32))).map(b => b.toString(16).padStart(2, "0")).join("")}`)
          : BigInt(body.worldIdNullifier || 0),
        decodeWorldIdProof(body.worldIdProof),
      ],
    });

    // 3. Create ENS subname via NameStone (optional)
    let ensName: string | null = null;
    if (process.env.NAMESTONE_API_KEY) {
      try {
        const domain = process.env.ENS_DOMAIN || "proof-frame.eth";
        // Use IPFS CID as subname, fallback to pixel hash prefix (strip 0x)
        const hashPrefix = (body.pixelHash ?? "").replace(/^0x/, "").slice(0, 16);
        const subname = ipfsCid || hashPrefix;

        const textRecords: Record<string, string> = {
          // Standard ENS records (rendered by ENS-aware apps)
          ...(ipfsCid ? { avatar: `ipfs://${ipfsCid}/image.png` } : {}),
          url: `https://proof-frame.eth/verify?hash=${(body.pixelHash ?? "").replace(/^0x/, "")}`,
          description: buildDescription(body, ipfsCid),

          // ProofFrame core attestation data
          "io.proofframe.pixelHash": body.pixelHash ?? "",
          ...(body.originalPixelHash ? { "io.proofframe.originalPixelHash": body.originalPixelHash } : {}),
          "io.proofframe.fileHash": body.fileHash ?? "",
          "io.proofframe.merkleRoot": body.merkleRoot ?? "",
          "io.proofframe.txHash": hash,
          "io.proofframe.chain": "sepolia",
          "io.proofframe.contract": IMAGE_ATTESTOR_ADDRESS,
          "io.proofframe.transforms": body.transformDesc || "none",
          "io.proofframe.dimensions": `${body.imageWidth ?? 0}x${body.imageHeight ?? 0}`,
          "io.proofframe.version": "1",
          "io.proofframe.attestedAt": new Date().toISOString(),

          // Conditional disclosed metadata
          ...(body.disclosedDate ? { "io.proofframe.date": body.disclosedDate } : {}),
          ...(body.disclosedLocation ? { "io.proofframe.location": body.disclosedLocation } : {}),
          ...(body.disclosedCameraMake ? { "io.proofframe.camera": body.disclosedCameraMake } : {}),
          ...(ipfsCid ? { "io.proofframe.image": `ipfs://${ipfsCid}/image.png` } : {}),
          ...(ipfsCid ? { "io.proofframe.metadata": `ipfs://${ipfsCid}/metadata.json` } : {}),
        };

        const nsRes = await fetch(
          "https://namestone.com/api/public_v1/set-name",
          {
            method: "POST",
            headers: {
              "Content-Type": "application/json",
              Authorization: process.env.NAMESTONE_API_KEY,
            },
            body: JSON.stringify({
              domain,
              name: subname,
              address: "0x0000000000000000000000000000000000000000",
              ...(ipfsCid ? { contenthash: `ipfs://${ipfsCid}` } : {}),
              text_records: textRecords,
            }),
          }
        );

        if (nsRes.ok) {
          ensName = `${subname}.${domain}`;
        } else {
          console.error(
            "NameStone error:",
            nsRes.status,
            await nsRes.text()
          );
        }
      } catch (ensErr) {
        console.error("ENS subname creation failed (non-fatal):", ensErr);
      }
    }

    return Response.json({ txHash: hash, ensName, ipfsCid }, { headers: corsHeaders() });
  } catch (err) {
    const message = err instanceof Error ? err.message : "Unknown error";
    return Response.json({ error: message }, { status: 500, headers: corsHeaders() });
  }
}
