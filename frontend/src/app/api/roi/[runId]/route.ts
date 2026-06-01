import { NextResponse } from "next/server";

import { getRoiDocumentContent, hasRoiDocument } from "@/lib/firestore-runs";

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
