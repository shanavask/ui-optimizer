import { NextResponse } from "next/server";

import { getAuditRun, getPageReports } from "@/lib/firestore-runs";

export const runtime = "nodejs";

export async function GET(request: Request): Promise<Response> {
  try {
    const { searchParams } = new URL(request.url);
    const runId = searchParams.get("runId")?.trim();
    if (!runId) {
      return NextResponse.json({ error: "runId is required." }, { status: 400 });
    }
    const audit = await getAuditRun(runId);
    const pageCount = audit?.pages.length ?? 0;
    const reports = await getPageReports(runId, pageCount);
    return NextResponse.json({ reports });
  } catch (error: unknown) {
    const message =
      error instanceof Error && error.message.trim()
        ? error.message
        : "Unable to fetch reports.";
    return NextResponse.json({ error: message }, { status: 500 });
  }
}
