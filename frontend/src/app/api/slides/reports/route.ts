import { proxyToSlidesApi } from "@/lib/backend-proxy";

export const runtime = "nodejs";

export async function GET(request: Request): Promise<Response> {
  const { searchParams } = new URL(request.url);
  return proxyToSlidesApi("/slides/reports", { method: "GET", searchParams });
}
