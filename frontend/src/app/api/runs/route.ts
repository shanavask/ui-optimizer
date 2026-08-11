import { NextResponse } from "next/server";

import { dispatchBrowserUseTasks } from "@/lib/browseruse";
import {
  listAuditRuns,
  parseUIAuditResponse,
} from "@/lib/firestore-runs";

export const runtime = "nodejs";

type RunsPostBody = { audit?: unknown; runId?: unknown };

export async function GET(request: Request): Promise<Response> {
  try {
    const { searchParams } = new URL(request.url);
    const limitParam = searchParams.get("limit");
    const limit = limitParam ? Math.max(1, Math.min(100, parseInt(limitParam, 10))) : undefined;
    const cursor = searchParams.get("cursor") ?? undefined;
    const result = await listAuditRuns(limit, cursor);
    return NextResponse.json(result);
  } catch (error: unknown) {
    console.error("Failed listing audit runs", error);
    return NextResponse.json(
      { error: "Unable to load runs from Firestore." },
      { status: 500 },
    );
  }
}

export async function POST(request: Request): Promise<Response> {
  const controller = new AbortController();
  const timeout = setTimeout(() => controller.abort(), 300_000);

  try {
    const bodyUnknown: unknown = await request.json();
    if (typeof bodyUnknown !== "object" || bodyUnknown === null) {
      return NextResponse.json({ error: "Request body must be an object." }, { status: 400 });
    }

    const body = bodyUnknown as RunsPostBody;
    const audit = parseUIAuditResponse(body.audit);
    if (!audit) {
      return NextResponse.json({ error: "Request body must include a valid audit." }, { status: 400 });
    }

    if (body.runId !== undefined && typeof body.runId !== "string") {
      return NextResponse.json({ error: "runId must be a string when provided." }, { status: 400 });
    }

    const runId = body.runId?.trim();
    if (!runId) {
      return NextResponse.json({ error: "runId is required." }, { status: 400 });
    }
    const auditWithTaskState = await dispatchBrowserUseTasks(
      audit,
      controller.signal,
      runId,
    );
    return NextResponse.json({ runId, audit: auditWithTaskState });
  } catch (error: unknown) {
    console.error("Failed saving audit run", error);
    const status = error instanceof Error && error.name === "AbortError" ? 504 : 500;
    const message =
      error instanceof Error && error.message.trim()
        ? error.message
        : "Unable to save and run BrowserUse tasks.";
    return NextResponse.json({ error: message }, { status });
  } finally {
    clearTimeout(timeout);
  }
}
