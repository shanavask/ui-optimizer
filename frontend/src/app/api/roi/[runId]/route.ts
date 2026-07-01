import { NextResponse } from "next/server";

import { getRoiDocumentContent, hasRoiDocument, saveRoiDocumentContent } from "@/lib/firestore-runs";

export const runtime = "nodejs";

type Params = { params: Promise<{ runId: string }> };

export async function GET(_: Request, context: Params): Promise<Response> {
  const { runId } = await context.params;
  const trimmedRunId = runId.trim();
  if (!trimmedRunId) {
    return NextResponse.json({ error: "Run id is required." }, { status: 400 });
  }
  try {
    const exists = await hasRoiDocument(trimmedRunId);
    const content = exists ? await getRoiDocumentContent(trimmedRunId) : null;
    return NextResponse.json({ exists, content });
  } catch (error: unknown) {
    console.error("Failed loading ROI document", { runId: trimmedRunId, error });
    return NextResponse.json(
      { error: "Unable to load ROI document from Firestore." },
      { status: 500 },
    );
  }
}

export async function PATCH(request: Request, context: Params): Promise<Response> {
  const { runId } = await context.params;
  const trimmedRunId = runId.trim();
  if (!trimmedRunId) {
    return NextResponse.json({ error: "Run id is required." }, { status: 400 });
  }
  let body: unknown;
  try {
    body = await request.json();
  } catch {
    return NextResponse.json({ error: "Invalid JSON body." }, { status: 400 });
  }
  const { content } = body as { content?: unknown };
  if (typeof content !== "string") {
    return NextResponse.json({ error: "content must be a string." }, { status: 400 });
  }
  try {
    await saveRoiDocumentContent(trimmedRunId, content);
    return NextResponse.json({ ok: true });
  } catch (error: unknown) {
    console.error("Failed saving ROI document", { runId: trimmedRunId, error });
    return NextResponse.json(
      { error: "Unable to save ROI document to Firestore." },
      { status: 500 },
    );
  }
}
