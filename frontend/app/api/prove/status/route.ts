/**
 * GET /api/prove/status?jobId=xxx — Poll RunPod job status.
 *
 * Returns { status, receipt?, error? }
 * Status: "IN_QUEUE" | "IN_PROGRESS" | "COMPLETED" | "FAILED"
 */

export async function GET(req: Request) {
  try {
    const apiKey = process.env.RUNPOD_API_KEY;
    const endpointId = process.env.RUNPOD_ENDPOINT_ID;

    if (!apiKey || !endpointId) {
      return Response.json(
        { error: "RunPod not configured" },
        { status: 500 }
      );
    }

    const { searchParams } = new URL(req.url);
    const jobId = searchParams.get("jobId");

    if (!jobId) {
      return Response.json({ error: "Missing jobId parameter" }, { status: 400 });
    }

    // Validate jobId format to prevent URL manipulation
    if (!/^[a-zA-Z0-9_-]+$/.test(jobId)) {
      return Response.json({ error: "Invalid jobId format" }, { status: 400 });
    }

    const res = await fetch(
      `https://api.runpod.ai/v2/${endpointId}/status/${jobId}`,
      {
        headers: {
          Authorization: `Bearer ${apiKey}`,
        },
      }
    );

    if (!res.ok) {
      const text = await res.text();
      return Response.json(
        { error: `RunPod API error: ${res.status} ${text}` },
        { status: 502 }
      );
    }

    const data = await res.json();

    if (data.status === "COMPLETED") {
      // data.output contains the receipt JSON from handler.py
      const output = data.output;
      if (output?.error) {
        return Response.json({ status: "FAILED", error: output.error });
      }
      return Response.json({ status: "COMPLETED", receipt: output });
    }

    if (data.status === "FAILED") {
      return Response.json({
        status: "FAILED",
        error: data.error || "Proving failed on RunPod",
      });
    }

    // IN_QUEUE or IN_PROGRESS
    return Response.json({ status: data.status });
  } catch (err) {
    const message = err instanceof Error ? err.message : "Unknown error";
    return Response.json({ error: message }, { status: 500 });
  }
}
