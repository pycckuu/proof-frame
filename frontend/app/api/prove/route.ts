import { prove } from "@/lib/prover";

export async function POST(req: Request) {
  try {
    const body = await req.json();

    if (!body.image_base64) {
      return Response.json(
        { error: "image_base64 is required" },
        { status: 400 }
      );
    }

    // Limit image size to ~15MB (20MB base64)
    if (body.image_base64.length > 20 * 1024 * 1024) {
      return Response.json(
        { error: "Image too large. Maximum size is ~15MB." },
        { status: 413 }
      );
    }

    const result = await prove({
      image_base64: body.image_base64,
      transform: body.transform || '"None"',
      disclosure: body.disclosure || {},
      signing_key: body.signing_key,
    });

    return Response.json(result);
  } catch (err) {
    const message =
      err instanceof Error ? err.message : "Proof generation failed";
    return Response.json({ error: message }, { status: 500 });
  }
}
