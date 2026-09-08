import { proxyToSlidesApi } from "@/lib/backend-proxy";

export const runtime = "nodejs";

type Params = { params: Promise<{ runId: string }> };

export async function GET(_: Request, context: Params): Promise<Response> {
  const { runId } = await context.params;
  return proxyToSlidesApi(`/roi/${encodeURIComponent(runId)}`, { method: "GET" });
}

export async function PATCH(request: Request, context: Params): Promise<Response> {
  const { runId } = await context.params;
  const body = await request.json();
  return proxyToSlidesApi(`/roi/${encodeURIComponent(runId)}`, { method: "PATCH", body });
}
