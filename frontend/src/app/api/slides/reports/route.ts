import { NextResponse } from "next/server";

import { getAuditRun, getGuestimateReport, getPageReports } from "@/lib/firestore-runs";

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
    const [reports, guestimateMetrics] = await Promise.all([
      getPageReports(runId, pageCount),
      getGuestimateReport(runId),
    ]);
    return NextResponse.json({ reports, guestimateMetrics: guestimateMetrics ?? null });
  } catch (error: unknown) {
    const message =
      error instanceof Error && error.message.trim()
        ? error.message
        : "Unable to fetch reports.";
    return NextResponse.json({ error: message }, { status: 500 });
  }
}
