import { NextResponse } from "next/server";

import { runPipelineTick } from "@/lib/pipeline";

export const runtime = "nodejs";

type TickBody = { runId?: unknown };

// Cloud Tasks HTTP target. Cloud Run's --no-allow-unauthenticated setting is
// the auth boundary here (only an OIDC-token-bearing caller with
// roles/run.invoker can reach this route) - no manual token verification
// needed in the handler itself.
//
// Business-logic step failures are recorded on the pipelines/{runId} doc by
// runPipelineTick itself and always resolve this request with 200, so Cloud
// Tasks' own retry only ever fires for genuine infra failures (this handler
// throwing unexpectedly, a cold start timeout, etc).
export async function POST(request: Request): Promise<Response> {
  try {
    const bodyUnknown: unknown = await request.json();
    if (typeof bodyUnknown !== "object" || bodyUnknown === null) {
      return NextResponse.json({ error: "Request body must be an object." }, { status: 400 });
    }
    const body = bodyUnknown as TickBody;
    if (typeof body.runId !== "string" || !body.runId.trim()) {
      return NextResponse.json({ error: "runId is required." }, { status: 400 });
    }
    await runPipelineTick(body.runId.trim());
    return NextResponse.json({ ok: true });
  } catch (error: unknown) {
    console.error("[pipeline/tick] unexpected error", error);
    return NextResponse.json({ error: "tick failed" }, { status: 500 });
  }
}
