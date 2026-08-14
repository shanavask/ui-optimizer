import { NextResponse } from "next/server";

import { runEyeQuantStep } from "@/lib/pipeline-actions";

type EyeQuantBody = { runId?: unknown; pageIndex?: unknown };

export const runtime = "nodejs";

export async function POST(request: Request): Promise<Response> {
  const requestId = `eyequant-${Date.now()}`;
  try {
    console.info("[slides/eyequant] request received", { requestId });
    const bodyUnknown: unknown = await request.json();
    if (typeof bodyUnknown !== "object" || bodyUnknown === null) {
      console.warn("[slides/eyequant] invalid body", {
        requestId,
        bodyType: typeof bodyUnknown,
      });
      return NextResponse.json({ error: "Request body must be an object." }, { status: 400 });
    }
    const body = bodyUnknown as EyeQuantBody;
    if (typeof body.runId !== "string" || !body.runId.trim()) {
      console.warn("[slides/eyequant] missing runId", {
        requestId,
        runIdType: typeof body.runId,
      });
      return NextResponse.json({ error: "runId is required." }, { status: 400 });
    }
    const runId = body.runId.trim();
    const pageIndex = typeof body.pageIndex === "number" ? body.pageIndex : null;
    const status = await runEyeQuantStep(runId, pageIndex);
    console.info("[slides/eyequant] upstream response", { requestId, runId, status });
    return NextResponse.json({ status });
  } catch (error: unknown) {
    const message =
      error instanceof Error && error.message.trim()
        ? error.message
        : "Unable to run EyeQuant.";
    console.error("[slides/eyequant] request failed", {
      requestId,
      message,
      error,
    });
    return NextResponse.json({ error: message }, { status: 500 });
  }
}
