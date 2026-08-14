import { NextResponse } from "next/server";

import { getSlidesUrl } from "@/lib/firestore-runs";
import { runSlidesCreateStep } from "@/lib/pipeline-actions";

type CreateSlidesBody = { taskIds?: unknown; runId?: unknown };

function parseTaskIds(value: unknown): string[] | null {
  if (!Array.isArray(value)) {
    return null;
  }
  const taskIds = value
    .filter((item): item is string => typeof item === "string")
    .map((item) => item.trim())
    .filter((item) => item.length > 0);
  return taskIds.length > 0 ? taskIds : null;
}

export const runtime = "nodejs";

export async function GET(request: Request): Promise<Response> {
  try {
    const { searchParams } = new URL(request.url);
    const runId = searchParams.get("runId")?.trim();
    if (!runId) {
      return NextResponse.json({ error: "runId is required." }, { status: 400 });
    }
    const slidesUrl = await getSlidesUrl(runId);
    return NextResponse.json({ slidesUrl: slidesUrl ?? null });
  } catch (error: unknown) {
    const message =
      error instanceof Error && error.message.trim()
        ? error.message
        : "Unable to fetch slides URL.";
    return NextResponse.json({ error: message }, { status: 500 });
  }
}

export async function POST(request: Request): Promise<Response> {
  try {
    const bodyUnknown: unknown = await request.json();
    if (typeof bodyUnknown !== "object" || bodyUnknown === null) {
      return NextResponse.json({ error: "Request body must be an object." }, { status: 400 });
    }
    const body = bodyUnknown as CreateSlidesBody;
    if (typeof body.runId !== "string" || !body.runId.trim()) {
      return NextResponse.json({ error: "runId is required." }, { status: 400 });
    }
    const runId = body.runId.trim();
    const taskIds = parseTaskIds(body.taskIds);
    if (!taskIds) {
      return NextResponse.json(
        { error: "taskIds must be a non-empty string array." },
        { status: 400 },
      );
    }

    const existingSlidesUrl = await getSlidesUrl(runId);
    if (existingSlidesUrl) {
      return NextResponse.json({ slidesUrl: existingSlidesUrl, fromFirestore: true });
    }

    const slidesUrl = await runSlidesCreateStep(runId, taskIds);
    return NextResponse.json({ slidesUrl });
  } catch (error: unknown) {
    const message =
      error instanceof Error && error.message.trim()
        ? error.message
        : "Unable to create slides.";
    return NextResponse.json({ error: message }, { status: 500 });
  }
}
