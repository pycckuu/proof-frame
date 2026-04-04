import { IMAGE_ATTESTOR_ADDRESS } from "@/lib/contracts";
import { corsHeaders, handleCors } from "@/lib/cors";

export async function OPTIONS(req: Request) {
  return handleCors(req) ?? new Response(null, { status: 204, headers: corsHeaders() });
}

export async function POST(req: Request) {
  try {
    const body = await req.json();

    if (!body.image_base64) {
      return Response.json({ error: "No image provided" }, { status: 400, headers: corsHeaders() });
    }

    if (!process.env.INFURA_IPFS_PROJECT_ID) {
      return Response.json({ error: "IPFS not configured" }, { status: 500, headers: corsHeaders() });
    }

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

    const formData = new FormData();
    const imageBuffer = Buffer.from(body.image_base64, "base64");
    formData.append("file", new Blob([imageBuffer], { type: "image/png" }), "image.png");
    formData.append("file", new Blob([JSON.stringify(metadata, null, 2)], { type: "application/json" }), "metadata.json");

    const ipfsRes = await fetch("https://ipfs.infura.io:5001/api/v0/add?wrap-with-directory=true", {
      method: "POST",
      headers: { Authorization: `Basic ${auth}` },
      body: formData,
    });

    const lines = (await ipfsRes.text()).trim().split("\n");
    const entries = lines.map((l) => JSON.parse(l));
    const root = entries.find((e) => e.Name === "");
    const ipfsCid = root?.Hash ?? entries[entries.length - 1].Hash;

    return Response.json({ ipfsCid }, { headers: corsHeaders() });
  } catch (err) {
    return Response.json(
      { error: err instanceof Error ? err.message : "Upload failed" },
      { status: 500, headers: corsHeaders() }
    );
  }
}
