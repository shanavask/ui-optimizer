import { NextResponse } from "next/server";
import { getAuditRun } from "@/lib/firestore-runs";
import { dispatchCompetitorTasks } from "@/lib/browseruse";

export const runtime = "nodejs";

type RunCompetitorsBody = { runId?: unknown };

export async function POST(request: Request): Promise<Response> {
  try {
    const bodyUnknown: unknown = await request.json();
    if (typeof bodyUnknown !== "object" || bodyUnknown === null) {
      return NextResponse.json({ error: "Request body must be an object." }, { status: 400 });
    }
    const body = bodyUnknown as RunCompetitorsBody;
    if (typeof body.runId !== "string" || !body.runId.trim()) {
      return NextResponse.json({ error: "runId is required." }, { status: 400 });
    }
    const runId = body.runId.trim();

    const audit = await getAuditRun(runId);
    if (!audit) {
      return NextResponse.json({ error: "Run not found." }, { status: 404 });
    }
    if (!audit.competitors || audit.competitors.length === 0) {
      return NextResponse.json({ error: "No competitors configured for this run." }, { status: 400 });
    }

    const result = await dispatchCompetitorTasks(audit, runId, request.signal);
    return NextResponse.json(result);
  } catch (error: unknown) {
    const message = error instanceof Error ? error.message : "Failed to run competitors.";
    console.error("[competitors/run] request failed", { error });
    return NextResponse.json({ error: message }, { status: 500 });
  }
}
