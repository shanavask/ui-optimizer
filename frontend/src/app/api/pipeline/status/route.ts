import { NextRequest, NextResponse } from "next/server";

import { getPipelineDoc } from "@/lib/firestore-runs";

export const runtime = "nodejs";

export async function GET(request: NextRequest): Promise<Response> {
  try {
    const runId = request.nextUrl.searchParams.get("runId")?.trim();
    if (!runId) {
      return NextResponse.json({ error: "runId is required." }, { status: 400 });
    }
    const pipeline = await getPipelineDoc(runId);
    return NextResponse.json({ pipeline });
  } catch (error: unknown) {
    const message = error instanceof Error ? error.message : "Failed to fetch pipeline status.";
    return NextResponse.json({ error: message }, { status: 500 });
  }
}
