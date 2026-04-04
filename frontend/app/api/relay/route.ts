import { createWalletClient, http } from "viem";
import { privateKeyToAccount } from "viem/accounts";
import { sepolia } from "viem/chains";
import { IMAGE_ATTESTOR_ABI, IMAGE_ATTESTOR_ADDRESS } from "@/lib/contracts";

export async function POST(req: Request) {
  try {
    const body = await req.json();

    const privateKey = process.env.RELAYER_PRIVATE_KEY;
    if (!privateKey) {
      return Response.json(
        { error: "Relayer not configured" },
        { status: 500 }
      );
    }

    const account = privateKeyToAccount(privateKey as `0x${string}`);
    const client = createWalletClient({
      account,
      chain: sepolia,
      transport: http(process.env.SEPOLIA_RPC_URL || "https://rpc.sepolia.org"),
    });

    // 1. Submit attestation on-chain
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
      ],
    });

    // 2. Upload clean image to IPFS via Infura (optional)
    let ipfsCid: string | null = null;
    if (body.image_base64 && process.env.INFURA_IPFS_PROJECT_ID) {
      try {
        const formData = new FormData();
        const imageBuffer = Buffer.from(body.image_base64, "base64");
        const blob = new Blob([imageBuffer], { type: "image/png" });
        formData.append("file", blob, "clean.png");

        const auth = Buffer.from(
          `${process.env.INFURA_IPFS_PROJECT_ID}:${process.env.INFURA_IPFS_PROJECT_SECRET}`
        ).toString("base64");

        const ipfsRes = await fetch("https://ipfs.infura.io:5001/api/v0/add", {
          method: "POST",
          headers: { Authorization: `Basic ${auth}` },
          body: formData,
        });
        const ipfsData = await ipfsRes.json();
        ipfsCid = ipfsData.Hash;
      } catch (ipfsErr) {
        console.error("IPFS upload failed (non-fatal):", ipfsErr);
      }
    }

    // 3. Create ENS subname via NameStone (optional)
    let ensName: string | null = null;
    if (process.env.NAMESTONE_API_KEY) {
      try {
        const domain = process.env.ENS_DOMAIN || "proof-frame.eth";
        // Use IPFS CID as subname, fallback to pixel hash prefix (strip 0x)
        const hashPrefix = (body.pixelHash ?? "").replace(/^0x/, "").slice(0, 16);
        const subname = ipfsCid || hashPrefix;

        const textRecords: Record<string, string> = {
          "io.proofframe.pixelHash": body.pixelHash ?? "",
          "io.proofframe.txHash": hash,
          "io.proofframe.chain": "sepolia",
          "io.proofframe.contract": IMAGE_ATTESTOR_ADDRESS,
        };
        if (body.disclosedDate)
          textRecords["io.proofframe.date"] = body.disclosedDate;
        if (body.disclosedLocation)
          textRecords["io.proofframe.location"] = body.disclosedLocation;
        if (body.disclosedCameraMake)
          textRecords["io.proofframe.camera"] = body.disclosedCameraMake;
        if (ipfsCid) textRecords["io.proofframe.image"] = `ipfs://${ipfsCid}`;

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

    return Response.json({ txHash: hash, ensName, ipfsCid });
  } catch (err) {
    const message = err instanceof Error ? err.message : "Unknown error";
    return Response.json({ error: message }, { status: 500 });
  }
}
