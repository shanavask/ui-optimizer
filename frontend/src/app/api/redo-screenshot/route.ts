import { NextResponse } from "next/server";
import { getAuditRun, getFirestoreClient } from "@/lib/firestore-runs";
import { dispatchRedoScreenshotTask } from "@/lib/browseruse";

export const runtime = "nodejs";

type RedoScreenshotBody = { runId?: unknown; pageIndex?: unknown };

export async function POST(request: Request): Promise<Response> {
  try {
    const bodyUnknown: unknown = await request.json();
    if (typeof bodyUnknown !== "object" || bodyUnknown === null) {
      return NextResponse.json({ error: "Request body must be an object." }, { status: 400 });
    }
    const body = bodyUnknown as RedoScreenshotBody;
    if (typeof body.runId !== "string" || !body.runId.trim()) {
      return NextResponse.json({ error: "runId is required." }, { status: 400 });
    }
    if (typeof body.pageIndex !== "number") {
      return NextResponse.json({ error: "pageIndex is required." }, { status: 400 });
    }
    const runId = body.runId.trim();
    const pageIndex = body.pageIndex;

    const audit = await getAuditRun(runId);
    if (!audit) {
      return NextResponse.json({ error: "Run not found." }, { status: 404 });
    }
    const page = audit.pages[pageIndex];
    if (!page) {
      return NextResponse.json({ error: `Page ${pageIndex} not found.` }, { status: 404 });
    }
    if (!page.url?.trim()) {
      return NextResponse.json({ error: `Page ${pageIndex} has no URL.` }, { status: 400 });
    }

    const eyequantDocId = `${runId}_page_${pageIndex}`;
    await getFirestoreClient().collection("eyequant").doc(eyequantDocId).delete();

    await dispatchRedoScreenshotTask(page.url.trim(), runId, pageIndex, request.signal);
    return NextResponse.json({ ok: true });
  } catch (error: unknown) {
    const message = error instanceof Error ? error.message : "Failed to redo screenshot.";
    console.error("[redo-screenshot] request failed", { error });
    return NextResponse.json({ error: message }, { status: 500 });
  }
}
