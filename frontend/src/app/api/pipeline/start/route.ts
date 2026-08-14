import { NextResponse } from "next/server";

import { enqueuePipelineTick } from "@/lib/cloud-tasks";
import { createOrResetPipelineDoc, getAuditRun } from "@/lib/firestore-runs";

export const runtime = "nodejs";

type StartBody = { runId?: unknown };

export async function POST(request: Request): Promise<Response> {
  try {
    const bodyUnknown: unknown = await request.json();
    if (typeof bodyUnknown !== "object" || bodyUnknown === null) {
      return NextResponse.json({ error: "Request body must be an object." }, { status: 400 });
    }
    const body = bodyUnknown as StartBody;
    if (typeof body.runId !== "string" || !body.runId.trim()) {
      return NextResponse.json({ error: "runId is required." }, { status: 400 });
    }
    const runId = body.runId.trim();

    const audit = await getAuditRun(runId);
    if (!audit) {
      return NextResponse.json({ error: "Run not found." }, { status: 404 });
    }

    const pipeline = await createOrResetPipelineDoc(runId);
    await enqueuePipelineTick(runId, 0);
    return NextResponse.json({ ok: true, pipeline });
  } catch (error: unknown) {
    console.error("[pipeline/start] request failed", error);
    const message = error instanceof Error && error.message.trim() ? error.message : "Failed to start pipeline.";
    return NextResponse.json({ error: message }, { status: 500 });
  }
}
