import { NextResponse } from "next/server";

import { deleteAuditRunDocuments, getAuditRun } from "@/lib/firestore-runs";

export const runtime = "nodejs";

type Params = { params: Promise<{ runId: string }> };

export async function GET(_: Request, context: Params): Promise<Response> {
  const { runId } = await context.params;
  if (!runId.trim()) {
    return NextResponse.json({ error: "Run id is required." }, { status: 400 });
  }
  try {
    const audit = await getAuditRun(runId);
    if (!audit) {
      return NextResponse.json({ error: "Run not found." }, { status: 404 });
    }
    return NextResponse.json({ audit });
  } catch (error: unknown) {
    console.error("Failed loading audit run", { runId, error });
    return NextResponse.json(
      { error: "Unable to load run from Firestore." },
      { status: 500 },
    );
  }
}

export async function DELETE(_: Request, context: Params): Promise<Response> {
  const { runId } = await context.params;
  const trimmedRunId = runId.trim();
  if (!trimmedRunId) {
    return NextResponse.json({ error: "Run id is required." }, { status: 400 });
  }
  try {
    await deleteAuditRunDocuments(trimmedRunId);
    return NextResponse.json({ ok: true });
  } catch (error: unknown) {
    console.error("Failed deleting audit run", { runId: trimmedRunId, error });
    return NextResponse.json(
      { error: "Unable to delete run from Firestore." },
      { status: 500 },
    );
  }
}
