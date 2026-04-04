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

    return Response.json({ txHash: hash });
  } catch (err) {
    const message = err instanceof Error ? err.message : "Unknown error";
    return Response.json({ error: message }, { status: 500 });
  }
}
