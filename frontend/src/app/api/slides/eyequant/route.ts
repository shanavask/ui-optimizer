import { NextResponse } from "next/server";

import { proxyToSlidesApi } from "@/lib/backend-proxy";

type EyeQuantBody = { runId?: unknown; pageIndex?: unknown };

export const runtime = "nodejs";

// Adapter, not a straight proxy: the UI sends a POST {runId, pageIndex} body,
// but slidesapi's existing /eyequant endpoint is a GET with query params and
// returns a bare JSON string, not {status}.
export async function POST(request: Request): Promise<Response> {
  const bodyUnknown: unknown = await request.json();
  if (typeof bodyUnknown !== "object" || bodyUnknown === null) {
    return NextResponse.json({ error: "Request body must be an object." }, { status: 400 });
  }
  const body = bodyUnknown as EyeQuantBody;
  if (typeof body.runId !== "string" || !body.runId.trim()) {
    return NextResponse.json({ error: "runId is required." }, { status: 400 });
  }
  const searchParams = new URLSearchParams({ run_id: body.runId.trim() });
  if (typeof body.pageIndex === "number") {
    searchParams.set("page_id", String(body.pageIndex));
  }
  const response = await proxyToSlidesApi("/eyequant", { method: "GET", searchParams });
  if (!response.ok) {
    return response;
  }
  const status = (await response.json()) as string;
  return NextResponse.json({ status });
}
