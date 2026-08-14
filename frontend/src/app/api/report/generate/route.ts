import { NextResponse } from "next/server";

import { DEFAULT_AGENT_USERNAME } from "@/lib/agent-run";
import { runReportGenerateStep } from "@/lib/pipeline-actions";

type GenerateReportBody = { runId?: unknown; username?: unknown };

export const runtime = "nodejs";

export async function POST(request: Request): Promise<Response> {
  const controller = new AbortController();
  const timeout = setTimeout(() => controller.abort(), 300_000);
  try {
    const bodyUnknown: unknown = await request.json();
    if (!bodyUnknown || typeof bodyUnknown !== "object") {
      return NextResponse.json({ error: "Request body must be an object." }, { status: 400 });
    }
    const body = bodyUnknown as GenerateReportBody;
    const runId = typeof body.runId === "string" ? body.runId.trim() : "";
    if (!runId) {
      return NextResponse.json({ error: "runId is required." }, { status: 400 });
    }
    if (body.username !== undefined && typeof body.username !== "string") {
      return NextResponse.json({ error: "username must be a string when provided." }, { status: 400 });
    }
    const username = (typeof body.username === "string" ? body.username.trim() : "") || DEFAULT_AGENT_USERNAME;

    await runReportGenerateStep(runId, controller.signal, username);

    return NextResponse.json({ ok: true });
  } catch (error: unknown) {
    console.error("Report generate API failed", error);
    const status = error instanceof Error && error.name === "AbortError" ? 504 : 500;
    const message =
      error instanceof Error && error.message.trim()
        ? error.message
        : "Unable to run auditor agent for report generation.";
    return NextResponse.json({ error: message }, { status });
  } finally {
    clearTimeout(timeout);
  }
}
