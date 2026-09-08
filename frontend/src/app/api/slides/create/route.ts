import { NextResponse } from "next/server";

import { proxyToSlidesApi } from "@/lib/backend-proxy";
import { slidesApiAuthHeaders, slidesApiBaseUrl } from "@/lib/slidesapi";

type CreateSlidesBody = { taskIds?: unknown; runId?: unknown };

export const runtime = "nodejs";

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

export async function GET(request: Request): Promise<Response> {
  const { searchParams } = new URL(request.url);
  return proxyToSlidesApi("/slides/url", { method: "GET", searchParams });
}

// Adapter, not a straight proxy: slidesapi's existing /create_slides takes a
// raw JSON array body and returns a bare string (URL or human-readable
// error text, always HTTP 200) - this route preserves the pre-migration
// contract of a {slidesUrl} JSON object with a real error status on failure.
export async function POST(request: Request): Promise<Response> {
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
    return NextResponse.json({ error: "taskIds must be a non-empty string array." }, { status: 400 });
  }

  const existingResponse = await proxyToSlidesApi("/slides/url", {
    method: "GET",
    searchParams: new URLSearchParams({ runId }),
  });
  const existing = (await existingResponse.json()) as { slidesUrl: string | null };
  if (existing.slidesUrl) {
    return NextResponse.json({ slidesUrl: existing.slidesUrl, fromFirestore: true });
  }

  const baseUrl = slidesApiBaseUrl();
  const authHeaders = await slidesApiAuthHeaders(baseUrl);
  const response = await fetch(`${baseUrl}/create_slides`, {
    method: "POST",
    headers: { "Content-Type": "application/json", ...authHeaders },
    body: JSON.stringify(taskIds),
  });
  const text = await response.text();
  if (!response.ok) {
    return NextResponse.json(
      { error: text || `Slides API request failed with ${response.status}` },
      { status: response.status },
    );
  }
  let slidesUrl: string;
  try {
    slidesUrl = JSON.parse(text) as string;
  } catch {
    slidesUrl = text;
  }
  if (!/^https?:\/\//i.test(slidesUrl)) {
    return NextResponse.json(
      { error: slidesUrl || "Slides API returned an unexpected response." },
      { status: 502 },
    );
  }
  return NextResponse.json({ slidesUrl });
}
