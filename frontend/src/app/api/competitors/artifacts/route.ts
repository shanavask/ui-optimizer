import { NextResponse } from "next/server";
import { getAuditRun, getCompetitorArtifacts } from "@/lib/firestore-runs";

export const runtime = "nodejs";

export async function GET(request: Request): Promise<Response> {
  try {
    const { searchParams } = new URL(request.url);
    const runId = searchParams.get("runId")?.trim();
    if (!runId) {
      return NextResponse.json({ error: "runId is required." }, { status: 400 });
    }
    const audit = await getAuditRun(runId);
    if (!audit) {
      return NextResponse.json({ error: "Run not found." }, { status: 404 });
    }
    const pageCount = audit.pages.length;
    const competitorCount = audit.competitors?.length ?? 0;
    const artifacts = await getCompetitorArtifacts(runId, pageCount, competitorCount);
    return NextResponse.json({ artifacts });
  } catch (error: unknown) {
    const message = error instanceof Error ? error.message : "Failed to load competitor artifacts.";
    console.error("[competitors/artifacts] request failed", { error });
    return NextResponse.json({ error: message }, { status: 500 });
  }
}
