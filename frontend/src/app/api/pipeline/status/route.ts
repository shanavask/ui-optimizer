import { proxyToSlidesApi } from "@/lib/backend-proxy";

export const runtime = "nodejs";

export async function GET(request: Request): Promise<Response> {
  const { searchParams } = new URL(request.url);
  return proxyToSlidesApi("/pipeline/status", { method: "GET", searchParams });
}
