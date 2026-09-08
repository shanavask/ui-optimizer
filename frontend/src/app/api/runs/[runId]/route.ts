import { proxyToSlidesApi } from "@/lib/backend-proxy";

export const runtime = "nodejs";

type Params = { params: Promise<{ runId: string }> };

export async function GET(_: Request, context: Params): Promise<Response> {
  const { runId } = await context.params;
  return proxyToSlidesApi(`/runs/${encodeURIComponent(runId)}`, { method: "GET" });
}

export async function DELETE(_: Request, context: Params): Promise<Response> {
  const { runId } = await context.params;
  return proxyToSlidesApi(`/runs/${encodeURIComponent(runId)}`, { method: "DELETE" });
}
