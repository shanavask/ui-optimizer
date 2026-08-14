import { NextRequest, NextResponse } from "next/server";

import { getAuditRun, shotsDocumentExists } from "@/lib/firestore-runs";
import { runCompetitorsAuditStep } from "@/lib/pipeline-actions";

export const runtime = "nodejs";

export async function GET(request: NextRequest): Promise<Response> {
  try {
    const runId = request.nextUrl.searchParams.get("runId")?.trim();
    if (!runId) {
      return NextResponse.json({ error: "runId is required." }, { status: 400 });
    }
    const exists = await shotsDocumentExists(runId);
    return NextResponse.json({ exists });
  } catch (err) {
    const message = err instanceof Error ? err.message : "Failed to check audit status.";
    return NextResponse.json({ error: message }, { status: 500 });
  }
}

type AuditCompetitorsBody = { runId?: unknown };

export async function POST(request: Request): Promise<Response> {
  const controller = new AbortController();
  const timeout = setTimeout(() => controller.abort(), 600_000);

  try {
    const bodyUnknown: unknown = await request.json();
    if (typeof bodyUnknown !== "object" || bodyUnknown === null) {
      return NextResponse.json({ error: "Request body must be an object." }, { status: 400 });
    }
    const body = bodyUnknown as AuditCompetitorsBody;
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

    const result = await runCompetitorsAuditStep(runId, audit, controller.signal);
    return NextResponse.json(result);
  } catch (err) {
    const message = err instanceof Error ? err.message : "Failed to audit competitors.";
    console.error("[competitors/audit] request failed", { err });
    return NextResponse.json({ error: message }, { status: 500 });
  } finally {
    clearTimeout(timeout);
  }
}
